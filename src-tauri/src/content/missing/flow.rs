use super::*;

/// Index für eingetroffene Dateien schreiben und ersetzte ältere Versionen entfernen.
pub fn apply_to_index(idx: &mut ContentIndex, game_dir: &Path, done: &[MissingEntry]) {
    for e in done {
        let key = index::key(e.info.kind.folder(), &e.info.file_name);
        for old in &e.replaces {
            if *old == key {
                continue;
            }
            let p = game_dir.join(old);
            for f in [with_disabled(&p), p] {
                if f.is_file() {
                    let _ = std::fs::remove_file(&f);
                }
            }
            idx.files.remove(old);
            idx.local.remove(old);
        }
        if let Some(entry) = &e.index {
            idx.files.insert(key.clone(), entry.clone());
            idx.local.remove(&key);
        }
    }
}

// ------------------------------------------------------------------ Ablauf

/// Fehlende Hashes (ältere Einträge) über die CurseForge-API nachtragen.
pub(super) async fn enrich(state: &AppState, list: &mut [MissingEntry]) -> bool {
    if !cf::available(state) {
        return false;
    }
    let ids: Vec<u64> = list
        .iter()
        .filter(|e| e.sha1.is_none() && e.fingerprint.is_none())
        .filter_map(|e| e.file_id.as_deref()?.parse().ok())
        .collect();
    if ids.is_empty() {
        return false;
    }
    let Ok(files) = cf::raw_files_by_id(state, &ids).await else { return false };
    let mut changed = false;
    for e in list.iter_mut().filter(|e| e.sha1.is_none() && e.fingerprint.is_none()) {
        let Some(f) = e.file_id.as_deref().and_then(|id| id.parse::<u64>().ok()).and_then(|id| files.iter().find(|f| f.id == id)) else { continue };
        e.sha1 = f.sha1();
        e.fingerprint = cf::fingerprint32(f.file_fingerprint);
        e.size = Some(f.file_length).filter(|s| *s > 0);
        changed = true;
    }
    changed
}

/// Ein Durchlauf für eine Instanz: erkennt abgelegte/heruntergeladene Dateien, übernimmt sie, aktualisiert
/// Index und `missing.json`, meldet Eintreffen per Event. Gibt (übernommen, verbleibend) zurück.
pub async fn scan(state: &AppState, instance_id: &str, with_enrich: bool, cache: &mut HashCache) -> AppResult<(Vec<MissingEntry>, Vec<MissingEntry>)> {
    let mut list = load(&state.paths, instance_id);
    if list.is_empty() {
        return Ok((vec![], vec![]));
    }
    let enriched = with_enrich && enrich(state, &mut list).await;
    let lock = state.content.lock(instance_id);
    let _g = lock.lock().await;
    let paths = state.paths.clone();
    let id = instance_id.to_string();
    let mut c = std::mem::take(cache);
    let (out, c) = tokio::task::spawn_blocking(move || -> AppResult<(Outcome, HashCache)> {
        // Erneut laden: zwischenzeitlich hinzugekommene Einträge nicht verlieren
        let fresh = load(&paths, &id);
        let list: Vec<MissingEntry> = fresh
            .into_iter()
            .map(|f| list.iter().find(|e| e.info.file_name == f.info.file_name && e.info.kind == f.info.kind && f.sha1.is_none() && f.fingerprint.is_none()).cloned().unwrap_or(f))
            .collect();
        let before = list.len();
        let game_dir = paths.game_dir(&id);
        let out = scan_dirs(&game_dir, downloads_dir().as_deref(), list, &mut c);
        let done: Vec<MissingEntry> = out.arrived.iter().chain(out.present.iter()).cloned().collect();
        if !done.is_empty() {
            let mut idx = ContentIndex::load(&paths, &id);
            apply_to_index(&mut idx, &game_dir, &done);
            idx.save(&paths, &id)?;
        }
        if out.remaining.len() != before || enriched {
            save(&paths, &id, &out.remaining)?;
        }
        Ok((out, c))
    })
    .await??;
    *cache = c;
    drop(_g);
    if !out.arrived.is_empty() || !out.present.is_empty() {
        state.content.update_counts.lock().remove(instance_id);
        state.content.emit_changed(instance_id);
    }
    for e in &out.arrived {
        crate::events::emit(
            &state.content.app,
            crate::events::CONTENT_MANUAL_ARRIVED,
            &ManualArrived {
                instance_id: instance_id.to_string(),
                project_id: e.project_id.clone(),
                project_name: e.info.project_name.clone(), file_name: e.info.file_name.clone(), kind: e.info.kind },
        );
    }
    let mut taken = out.arrived;
    taken.extend(out.present);
    Ok((taken, out.remaining))
}

/// Noch fehlende Dateien (erkennt dabei bereits abgelegte bzw. heruntergeladene).
pub async fn list(state: &AppState, instance_id: &str) -> AppResult<Vec<MissingDownload>> {
    state.instances.get(instance_id)?;
    let (_, remaining) = scan(state, instance_id, true, &mut HashCache::default()).await?;
    Ok(remaining.into_iter().map(|e| e.info).collect())
}

/// „Ich habe sie heruntergeladen – suchen“: sofort prüfen und den Ordner danach noch kurz beobachten.
pub async fn scan_now(state: &AppState, instance_id: &str) -> AppResult<MissingScan> {
    state.instances.get(instance_id)?;
    let (found, remaining) = scan(state, instance_id, true, &mut HashCache::default()).await?;
    let watching_until = if remaining.is_empty() { None } else { watch(state, instance_id, Duration::from_secs(3 * 60)) };
    Ok(MissingScan {
        found: found.into_iter().map(|e| e.info).collect(),
        remaining: remaining.into_iter().map(|e| e.info).collect(),
        folder: downloads_dir().map(|d| d.to_string_lossy().to_string()),
        watching_until,
    })
}

/// Bis wann (ms seit Epoch) der Download-Ordner für diese Instanz beobachtet wird.
pub fn watching_until(state: &AppState, instance_id: &str) -> Option<i64> {
    let until = *state.content.manual_watch.lock().get(instance_id)?;
    let left = until.checked_duration_since(Instant::now())?;
    Some(crate::util::now_ms() + left.as_millis() as i64)
}

/// Download-Ordner für `dur` beobachten (verlängert eine laufende Beobachtung). Gibt das Ende zurück.
pub fn watch(state: &AppState, instance_id: &str, dur: Duration) -> Option<i64> {
    downloads_dir()?;
    {
        let mut m = state.content.manual_watch.lock();
        let until = Instant::now() + dur;
        let e = m.entry(instance_id.to_string()).or_insert(until);
        if *e < until {
            *e = until;
        }
    }
    if !state.content.manual_watch_running.swap(true, Ordering::SeqCst) {
        let st = state.clone();
        tauri::async_runtime::spawn(async move { watch_loop(st).await });
    }
    watching_until(state, instance_id)
}

pub(super) async fn watch_loop(state: AppState) {
    let mut caches: HashMap<String, HashCache> = HashMap::new();
    loop {
        tokio::time::sleep(TICK).await;
        let now = Instant::now();
        let ids: Vec<String> = {
            let mut m = state.content.manual_watch.lock();
            m.retain(|_, until| *until > now);
            m.keys().cloned().collect()
        };
        if ids.is_empty() {
            state.content.manual_watch_running.store(false, Ordering::SeqCst);
            // Zwischenzeitlich neu gestartet? Dann weiterlaufen, sonst beenden.
            if state.content.manual_watch.lock().is_empty() || state.content.manual_watch_running.swap(true, Ordering::SeqCst) {
                return;
            }
            continue;
        }
        for id in ids {
            let cache = caches.entry(id.clone()).or_default();
            match scan(&state, &id, false, cache).await {
                Ok((_, remaining)) if remaining.is_empty() => {
                    state.content.manual_watch.lock().remove(&id);
                    caches.remove(&id);
                }
                Ok(_) => {}
                Err(e) => tracing::debug!("Download-Ordner-Prüfung {id}: {e}"),
            }
        }
    }
}

/// Einträge für CurseForge-Dateien (für Tests und Aufrufer ohne Plan).
pub fn entry_for_cf_file(f: &cf::CfFile, project_name: &str, page_url: String, kind: ContentKind) -> MissingEntry {
    let mut e = MissingEntry::new(MissingDownload {
        file_name: crate::paths::sanitize_file_name(&f.file_name),
        project_name: project_name.to_string(),
        page_url,
        kind,
        version_number: Some(if f.display_name.is_empty() { f.file_name.clone() } else { f.display_name.clone() }),
        is_update: false,
    });
    e.sha1 = f.sha1();
    e.fingerprint = cf::fingerprint32(f.file_fingerprint);
    e.size = Some(f.file_length).filter(|s| *s > 0);
    e.project_id = Some(f.mod_id.to_string());
    e.file_id = Some(f.id.to_string());
    let v = cf::convert_file(f);
    e.index = Some(IndexEntry {
        source: Source::Curseforge,
        project_id: f.mod_id.to_string(),
        version_id: f.id.to_string(),
        sha1: e.sha1.clone(),
        sha512: None,
        title: Some(project_name.to_string()),
        icon_url: None,
        version_number: Some(v.version_number),
        url: None,
        size: e.size,
        date: Some(v.date).filter(|d| !d.is_empty()),
        release_type: Some(v.release_type),
        side: crate::content::sides::from_cf_versions(&f.game_versions),
    });
    e
}
