use super::*;

// ------------------------------------------------------------------ Öffentliche API

/// Eine Welt-Operation je Instanz zur Zeit genügt – global gesperrt (einfach, Welten sind groß).
pub(super) static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(super) fn not_running(state: &AppState, instance_id: &str) -> AppResult<()> {
    if state.game.is_running(instance_id) {
        return Err(AppError::Invalid("Die Instanz läuft gerade – bitte zuerst das Spiel beenden.".into()));
    }
    Ok(())
}

pub async fn create(state: &AppState, instance_id: &str, folder: &str, progress: Option<&crate::tasks::SubProgress>) -> AppResult<WorldBackup> {
    state.instances.get(instance_id)?;
    check_folder(folder)?;
    let _g = LOCK.lock().await;
    let (paths, iid, f, prog) = (state.paths.clone(), instance_id.to_string(), folder.to_string(), Progress::from(progress));
    let b = tokio::task::spawn_blocking(move || backup_sync(&paths, &iid, &f, false, &prog)).await??;
    state.content.emit_changed(instance_id);
    Ok(b)
}

pub async fn list(state: &AppState, instance_id: &str) -> AppResult<Vec<WorldBackup>> {
    state.instances.get(instance_id)?;
    let (paths, iid) = (state.paths.clone(), instance_id.to_string());
    Ok(tokio::task::spawn_blocking(move || list_sync(&paths, &iid)).await?)
}

pub async fn restore(state: &AppState, instance_id: &str, backup_id: &str, progress: Option<&crate::tasks::SubProgress>) -> AppResult<()> {
    state.instances.get(instance_id)?;
    parse_id(backup_id)?;
    not_running(state, instance_id)?;
    let _g = LOCK.lock().await;
    let keep = state.settings().world_backups_keep;
    let (paths, iid, id, prog) = (state.paths.clone(), instance_id.to_string(), backup_id.to_string(), Progress::from(progress));
    let res = tokio::task::spawn_blocking(move || restore_sync(&paths, &iid, &id, keep, &prog)).await?;
    state.content.emit_changed(instance_id);
    res
}

pub async fn delete(state: &AppState, instance_id: &str, backup_id: &str) -> AppResult<()> {
    if !valid_name(instance_id) {
        return Err(AppError::NotFound("Welt-Backup".into()));
    }
    let _g = LOCK.lock().await;
    let (paths, iid, id) = (state.paths.clone(), instance_id.to_string(), backup_id.to_string());
    tokio::task::spawn_blocking(move || delete_sync(&paths, &iid, &id)).await??;
    state.content.emit_changed(instance_id);
    Ok(())
}

/// Welt in eine andere (oder dieselbe) Instanz kopieren. Gibt den neuen Ordnernamen zurück.
pub async fn copy(state: &AppState, instance_id: &str, folder: &str, target_id: &str, progress: Option<&crate::tasks::SubProgress>) -> AppResult<String> {
    state.instances.get(instance_id)?;
    state.instances.get(target_id)?;
    check_folder(folder)?;
    let (paths, iid, f, tid, prog) = (state.paths.clone(), instance_id.to_string(), folder.to_string(), target_id.to_string(), Progress::from(progress));
    let name = tokio::task::spawn_blocking(move || copy_sync(&paths, &iid, &f, &tid, &prog)).await??;
    state.content.emit_changed(target_id);
    Ok(name)
}

/// Welt aus einer ZIP importieren. Gibt den neuen Ordnernamen zurück.
pub async fn import_zip(state: &AppState, instance_id: &str, path: &Path, progress: Option<&crate::tasks::SubProgress>) -> AppResult<String> {
    state.instances.get(instance_id)?;
    let (paths, iid, p, prog) = (state.paths.clone(), instance_id.to_string(), path.to_path_buf(), Progress::from(progress));
    let name = tokio::task::spawn_blocking(move || import_sync(&paths, &iid, &p, &prog)).await??;
    state.content.emit_changed(instance_id);
    Ok(name)
}

/// Vor dem Spielstart: geänderte Welten sichern, wenn `world_backup_on_launch` an ist. Lässt den
/// Start nie scheitern – Probleme landen im Spiel-Log.
pub async fn before_launch(state: &AppState, instance_id: &str, task: &crate::tasks::TaskHandle) {
    let settings = state.settings();
    if !settings.world_backup_on_launch {
        return;
    }
    let log = |msg: String| state.game.launcher_line(instance_id, crate::minecraft::LogLevel::Launcher, msg);
    let _g = LOCK.lock().await;
    let (paths, iid) = (state.paths.clone(), instance_id.to_string());
    let todo = match tokio::task::spawn_blocking(move || changed_worlds(&paths, &iid)).await {
        Ok(v) => v,
        Err(e) => return log(format!("Welt-Backup übersprungen: {e}")),
    };
    if todo.is_empty() {
        log("Welt-Backup: keine geänderten Welten".into());
        return;
    }
    task.stage("Welten werden gesichert …", Some(0.0));
    task.set_step(Some(crate::minecraft::prelaunch::STEP_WORLD_BACKUP));
    let n = todo.len();
    let mut any = false;
    for (i, folder) in todo.into_iter().enumerate() {
        let prog = Progress(Some(task.sub(i as f64 / n as f64, (i + 1) as f64 / n as f64)));
        if let Err(e) = crate::util::spacecheck::for_world_backup(&state.paths, saves(&state.paths, instance_id).join(&folder)).await {
            log(format!("Welt-Backup übersprungen: {e}"));
            break;
        }
        let (paths, iid, f, keep) = (state.paths.clone(), instance_id.to_string(), folder.clone(), settings.world_backups_keep);
        let res = tokio::task::spawn_blocking(move || {
            let b = backup_sync(&paths, &iid, &f, true, &prog)?;
            prune(&paths, &iid, &f, keep, &[]);
            Ok::<_, AppError>(b)
        })
        .await;
        match res {
            Ok(Ok(b)) => {
                any = true;
                log(format!("Welt-Backup: „{}“ gesichert ({})", b.world_name, size_text(b.size)));
            }
            Ok(Err(AppError::Cancelled)) => {
                log("Welt-Backup abgebrochen".into());
                break;
            }
            Ok(Err(e)) => log(format!("Welt-Backup von {folder} fehlgeschlagen: {e}")),
            Err(e) => log(format!("Welt-Backup von {folder} fehlgeschlagen: {e}")),
        }
    }
    task.set_step(None);
    if any {
        state.content.emit_changed(instance_id);
    }
}
