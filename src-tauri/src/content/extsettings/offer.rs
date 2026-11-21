use super::*;

// ------------------------------------------------------------------ Nachträglich übernehmen

/// Angebot für eine bereits importierte Instanz.
#[derive(Debug, Clone, Serialize)]
pub struct SettingsOffer {
    pub instance_id: String,
    pub instance_name: String,
    pub launcher: LauncherKind,
    pub launcher_name: String,
    pub source_path: String,
    pub changes: Vec<Change>,
    /// Ordner/Dateien der Quelle, die in Vibe fehlen oder in der Quelle neuer sind ([`crate::content::gamedata::scan`])
    pub data: Vec<DataEntry>,
    /// z. B. „Java 8 passt nicht zu Minecraft 1.21 – automatische Wahl“
    pub notes: Vec<String>,
}

/// Unterschiede der Extras (Spielzeit, Icon, Herkunft) – nur, wenn in Vibe noch nichts gesetzt ist.
pub(super) fn extra_changes(inst: &Instance, f: &Found) -> Vec<Change> {
    let mut out = Vec::new();
    let secs = f.info.play_time_secs.unwrap_or(0);
    if inst.play_time_secs == 0 && secs > 0 {
        out.push(Change { key: "playtime".into(), old: json!({ "secs": 0, "last_played": inst.last_played }), new: json!({ "secs": secs, "last_played": f.info.last_played }), default_on: true, inherited: false });
    }
    if inst.icon.is_none() && f.icon_path.as_ref().is_some_and(|p| p.is_file()) {
        out.push(Change { key: "icon".into(), old: Value::Null, new: json!(f.info.icon), default_on: true, inherited: false });
    }
    let has_pack = inst.source.as_ref().is_some_and(|s| s.project_id.is_some());
    if let Some(p) = f.pack.as_ref().filter(|p| p.project_id.is_some() && !has_pack) {
        out.push(Change { key: "pack".into(), old: json!(inst.source), new: json!(p), default_on: true, inherited: false });
    }
    out
}

pub(super) async fn build_offer(state: &AppState, inst: &Instance, mark: &external::ExternalMark, f: &Found) -> SettingsOffer {
    let vibe = state.settings();
    let kind = mark.launcher;
    let (s, note) = prepare(&vibe, &f.settings, &inst.mc_version, true).await;
    let mut changes = diff(inst, &s);
    changes.extend(extra_changes(inst, f));
    if let Some(plan) = mods_plan(state, mark, f).as_ref() {
        let m = crate::content::norisk::mods::missing(state, inst, plan).await;
        if !m.is_empty() {
            changes.push(Change { key: "mods".into(), old: json!([]), new: json!(m.names()), default_on: true, inherited: false });
        }
    }
    let (src, ov, dst, prior) = (f.game_dir.clone(), f.overlays.clone(), state.paths.game_dir(&inst.id), mark.prior());
    let data = tokio::task::spawn_blocking(move || gamedata::scan(&src, &ov, &dst, kind, &prior)).await.unwrap_or_default();
    SettingsOffer {
        instance_id: inst.id.clone(),
        instance_name: inst.name.clone(),
        launcher: kind,
        launcher_name: external::launcher_name(kind).to_string(),
        source_path: mark.source_path.clone(),
        changes,
        data,
        notes: note.into_iter().collect(),
    }
}

pub(super) fn mods_plan(state: &AppState, mark: &external::ExternalMark, f: &Found) -> Option<crate::content::norisk::Plan> {
    if mark.launcher == LauncherKind::Norisk {
        return f.norisk.clone();
    }
    Some(crate::content::extmods::plan(&f.game_dir, mark.imported_at, &external::icons_of(&state.paths.tmp()))).filter(|p| !p.jars.is_empty())
}

/// Alle importierten Instanzen, deren Quelle noch da ist und deren Einstellungen oder Daten abweichen.
pub async fn pending(state: &AppState) -> AppResult<Vec<SettingsOffer>> {
    let marks: Vec<(Instance, external::ExternalMark)> = state.instances.list().into_iter().filter_map(|i| external::read_mark(state, &i.id).map(|m| (i, m))).collect();
    if marks.is_empty() {
        return Ok(vec![]);
    }
    let tmp = state.paths.tmp();
    let reqs: Vec<(LauncherKind, String)> = marks.iter().map(|(_, m)| (m.launcher, m.source_path.clone())).collect();
    let found = tokio::task::spawn_blocking(move || external::describe_many(&reqs, &tmp)).await?;
    let mut out = Vec::new();
    for ((inst, mark), f) in marks.iter().zip(found) {
        let Some(f) = f else { continue };
        let o = build_offer(state, inst, mark, &f).await;
        if !o.changes.is_empty() || !o.data.is_empty() {
            out.push(o);
        }
    }
    Ok(out)
}

/// Angebot für eine Instanz (`None`: nicht importiert oder Quelle nicht mehr vorhanden).
pub async fn offer(state: &AppState, instance_id: &str) -> AppResult<Option<SettingsOffer>> {
    let inst = state.instances.get(instance_id)?;
    let Some(mark) = external::read_mark(state, instance_id) else { return Ok(None) };
    let tmp = state.paths.tmp();
    let req = vec![(mark.launcher, mark.source_path.clone())];
    let Some(f) = tokio::task::spawn_blocking(move || external::describe_many(&req, &tmp)).await?.pop().flatten() else { return Ok(None) };
    Ok(Some(build_offer(state, &inst, &mark, &f).await))
}

/// Nachträglich übernehmen (nur die Instanz-Daten, keine Dateien): Einstellungen + Extras (Spielzeit, Herkunft),
/// Extras nur, wenn sie wie angezeigt abweichen. Das Icon setzt [`apply_offer`] (Datei im Instanzordner).
pub fn apply_found(i: &mut Instance, s: &ExtSettings, f: &Found, keys: &HashSet<String>) {
    let extra = extra_changes(i, f);
    apply(i, s, keys);
    for c in extra.iter().filter(|c| keys.contains(&c.key)) {
        match c.key.as_str() {
            "playtime" => {
                i.play_time_secs = f.info.play_time_secs.unwrap_or(0);
                if i.last_played.is_none() {
                    i.last_played = f.info.last_played;
                }
            }
            "pack" => i.source = f.pack.clone(),
            _ => {}
        }
    }
}

/// Gewählte Werte übernehmen. `data`: Ordner/Dateien aus [`offer`] – ohne `overwrite` werden nur fehlende Dateien
/// hinzugefügt, mit `overwrite` auch neuere ersetzt (Welten komplett). Das Kopieren läuft als Aufgabe im
/// Hintergrund; vorher Snapshot (Configs/Packs/Optionen) bzw. Welt-Backup, andere ersetzte Dateien werden nach
/// `backups/reimport/<instanz>/<zeit>/` gesichert.
pub async fn apply_offer(state: &AppState, instance_id: &str, keys: Vec<String>, data: Vec<DataPick>) -> AppResult<Instance> {
    let inst = state.instances.get(instance_id)?;
    let mark = external::read_mark(state, instance_id).ok_or_else(|| AppError::Invalid("Diese Instanz wurde nicht aus einem anderen Launcher importiert".into()))?;
    let tmp = state.paths.tmp();
    let req = vec![(mark.launcher, mark.source_path.clone())];
    let f = tokio::task::spawn_blocking(move || external::describe_many(&req, &tmp))
        .await?
        .pop()
        .flatten()
        .ok_or_else(|| AppError::NotFound(format!("Die Instanz im {} ({})", external::launcher_name(mark.launcher), mark.source_path)))?;
    let keys: HashSet<String> = keys.into_iter().filter(|k| KEYS.contains(&k.as_str()) || EXTRA_KEYS.contains(&k.as_str())).collect();
    if !data.is_empty() && state.game.is_running(instance_id) {
        return Err(AppError::Invalid("Bitte beende zuerst das Spiel – Dateien werden nur bei geschlossenem Spiel übernommen.".into()));
    }
    let vibe = state.settings();
    let (s, _) = prepare(&vibe, &f.settings, &inst.mc_version, keys.contains("java")).await;
    let icon = keys.contains("icon") && extra_changes(&inst, &f).iter().any(|c| c.key == "icon");
    let mut updated = state.instances.modify(instance_id, |i| apply_found(i, &s, &f, &keys))?;
    if icon {
        if let Some(bytes) = f.icon_path.as_ref().and_then(|p| std::fs::read(p).ok()) {
            crate::content::import::set_icon_bytes(state, instance_id, &bytes).await?;
            updated = state.instances.get(instance_id)?;
        }
    }
    if keys.contains("mods") {
        if let Some(plan) = mods_plan(state, &mark, &f) {
            let (st, id) = (state.clone(), instance_id.to_string());
            let launcher = external::launcher_name(mark.launcher);
            state.tasks.spawn("import", format!("Mods aus {launcher} übernehmen"), Some(id.clone()), move |task| crate::content::norisk::mods::run_missing(st, task, id, plan, launcher));
        }
    }
    if !data.is_empty() {
        let (src, ov, dst, kind, prior) = (f.game_dir.clone(), f.overlays.clone(), state.paths.game_dir(instance_id), mark.launcher, mark.prior());
        let plan = tokio::task::spawn_blocking(move || gamedata::plan(&src, &ov, &dst, kind, &prior, &data)).await?;
        if !plan.is_empty() {
            let launcher = external::launcher_name(kind);
            let (st, id) = (state.clone(), instance_id.to_string());
            state.tasks.spawn("import", format!("Daten aus {launcher} übernehmen"), Some(id.clone()), move |task| copy_data(st, task, id, plan, launcher));
        }
    }
    Ok(updated)
}

/// Aufgabe: gewählte Daten kopieren (vorher Snapshot bzw. Welt-Backup).
pub(super) async fn copy_data(state: AppState, task: crate::tasks::TaskHandle, id: String, plan: gamedata::CopyPlan, launcher: &'static str) -> AppResult<()> {
    if state.game.is_running(&id) {
        return Err(AppError::Invalid("Bitte beende zuerst das Spiel – Dateien werden nur bei geschlossenem Spiel übernommen.".into()));
    }
    if plan.touches_snapshot() || plan.ops.iter().any(|o| o.replace) {
        task.stage("Lege Snapshot an …", Some(0.0));
        crate::content::snapshots::create(&state, &id, &format!("Vor Übernahme aus {launcher}"), false, None).await?;
    }
    for w in &plan.replace_worlds {
        task.stage(format!("Sichere Welt „{w}“ …"), Some(0.0));
        crate::content::worldbackup::create(&state, &id, w, None).await?;
    }
    let n_files = plan.ops.len();
    task.stage(if n_files == 1 { "Kopiere 1 Datei …".to_string() } else { format!("Kopiere {n_files} Dateien …") }, Some(0.0));
    let dst = state.paths.game_dir(&id);
    let keep = crate::content::snapshots::backups_root(&state.paths).join("reimport").join(&id).join(chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string());
    let total = plan.total().max(1);
    let content_lock = state.content.lock(&id);
    let _c = content_lock.lock().await;
    let (t2, k2) = (task.clone(), keep.clone());
    let n = tokio::task::spawn_blocking(move || gamedata::execute(&plan, &dst, &k2, |done| t2.progress(done as f64 / total as f64), || t2.check())).await??;
    let mut msg = if n == 1 { format!("1 Datei aus {launcher} übernommen") } else { format!("{n} Dateien aus {launcher} übernommen") };
    if keep.is_dir() {
        msg.push_str(&format!(" · ersetzte Dateien gesichert in {}", keep.display()));
    }
    task.message(msg);
    state.content.emit_changed(&id);
    Ok(())
}
