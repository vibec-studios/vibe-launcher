use super::*;

// ------------------------------------------------------------------ Hash-Zuordnung

#[derive(Debug, Clone)]
pub struct Pending {
    pub key: String,
    pub sha1: String,
    pub sha256: Option<String>,
    pub murmur: Option<u32>,
}

/// Dateien ohne bekannte Herkunft, die (noch) nicht als unbekannt markiert sind, und Index-Einträge ohne Titel.
pub fn pending(scanned: &[Scanned], idx: &ContentIndex, cf_available: bool) -> (Vec<Pending>, Vec<String>) {
    let now = crate::util::now_ms();
    let mut p = Vec::new();
    let mut enrich = Vec::new();
    for s in scanned {
        if let Some(e) = idx.files.get(&s.key) {
            if e.title.is_none() || (e.source == Source::Modrinth && e.side.is_none()) {
                enrich.push(s.key.clone());
            }
            continue;
        }
        let Some(sha1) = &s.meta.sha1 else { continue };
        let need = match idx.unknown.get(sha1) {
            None => true,
            Some(u) => now - u.checked_at > UNKNOWN_RECHECK_MS || (cf_available && !u.curseforge && s.meta.murmur2.is_some()),
        };
        if need {
            p.push(Pending { key: s.key.clone(), sha1: sha1.clone(), sha256: s.meta.sha256.clone(), murmur: s.meta.murmur2 });
        }
    }
    (p, enrich)
}

pub(super) fn entry_from_mr(v: &mr::MrVersion, sha1: &str, project: Option<&mr::MrProject>) -> IndexEntry {
    let file = v.files.iter().find(|f| f.hashes.sha1.as_deref().is_some_and(|h| h.eq_ignore_ascii_case(sha1)));
    IndexEntry {
        source: Source::Modrinth,
        project_id: v.project_id.clone(),
        version_id: v.id.clone(),
        sha1: Some(sha1.to_ascii_lowercase()),
        sha512: file.and_then(|f| f.hashes.sha512.clone()),
        title: project.map(|p| p.title.clone()),
        icon_url: project.and_then(|p| p.icon_url.clone()).filter(|u| !u.is_empty()),
        version_number: Some(v.version_number.clone()),
        url: file.map(|f| f.url.clone()),
        size: file.map(|f| f.size),
        date: Some(v.date_published.clone()),
        release_type: Some(v.version_type.clone()),
        side: project.map(|p| crate::content::sides::from_sides(p.client_side.as_deref(), p.server_side.as_deref())),
    }
}

pub(super) fn entry_from_cf(f: &cf::CfFile, sha1: Option<String>, m: Option<&cf::CfMod>) -> IndexEntry {
    let v = cf::convert_file(f);
    IndexEntry {
        source: Source::Curseforge,
        project_id: f.mod_id.to_string(),
        version_id: f.id.to_string(),
        sha1: sha1.or_else(|| f.sha1()),
        sha512: None,
        title: m.map(|m| m.name.clone()),
        icon_url: m.and_then(|m| cf::mod_to_hit(m).icon_url),
        version_number: Some(v.version_number),
        url: f.download_url.clone(),
        size: Some(f.file_length),
        date: Some(f.file_date.clone()),
        release_type: Some(v.release_type),
        side: crate::content::sides::from_cf_versions(&f.game_versions),
    }
}

/// Unbekannte Dateien per Hash zuordnen (Modrinth sha1, CurseForge Murmur2) und fehlende Titel nachladen.
/// Gibt zurück, ob sich der Index geändert hat.
pub async fn identify(state: &AppState, instance_id: &str, pending: Vec<Pending>, enrich: Vec<String>) -> AppResult<bool> {
    if pending.is_empty() && enrich.is_empty() {
        return Ok(false);
    }
    let mut found: HashMap<String, IndexEntry> = HashMap::new();
    let mut cf_checked = false;

    if !pending.is_empty() {
        // Modrinth
        let sha1s: Vec<String> = pending.iter().map(|p| p.sha1.clone()).collect();
        let by_hash = mr::versions_by_hash(state, &sha1s).await?;
        let pids: Vec<String> = by_hash.values().map(|v| v.project_id.clone()).collect::<HashSet<_>>().into_iter().collect();
        let projects: HashMap<String, mr::MrProject> = if pids.is_empty() {
            HashMap::new()
        } else {
            mr::raw_projects(state, &pids).await.unwrap_or_default().into_iter().map(|p| (p.id.clone(), p)).collect()
        };
        for p in &pending {
            if let Some(v) = by_hash.get(&p.sha1.to_ascii_lowercase()) {
                found.insert(p.key.clone(), entry_from_mr(v, &p.sha1, projects.get(&v.project_id)));
            }
        }
        // CurseForge (nur Rest)
        let rest: Vec<&Pending> = pending.iter().filter(|p| !found.contains_key(&p.key) && p.murmur.is_some()).collect();
        if !rest.is_empty() && cf::available(state) {
            let fps: Vec<u32> = rest.iter().filter_map(|p| p.murmur).collect();
            match cf::fingerprints(state, &fps).await {
                Ok(matches) => {
                    cf_checked = true;
                    let mod_ids: Vec<u64> = matches.iter().map(|m| m.file.mod_id).collect::<HashSet<_>>().into_iter().collect();
                    let mods: HashMap<u64, cf::CfMod> =
                        if mod_ids.is_empty() { HashMap::new() } else { cf::raw_mods(state, &mod_ids).await.unwrap_or_default().into_iter().map(|m| (m.id, m)).collect() };
                    for p in rest {
                        if let Some(m) = matches.iter().find(|m| Some(m.file.file_fingerprint as u32) == p.murmur && m.file.file_fingerprint <= u32::MAX as u64) {
                            found.insert(p.key.clone(), entry_from_cf(&m.file, Some(p.sha1.clone()), mods.get(&m.file.mod_id)));
                        }
                    }
                }
                Err(e) => tracing::warn!("CurseForge-Fingerprint-Abfrage fehlgeschlagen: {e}"),
            }
        }
        // Eigene Stores (sha1/sha256)
        let rest: Vec<(String, Option<String>)> = pending.iter().filter(|p| !found.contains_key(&p.key)).map(|p| (p.sha1.clone(), p.sha256.clone())).collect();
        if !rest.is_empty() {
            let hits = crate::content::store::by_hash(state, &rest).await;
            for p in &pending {
                if let Some(h) = hits.get(&p.sha1) {
                    found.insert(
                        p.key.clone(),
                        IndexEntry {
                            source: Source::Store(h.key),
                            project_id: h.version.project_id.clone(),
                            version_id: h.version.id.clone(),
                            sha1: Some(p.sha1.to_ascii_lowercase()),
                            sha512: None,
                            title: Some(h.title.clone()),
                            icon_url: h.icon.clone(),
                            version_number: Some(h.version.version_number.clone()),
                            url: Some(h.url.clone()),
                            size: Some(h.size),
                            date: Some(h.version.date.clone()),
                            release_type: Some(h.version.release_type.clone()),
                            side: h.side,
                        },
                    );
                }
            }
        }
    }

    // Titel/Icons für bekannte Einträge ohne Titel nachladen
    let idx_now = ContentIndex::load(&state.paths, instance_id);
    let mut enriched: HashMap<String, (String, Option<String>, Option<Side>)> = HashMap::new();
    let mr_ids: Vec<String> = enrich
        .iter()
        .filter_map(|k| idx_now.files.get(k))
        .filter(|e| e.source == Source::Modrinth)
        .map(|e| e.project_id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if !mr_ids.is_empty() {
        for p in mr::raw_projects(state, &mr_ids).await.unwrap_or_default() {
            let side = crate::content::sides::from_sides(p.client_side.as_deref(), p.server_side.as_deref());
            enriched.insert(format!("mr:{}", p.id), (p.title.clone(), p.icon_url.clone().filter(|u| !u.is_empty()), Some(side)));
        }
    }
    let cf_ids: Vec<u64> = enrich
        .iter()
        .filter_map(|k| idx_now.files.get(k))
        .filter(|e| e.source == Source::Curseforge)
        .filter_map(|e| e.project_id.parse().ok())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if !cf_ids.is_empty() && cf::available(state) {
        for m in cf::raw_mods(state, &cf_ids).await.unwrap_or_default() {
            enriched.insert(format!("cf:{}", m.id), (m.name.clone(), cf::mod_to_hit(&m).icon_url, None));
        }
    }

    let lock = state.content.lock(instance_id);
    let _g = lock.lock().await;
    let mut idx = ContentIndex::load(&state.paths, instance_id);
    let mut changed = false;
    let now = crate::util::now_ms();
    for p in &pending {
        // Datei inzwischen geändert/entfernt?
        if idx.local.get(&p.key).and_then(|m| m.sha1.as_ref()) != Some(&p.sha1) {
            continue;
        }
        if let Some(e) = found.remove(&p.key) {
            idx.files.insert(p.key.clone(), e);
            idx.unknown.remove(&p.sha1);
        } else {
            idx.unknown.insert(p.sha1.clone(), UnknownHash { modrinth: true, curseforge: cf_checked, checked_at: now });
        }
        changed = true;
    }
    for k in &enrich {
        if let Some(e) = idx.files.get_mut(k) {
            let tag = match e.source {
                Source::Modrinth => format!("mr:{}", e.project_id),
                Source::Curseforge => format!("cf:{}", e.project_id),
                Source::Store(_) => continue,
            };
            if let Some((title, icon, side)) = enriched.get(&tag) {
                e.title = Some(title.clone());
                if e.side.is_none() {
                    e.side = *side;
                }
                if e.icon_url.is_none() {
                    e.icon_url = icon.clone();
                }
                changed = true;
            }
        }
    }
    if changed {
        idx.save(&state.paths, instance_id)?;
    }
    Ok(changed)
}

/// Zuordnung im Hintergrund starten (höchstens eine je Instanz, Pause nach Netzwerkfehlern).
pub fn identify_in_background(state: &AppState, instance_id: &str, pending: Vec<Pending>, enrich: Vec<String>) {
    if pending.is_empty() && enrich.is_empty() {
        return;
    }
    if let Some(t) = state.content.identify_backoff.lock().get(instance_id) {
        if t.elapsed() < IDENTIFY_BACKOFF {
            return;
        }
    }
    if !state.content.identifying.lock().insert(instance_id.to_string()) {
        return;
    }
    let state = state.clone();
    let id = instance_id.to_string();
    tauri::async_runtime::spawn(async move {
        let res = identify(&state, &id, pending, enrich).await;
        state.content.identifying.lock().remove(&id);
        match res {
            Ok(true) => state.content.emit_changed(&id),
            Ok(false) => {}
            Err(e) => {
                tracing::warn!("Hash-Zuordnung für {id} fehlgeschlagen: {e}");
                state.content.identify_backoff.lock().insert(id, std::time::Instant::now());
            }
        }
    });
}
