use super::*;

// ------------------------------------------------------------------ 3. Ausführen

pub(super) fn save_report(state: &AppState, instance_id: &str, r: &FixReport) -> AppResult<()> {
    crate::util::write_json_atomic(&report_path(state, instance_id), r)
}

/// Kurze deutsche Zusammenfassung für die Aufgabenliste.
pub(super) fn summary(r: &FixReport) -> String {
    let ok = r.results.iter().filter(|x| x.ok).count();
    let failed = r.results.len() - ok;
    let mut s = format!("{ok} Problem(e) behoben");
    if failed > 0 {
        s.push_str(&format!(", {failed} fehlgeschlagen"));
    }
    if !r.manual.is_empty() {
        s.push_str(&format!(", {} manuell herunterzuladen", r.manual.len()));
    }
    s
}

/// Reihenfolge: deaktivieren/aktivieren, dann tauschen/installieren, Java/RAM, zuletzt der Loader.
pub fn order(actions: &mut [FixAction]) {
    let rank = |a: &FixAction| match a {
        FixAction::Disable { .. } => 0,
        FixAction::Enable { .. } => 1,
        FixAction::ResetConfig { .. } => 1,
        FixAction::Replace { .. } => 2,
        FixAction::Install { .. } => 3,
        FixAction::SetJava { .. } => 4,
        FixAction::SetRam { .. } => 5,
        // Zuletzt: Installation braucht die gewählte Java-Version (Forge-Installer)
        FixAction::SetLoader { .. } => 6,
        FixAction::RepairLoader { .. } => 7,
    };
    actions.sort_by_key(rank);
}

/// `backup`: gewünschte Sicherung (sonst `Settings.fix_backup`).
pub async fn run_apply(state: AppState, task: TaskHandle, instance_id: String, mut actions: Vec<FixAction>, backup: Option<crate::settings::FixBackup>) -> AppResult<()> {
    let inst = state.instances.get(&instance_id)?;
    if state.game.is_running(&instance_id) {
        return Err(AppError::Invalid("Die Instanz läuft gerade – bitte zuerst das Spiel beenden.".into()));
    }
    if actions.is_empty() {
        return Ok(());
    }
    order(&mut actions);
    // Sicherung zuerst (Bereiche laut Einstellung). Schlägt sie fehl, wird nichts verändert. Bei „Gar keine“
    // lässt sich hinterher nur Java/RAM/Loader zurückstellen.
    let backup = backup.unwrap_or_else(|| state.settings().fix_backup);
    let scopes = snapshots::fix_backup_scopes(&backup);
    let snap = match &scopes {
        Some(sc) => {
            task.stage("Sicherung wird erstellt …", Some(0.0));
            Some(snapshots::create_scoped(&state, &instance_id, SNAPSHOT_NAME, true, sc, Some(&task.sub(0.0, 0.25))).await?)
        }
        None => None,
    };
    task.check()?;
    let mut report = FixReport {
        created: crate::util::now_ms(),
        snapshot_scopes: snap.as_ref().and_then(|s| s.scopes.clone()),
        snapshot_id: snap.map(|s| s.id),
        results: vec![],
        manual: vec![],
        prev_java: None,
        prev_loader: None,
        config_backups: vec![],
        undone: false,
    };
    let stamp = crate::util::now_ms();
    let n = actions.len().max(1) as f64;
    let mut java = inst.java.clone();
    let mut java_changed = false;
    for (i, a) in actions.into_iter().enumerate() {
        let from = 0.25 + 0.7 * i as f64 / n;
        let to = 0.25 + 0.7 * (i + 1) as f64 / n;
        let res: AppResult<()> = async {
            match &a {
                FixAction::Disable { file_name } => {
                    task.stage(format!("Deaktiviere {} …", display_name(file_name)), Some(from));
                    if file_name.ends_with(".disabled") {
                        return Ok(());
                    }
                    local::set_enabled(&state, &instance_id, ContentKind::Mod, file_name, false).await.map(|_| ())
                }
                FixAction::Enable { file_name } => {
                    task.stage(format!("Aktiviere {} …", display_name(file_name)), Some(from));
                    local::set_enabled(&state, &instance_id, ContentKind::Mod, file_name, true).await.map(|_| ())
                }
                FixAction::Replace { source, project_id, version_id, title, .. } => {
                    task.stage(format!("{title} wird getauscht …"), Some(from));
                    let m = install_one(&state, &inst, *source, project_id, Some(version_id.clone()), &task, from, to).await?;
                    report.manual.extend(m);
                    Ok(())
                }
                FixAction::Install { source, project_id, title } => {
                    task.stage(format!("{title} wird installiert …"), Some(from));
                    let m = install_one(&state, &inst, *source, project_id, None, &task, from, to).await?;
                    report.manual.extend(m);
                    Ok(())
                }
                FixAction::SetJava { major, path } => {
                    let p = match path.clone().filter(|p| std::path::Path::new(p).exists()) {
                        Some(p) => p,
                        None => {
                            task.stage(format!("Java {major} wird heruntergeladen …"), Some(from));
                            crate::minecraft::java::install_major(&state, *major, Some(&task.sub(from, to))).await?.to_string_lossy().into_owned()
                        }
                    };
                    java.path = Some(p);
                    java_changed = true;
                    state.instances.patch(&instance_id, InstancePatch { java: Some(java.clone()), ..Default::default() })?;
                    Ok(())
                }
                FixAction::SetRam { mb } => {
                    java.max_memory_mb = Some(*mb);
                    java.min_memory_mb = Some(java.min_memory_mb.unwrap_or(512).min(*mb));
                    java_changed = true;
                    state.instances.patch(&instance_id, InstancePatch { java: Some(java.clone()), ..Default::default() })?;
                    Ok(())
                }
                FixAction::SetLoader { loader, to: target, .. } => {
                    let cur = state.instances.get(&instance_id)?;
                    if cur.loader.kind != *loader {
                        return Err(AppError::Invalid("Der Loader der Instanz wurde inzwischen geändert".into()));
                    }
                    let name = crate::minecraft::loaders::loader_name(*loader);
                    task.stage(format!("{name} {target} wird installiert …"), Some(from));
                    let prev = cur.loader.clone();
                    state.instances.modify(&instance_id, |i| i.loader.version = Some(target.clone()))?;
                    match crate::minecraft::install_instance_opts(&state, &instance_id, &task.sub(from, to), false).await {
                        Ok(_) => {
                            report.prev_loader.get_or_insert(prev);
                            Ok(())
                        }
                        Err(e) => {
                            // Nicht halb umgestellt zurücklassen: alte Version bleibt eingestellt
                            let _ = state.instances.modify(&instance_id, |i| i.loader = prev);
                            Err(e)
                        }
                    }
                }
                FixAction::ResetConfig { path } => {
                    task.stage(format!("Setze {path} zurück …"), Some(from));
                    let b = reset_config(&state, &instance_id, path, stamp)?;
                    report.config_backups.push(b);
                    Ok(())
                }
                FixAction::RepairLoader { loader, .. } => {
                    let cur = state.instances.get(&instance_id)?;
                    if cur.loader.kind != *loader {
                        return Err(AppError::Invalid("Der Loader der Instanz wurde inzwischen geändert".into()));
                    }
                    let name = crate::minecraft::loaders::loader_name(*loader);
                    task.stage(format!("{name} wird neu installiert …"), Some(from));
                    crate::minecraft::install_instance_opts(&state, &instance_id, &task.sub(from, to), true).await.map(|_| ())
                }
            }
        }
        .await;
        if matches!(res, Err(AppError::Cancelled)) {
            if java_changed {
                report.prev_java = Some(inst.java.clone());
            }
            save_report(&state, &instance_id, &report)?;
            return Err(AppError::Cancelled);
        }
        if let Err(e) = &res {
            tracing::warn!("Autofix {instance_id}: {a:?} fehlgeschlagen: {e}");
        }
        report.results.push(StepResult { ok: res.is_ok(), error: res.err().map(|e| e.to_string()), action: a });
    }
    if java_changed {
        report.prev_java = Some(inst.java.clone());
    }
    if !report.manual.is_empty() {
        missing::watch(&state, &instance_id, missing::WATCH_FOR);
    }
    save_report(&state, &instance_id, &report)?;
    state.content.emit_changed(&instance_id);
    task.message(summary(&report));
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn install_one(
    state: &AppState,
    inst: &Instance,
    source: Source,
    project_id: &str,
    version_id: Option<String>,
    task: &TaskHandle,
    from: f64,
    to: f64,
) -> AppResult<Vec<MissingDownload>> {
    if source == Source::Curseforge {
        crate::content::curseforge::key(state)?;
    }
    let (_, idx) = local::refresh(state, &inst.id, ContentKind::Mod).await?;
    let mut warnings = vec![];
    let planned = install::plan(state, inst, &idx, vec![(source, project_id.to_string(), version_id)], &mut warnings).await?;
    for w in &warnings {
        tracing::warn!("Autofix {}: {w}", inst.id);
    }
    install::apply(state, inst, planned, &task.sub(from, to)).await
}
