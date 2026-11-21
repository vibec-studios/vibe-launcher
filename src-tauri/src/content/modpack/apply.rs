use super::*;

/// Task-Körper von `modpack_update`.
pub async fn run_update(state: AppState, task: TaskHandle, instance_id: String, version_id: Option<String>) -> AppResult<()> {
    let inst = state.instances.get(&instance_id)?;
    let (rec, legacy) = record_or_fallback(&state, &inst).ok_or_else(|| AppError::Invalid("Diese Instanz stammt nicht aus einem aktualisierbaren Modpack".into()))?;
    let (Some(source), Some(pid)) = (rec.source, rec.project_id.clone()) else { return Err(AppError::Invalid("Modpack-Quelle unbekannt".into())) };
    task.stage("Lade neue Pack-Version …", None);
    let t = load_target(&state, source, &pid, version_id.as_deref()).await?;
    let origin = NewOrigin { source: Some(source), project_id: Some(pid), version_id: Some(t.version.id.clone()), remote: None, remote_hash: None };
    apply_target(state, task, inst, rec, legacy, t, origin).await
}

pub(crate) struct NewOrigin {
    pub(crate) source: Option<Source>,
    pub(crate) project_id: Option<String>,
    pub(crate) version_id: Option<String>,
    pub(crate) remote: Option<String>,
    pub(crate) remote_hash: Option<String>,
}

pub(crate) async fn apply_target(state: AppState, task: TaskHandle, inst: Instance, rec: PackRecord, legacy: bool, t: Target, origin: NewOrigin) -> AppResult<()> {
    let instance_id = inst.id.clone();
    task.set_title(format!("{} auf {} aktualisieren", inst.name, t.version.version_number));
    task.check()?;
    task.stage("Sicherung wird erstellt …", None);
    let snap_name = format!("Vor Modpack-Update {} → {}", rec.version_number.clone().unwrap_or_else(|| "?".into()), t.version.version_number);
    if let Err(e) = crate::content::snapshots::create(&state, &instance_id, &snap_name, true, None).await {
        return Err(AppError::msg(format!("Sicherung vor dem Update fehlgeschlagen: {e}")));
    }
    task.check()?;
    let st = state.clone();
    let inst2 = inst.clone();
    let rec2 = rec.clone();
    let (d, t) = tokio::task::spawn_blocking(move || {
        let d = diff(&st, &inst2, &rec2, legacy, &t);
        (d, t)
    })
    .await?;
    let game = state.paths.game_dir(&instance_id);

    // Downloads (deaktivierte Dateien bleiben deaktiviert)
    let mut items = Vec::new();
    for (f, old) in &d.add_or_update {
        let rel = norm_rel(&f.path);
        let disabled = old.as_ref().is_some_and(|o| exists_any(&game, index::strip_disabled(o)).is_some_and(|x| x.ends_with(".disabled")));
        let target_rel = if disabled { format!("{rel}.disabled") } else { rel.clone() };
        let path = safe_join(&game, &target_rel).ok_or_else(|| AppError::Invalid(format!("Unzulässiger Pfad: {rel}")))?;
        items.push(DownloadItem::new(f.url.clone(), path).sha1(f.sha1.clone()).size(f.size));
    }
    task.stage(format!("Lade {} Datei(en) …", items.len()), Some(0.1));
    state.net.download_all(items, Some(&task.sub(0.1, 0.85))).await?;
    task.check()?;

    // Alte Dateien entfernen (ersetzt / nicht mehr im Pack)
    let mut to_remove: Vec<String> = d.removed.clone();
    for (f, old) in &d.add_or_update {
        if let Some(o) = old {
            let o = index::strip_disabled(o).to_string();
            if o != norm_rel(&f.path) {
                to_remove.push(o);
            }
        }
    }
    for rel in &to_remove {
        for r in [rel.clone(), format!("{rel}.disabled")] {
            if let Some(p) = safe_join(&game, &r).filter(|p| p.is_file()) {
                let _ = tokio::fs::remove_file(p).await;
            }
        }
    }

    // Overrides
    task.stage("Konfigurationen werden aktualisiert …", Some(0.9));
    let write: HashSet<String> = d.overrides.iter().filter(|o| o.status == "new" || o.status == "update").map(|o| o.path.clone()).collect();
    let conflicts: Vec<String> = d.overrides.iter().filter(|o| o.status == "conflict").map(|o| o.path.clone()).collect();
    if !write.is_empty() {
        let zp = t.zip.clone();
        let prefixes = t.plan.overrides.clone();
        let gd = game.clone();
        tokio::task::spawn_blocking(move || import::extract_overrides_only(&zp, &prefixes, &gd, Some(&write), &|_| Ok(()))).await??;
    }
    for o in d.overrides.iter().filter(|o| o.status == "remove") {
        if let Some(p) = safe_join(&game, &o.path) {
            let _ = tokio::fs::remove_file(p).await;
        }
    }

    // Index
    {
        let lock = state.content.lock(&instance_id);
        let _g = lock.lock().await;
        let mut idx = ContentIndex::load(&state.paths, &instance_id);
        for rel in &to_remove {
            if let Some((folder, file)) = rel.split_once('/') {
                idx.files.remove(&index::key(folder, file));
            }
        }
        for (f, _) in &d.add_or_update {
            if let Some((k, e)) = index_entry(f) {
                idx.files.insert(k, e);
            }
        }
        idx.save(&state.paths, &instance_id)?;
    }
    missing::add(&state.paths, &instance_id, t.missing.clone())?;

    // Instanz: Version/Loader mitziehen, Herkunft aktualisieren
    let new_mc = t.plan.mc_version.clone();
    let new_loader = t.plan.loader.clone();
    let vnum = t.version.version_number.clone();
    let vid = origin.version_id.clone();
    let pack_name = t.plan.name.clone();
    let remote = origin.remote.clone();
    state.instances.modify(&instance_id, |i| {
        i.mc_version = new_mc.clone();
        i.loader = new_loader.clone();
        crate::content::modpack_from::apply_source(&mut i.source, remote.as_deref(), vid.clone(), &vnum, &pack_name);
    })?;

    // Neuer Stand
    let rec_new = PackRecord {
        source: origin.source,
        project_id: origin.project_id.clone(),
        version_id: origin.version_id.clone(),
        version_number: Some(t.version.version_number.clone()),
        mc_version: t.plan.mc_version.clone(),
        loader: Some(t.plan.loader.clone()),
        files: t.files.iter().map(|f| (norm_rel(&f.path), RecFile { sha1: f.sha1.clone(), project: proj_key(&f.origin) })).collect(),
        overrides: t.overrides.iter().map(|(k, (h, _))| (k.clone(), h.clone())).collect(),
        installed_at: crate::util::now_ms(),
        remote: origin.remote.clone(),
        remote_hash: origin.remote_hash.clone(),
    };
    crate::util::write_json_atomic(&record_path(&state, &instance_id), &rec_new)?;
    state.content.update_counts.lock().remove(&instance_id);
    state.content.emit_changed(&instance_id);

    let updated = d.add_or_update.iter().filter(|(_, o)| o.is_some()).count();
    let added = d.add_or_update.len() - updated;
    let mut msg = format!("{updated} aktualisiert, {added} neu, {} entfernt", d.removed.len());
    if !conflicts.is_empty() {
        msg.push_str(&format!(" – {} geänderte Config(s) behalten", conflicts.len()));
        tracing::info!("Modpack-Update {instance_id}: Nutzer-Versionen behalten: {}", conflicts.join(", "));
    }
    task.message(msg);
    Ok(())
}
