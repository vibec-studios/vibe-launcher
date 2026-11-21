use super::*;

pub(super) fn state_check_limit(n: usize) -> AppResult<()> {
    if n > 200 {
        return Err(AppError::msg("Zu viele Abhängigkeiten – Installation abgebrochen"));
    }
    Ok(())
}

/// Plan ausführen: herunterladen, alte Versionen ersetzen, Index aktualisieren.
/// Gesperrte Downloads (CurseForge) landen in `missing.json`.
pub async fn apply(state: &AppState, inst: &Instance, planned: Vec<Planned>, sub: &SubProgress) -> AppResult<Vec<MissingDownload>> {
    crate::content::migration::guard(state, &inst.id)?;
    let game_dir = state.paths.game_dir(&inst.id);
    let idx = ContentIndex::load(&state.paths, &inst.id);
    let mut items = Vec::new();
    let mut entries: Vec<(String, IndexEntry, Vec<String>)> = Vec::new();
    let mut missing_list: Vec<MissingEntry> = Vec::new();
    // Gesperrte CurseForge-Downloads: identische Datei von Modrinth (gleicher SHA-1)
    let locked: Vec<String> = planned.iter().filter(|p| p.file.url.is_none()).filter_map(|p| p.file.sha1.clone()).collect();
    let mirrors = mr::mirrors(state, &locked).await;
    let planned: Vec<Planned> = planned
        .into_iter()
        .map(|mut p| {
            if p.file.url.is_none() {
                if let Some(m) = p.file.sha1.as_ref().and_then(|h| mirrors.get(&h.to_ascii_lowercase())) {
                    p.file.url = Some(m.url.clone());
                }
            }
            p
        })
        .collect();

    for p in &planned {
        let folder = p.kind.folder();
        let old_keys = idx.keys_of_project(p.source, &p.brief.id);
        // War die alte Version deaktiviert? Dann bleibt die neue es auch.
        let was_disabled = !old_keys.is_empty()
            && old_keys.iter().all(|k| {
                let path = game_dir.join(k);
                !path.exists() && path.with_file_name(format!("{}.disabled", path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default())).exists()
            });
        let file_name = crate::paths::sanitize_file_name(&p.file.filename);
        let entry = p.index_entry();
        let Some(url) = p.file.url.clone() else {
            // Gesperrt: als „erwartet“ vormerken; trifft die Datei ein (Download-Ordner), wird sie mit diesem
            // Index-Eintrag übernommen und ersetzt eine ältere Version
            let key = index::key(folder, &file_name);
            let replaces: Vec<String> = old_keys.into_iter().filter(|k| *k != key).collect();
            missing_list.push(MissingEntry {
                info: MissingDownload {
                    file_name: file_name.clone(),
                    project_name: p.brief.title.clone(),
                    page_url: manual_page(p),
                    kind: p.kind,
                    version_number: Some(p.version.version_number.clone()),
                    is_update: !replaces.is_empty(),
                },
                sha1: p.file.sha1.clone(),
                project_id: Some(p.brief.id.clone()),
                file_id: Some(p.version.id.clone()),
                size: Some(p.file.size).filter(|s| *s > 0),
                fingerprint: p.file.fingerprint,
                index: Some(entry),
                replaces,
            });
            continue;
        };
        let on_disk = if was_disabled { format!("{file_name}.disabled") } else { file_name.clone() };
        let path = game_dir.join(folder).join(&on_disk);
        items.push(DownloadItem::new(url.clone(), path).sha1(p.file.sha1.clone()).size(Some(p.file.size).filter(|s| *s > 0)));
        let key = index::key(folder, &file_name);
        entries.push((key, entry, old_keys));
    }

    state.net.download_all(items, Some(sub)).await?;

    // Alte Dateien entfernen, Index aktualisieren
    let lock = state.content.lock(&inst.id);
    let _g = lock.lock().await;
    let mut idx = ContentIndex::load(&state.paths, &inst.id);
    for (key, entry, old_keys) in entries {
        for ok in old_keys {
            if ok != key {
                let p = game_dir.join(&ok);
                let disabled = p.with_file_name(format!("{}.disabled", p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()));
                for f in [p, disabled] {
                    if f.is_file() {
                        let _ = tokio::fs::remove_file(&f).await;
                    }
                }
                idx.files.remove(&ok);
                idx.local.remove(&ok);
            }
        }
        idx.files.insert(key, entry);
    }
    idx.save(&state.paths, &inst.id)?;
    let out: Vec<MissingDownload> = missing_list.iter().map(|m| m.info.clone()).collect();
    // Unter derselben Sperre wie `missing::scan` (Beobachtung des Download-Ordners), damit nichts verloren geht
    missing::add(&state.paths, &inst.id, missing_list)?;
    drop(_g);
    state.content.update_counts.lock().remove(&inst.id);
    state.content.emit_changed(&inst.id);
    Ok(out)
}

/// Dateiseite für einen manuellen Download (CurseForge: genaue Datei, sonst Projektseite).
pub(super) fn manual_page(p: &Planned) -> String {
    if p.source == Source::Curseforge {
        format!("{}/files/{}", p.brief.page_url.trim_end_matches('/'), p.version.id)
    } else {
        p.brief.page_url.clone()
    }
}

pub(crate) async fn refresh_all(state: &AppState, inst_id: &str) -> AppResult<(Vec<(ContentKind, local::Scanned)>, ContentIndex)> {
    let mut all = Vec::new();
    for k in ContentKind::ALL {
        let (s, _) = local::refresh(state, inst_id, k).await?;
        all.extend(s.into_iter().map(|s| (k, s)));
    }
    Ok((all, ContentIndex::load(&state.paths, inst_id)))
}

pub(super) fn finish_message(task: &TaskHandle, warnings: &[String], missing: &[MissingDownload], installed: usize) {
    let mut msg = format!("{installed} Datei(en) installiert");
    if !missing.is_empty() {
        msg.push_str(&format!(", {} manuell herunterzuladen", missing.len()));
    }
    if let Some(w) = warnings.first() {
        msg.push_str(&format!(" – Hinweis: {w}"));
    }
    task.message(msg);
}

/// Task-Körper von `content_install`.
pub async fn run_install(state: AppState, task: TaskHandle, instance_id: String, source: Source, project_id: String, version_id: Option<String>) -> AppResult<()> {
    run_install_with(state, task, instance_id, source, project_id, version_id, false).await
}

/// Wie `run_install`. `expect_manual`: Der Nutzer lädt die (gesperrte) Hauptdatei selbst auf CurseForge
/// herunter -> kein Fehler, die Datei wird erwartet und der Download-Ordner beobachtet.
pub async fn run_install_with(
    state: AppState,
    task: TaskHandle,
    instance_id: String,
    source: Source,
    project_id: String,
    version_id: Option<String>,
    expect_manual: bool,
) -> AppResult<()> {
    let inst = state.instances.get(&instance_id)?;
    if source == Source::Curseforge {
        cf::key(&state)?;
    }
    task.stage("Prüfe installierte Inhalte …", None);
    let (_, idx) = refresh_all(&state, &instance_id).await?;
    task.check()?;
    task.stage("Löse Abhängigkeiten auf …", None);
    let mut warnings = Vec::new();
    let planned = plan(&state, &inst, &idx, vec![(source, project_id, version_id)], &mut warnings).await?;
    if let Some(root) = planned.first() {
        task.set_title(format!("{} installieren", root.brief.title));
    }
    task.check()?;
    let n = planned.iter().filter(|p| p.file.url.is_some()).count();
    task.stage(format!("Lade {n} Datei(en) …"), Some(0.1));
    let root_title = planned.first().map(|p| p.brief.title.clone()).unwrap_or_default();
    let root_file = planned.first().map(|p| crate::paths::sanitize_file_name(&p.file.filename));
    let note = crate::content::organize::InstallNote::new(&planned, 1, true);
    let missing = apply(&state, &inst, planned, &task.sub(0.1, 1.0)).await?;
    note.commit(&state.paths, &instance_id);
    let root_locked = root_file.is_some_and(|f| missing.iter().any(|m| m.file_name == f));
    for w in &warnings {
        tracing::warn!("content_install {instance_id}: {w}");
    }
    if !missing.is_empty() {
        missing::watch(&state, &instance_id, missing::WATCH_FOR);
    }
    if root_locked && expect_manual {
        let mut msg = format!("{root_title}: Datei wird erwartet – Vibe übernimmt sie aus deinem Download-Ordner");
        if n > 0 {
            msg.push_str(&format!(" ({n} Abhängigkeit(en) installiert)"));
        }
        task.message(msg);
        return Ok(());
    }
    if root_locked {
        return Err(AppError::msg(format!(
            "Der Autor von {root_title} erlaubt keine Downloads über andere Launcher. Lade die Datei auf CurseForge herunter – Vibe übernimmt sie dann automatisch aus deinem Download-Ordner (siehe Hinweis bei der Instanz)."
        )));
    }
    finish_message(&task, &warnings, &missing, n);
    Ok(())
}
