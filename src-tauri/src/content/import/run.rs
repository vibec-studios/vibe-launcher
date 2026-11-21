use super::*;

/// Importiert eine Pack-Datei als neue Instanz. Gibt die Instanz-ID zurück.
pub async fn run_import(state: &AppState, task: &TaskHandle, path: &Path, opts: ImportOptions, sub: SubProgress) -> AppResult<String> {
    sub.message("Analysiere Pack …");
    let p = path.to_path_buf();
    let plan = tokio::task::spawn_blocking(move || analyze(&p)).await??;
    task.check()?;

    // CurseForge vorab auflösen (braucht Key) – vor dem Anlegen der Instanz
    let mut cf_res = ResolvedCf { files: vec![], missing: vec![], warnings: vec![] };
    if plan.format == PackFormat::Curseforge && !plan.cf_files.is_empty() {
        cf::key(state)?;
        sub.message(format!("Löse {} CurseForge-Dateien auf …", plan.cf_files.len()));
        cf_res = resolve_cf(state, &plan.cf_files).await?;
        // Gesperrte Downloads: identische Datei (gleicher SHA-1) von Modrinth laden, falls vorhanden
        let sha1s: Vec<String> = cf_res.missing.iter().filter_map(|m| m.sha1.clone()).collect();
        let mirrors = mr::mirrors(state, &sha1s).await;
        if !mirrors.is_empty() {
            let mut still = Vec::new();
            for m in std::mem::take(&mut cf_res.missing) {
                match m.sha1.as_ref().and_then(|h| mirrors.get(&h.to_ascii_lowercase())) {
                    Some(mi) => cf_res.files.push(PackFile {
                        path: format!("{}/{}", m.info.kind.folder(), m.info.file_name),
                        url: mi.url.clone(),
                        sha1: m.sha1.clone(),
                        size: Some(mi.size),
                        origin: Some((Source::Modrinth, mi.project_id.clone(), mi.version_id.clone())),
                        side: None,
                    }),
                    None => still.push(m),
                }
            }
            cf_res.missing = still;
        }
    }
    task.check()?;

    let name = opts.name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| plan.name.clone());
    let source = opts.source.clone().or_else(|| {
        Some(PackSource { kind: pack_source_kind(plan.format), project_id: None, version_id: None, name: Some(plan.name.clone()), version_name: plan.version_name.clone() })
    });
    let inst = state.instances.insert_new(new_instance(name.clone(), &plan, source))?;
    task.set_instance(inst.id.clone());
    if opts.source.is_none() {
        task.set_title(format!("{name} importieren"));
    }

    let res = async {
        let game_dir = state.paths.game_dir(&inst.id);
        // Overrides
        if !plan.overrides.is_empty() {
            sub.message("Entpacke Dateien …");
            let zp = path.to_path_buf();
            let prefixes = plan.overrides.clone();
            let gd = game_dir.clone();
            let s = sub.sub(0.0, 0.2);
            tokio::task::spawn_blocking(move || {
                extract_overrides(&zp, &prefixes, &gd, &|p| {
                    s.progress(p);
                    s.check()
                })
            })
            .await??;
        }
        task.check()?;
        // Downloads
        let mut files = plan.files.clone();
        files.extend(cf_res.files.iter().cloned());
        let mut items = Vec::new();
        for f in &files {
            let target = safe_join(&game_dir, &f.path).ok_or_else(|| AppError::Invalid(format!("Unzulässiger Pfad: {}", f.path)))?;
            items.push(DownloadItem::new(f.url.clone(), target).sha1(f.sha1.clone()).size(f.size));
        }
        sub.message(format!("Lade {} Datei(en) …", items.len()));
        state.net.download_all(items, Some(&sub.sub(0.2, 0.95))).await?;
        task.check()?;

        // Index (Herkunft bekannter Dateien) + fehlende Downloads
        {
            let lock = state.content.lock(&inst.id);
            let _g = lock.lock().await;
            let mut idx = ContentIndex::load(&state.paths, &inst.id);
            for f in &files {
                let Some((source, pid, vid)) = &f.origin else { continue };
                let rel = f.path.replace('\\', "/");
                let Some((folder, file)) = rel.split_once('/') else { continue };
                if ContentKind::from_folder(folder).is_none() || file.contains('/') {
                    continue;
                }
                idx.files.insert(
                    index::key(folder, file),
                    IndexEntry {
                        source: *source,
                        project_id: pid.clone(),
                        version_id: vid.clone(),
                        sha1: f.sha1.clone(),
                        sha512: None,
                        title: None,
                        icon_url: None,
                        version_number: None,
                        url: Some(f.url.clone()),
                        size: f.size,
                        date: None,
                        release_type: None,
                        side: f.side,
                    },
                );
            }
            idx.save(&state.paths, &inst.id)?;
        }
        missing::add(&state.paths, &inst.id, cf_res.missing.clone())?;

        // Installationsstand für spätere Modpack-Updates merken
        if let Err(e) = crate::content::modpack::record_after_import(state, &inst.id, path, &plan, &files, &opts).await {
            tracing::warn!("pack.json für {} nicht geschrieben: {e}", inst.id);
        }

        // Icon
        let icon = match (&plan.icon, &opts.icon_url) {
            (Some(b), _) => Some(b.to_vec()),
            (None, Some(url)) => state.net.get_bytes(url).await.ok().map(|b| b.to_vec()),
            _ => None,
        };
        if let Some(b) = icon {
            if let Err(e) = set_icon_bytes(state, &inst.id, &b).await {
                tracing::warn!("Icon für {} nicht gesetzt: {e}", inst.id);
            }
        }
        sub.progress(1.0);
        Ok::<(), AppError>(())
    }
    .await;

    match res {
        Ok(()) => {
            for w in &cf_res.warnings {
                tracing::warn!("Import {}: {w}", inst.id);
            }
            let n = plan.files.len() + cf_res.files.len();
            let mut msg = if n == 0 { "Import abgeschlossen".to_string() } else { format!("{n} Datei(en) geladen") };
            if !cf_res.missing.is_empty() {
                msg.push_str(&format!(", {} manuell herunterzuladen", cf_res.missing.len()));
            }
            task.message(msg);
            state.content.emit_changed(&inst.id);
            Ok(inst.id)
        }
        Err(e) => {
            if let Err(de) = state.instances.delete(&inst.id) {
                tracing::warn!("Halb importierte Instanz {} nicht entfernt: {de}", inst.id);
            }
            Err(e)
        }
    }
}

/// Task-Körper von `import_pack`.
pub async fn run_import_task(state: AppState, task: TaskHandle, path: String, name: Option<String>) -> AppResult<()> {
    let sub = task.sub(0.0, 1.0);
    run_import(&state, &task, Path::new(&path), ImportOptions { name, ..Default::default() }, sub).await?;
    Ok(())
}
