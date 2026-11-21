use super::*;

// ------------------------------------------------------------------ 4. Rückgängig

/// Lässt sich etwas zurückstellen? Ohne Sicherung nur Java/RAM, Loader, Configs und vorgemerkte Downloads.
pub fn can_undo(r: &FixReport) -> bool {
    r.snapshot_id.is_some() || r.prev_java.is_some() || r.prev_loader.is_some() || !r.manual.is_empty() || !r.config_backups.is_empty()
}

/// Config-Datei der Instanz (nur unter `config/`, ohne `..`).
pub(super) fn config_file(state: &AppState, instance_id: &str, rel: &str) -> Option<std::path::PathBuf> {
    let rel = rel.replace('\\', "/");
    let inner = rel.strip_prefix("config/")?;
    if inner.is_empty() || inner.split('/').any(|p| p.is_empty() || p == ".." || p == "." || p.contains(':')) {
        return None;
    }
    Some(state.paths.game_dir(instance_id).join("config").join(inner))
}

pub(super) fn config_backup_dir(state: &AppState, instance_id: &str, stamp: i64) -> std::path::PathBuf {
    state.paths.instance_dir(instance_id).join("autofix-config").join(stamp.to_string())
}

/// Nur diese eine Datei sichern (unter `instances/<id>/autofix-config/<zeit>/`) und entfernen – die Mod legt sie mit
/// Standardwerten neu an.
pub(super) fn reset_config(state: &AppState, instance_id: &str, rel: &str, stamp: i64) -> AppResult<ConfigBackup> {
    let src = config_file(state, instance_id, rel).ok_or_else(|| AppError::Invalid(format!("Ungültiger Config-Pfad: {rel}")))?;
    if !src.is_file() {
        return Err(AppError::NotFound(format!("{rel} gibt es nicht mehr")));
    }
    let dst = config_backup_dir(state, instance_id, stamp).join(rel.replace('\\', "/"));
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(&src, &dst)?;
    std::fs::remove_file(&src)?;
    Ok(ConfigBackup { path: rel.to_string(), backup: dst.to_string_lossy().into_owned() })
}

pub(super) fn restore_configs(state: &AppState, instance_id: &str, list: &[ConfigBackup]) -> AppResult<()> {
    let root = state.paths.instance_dir(instance_id).join("autofix-config");
    for b in list {
        let (Some(dst), backup) = (config_file(state, instance_id, &b.path), std::path::PathBuf::from(&b.backup)) else { continue };
        // Nur Sicherungen aus dem eigenen Ordner zurückspielen
        if !backup.starts_with(&root) || !backup.is_file() {
            continue;
        }
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(&backup, &dst)?;
    }
    Ok(())
}

pub async fn run_undo(state: AppState, task: TaskHandle, instance_id: String) -> AppResult<()> {
    let mut r = last_report(&state, &instance_id).ok_or_else(|| AppError::NotFound("Kein Durchlauf von „Probleme beheben“".into()))?;
    if r.undone {
        return Err(AppError::Invalid("Wurde bereits rückgängig gemacht".into()));
    }
    if !can_undo(&r) {
        return Err(AppError::Invalid("Ohne Sicherung lässt sich dieser Durchlauf nicht rückgängig machen".into()));
    }
    if let Some(s) = &r.snapshot_id {
        task.stage("Stand vor dem Beheben wird wiederhergestellt …", Some(0.0));
        snapshots::restore(&state, &instance_id, s, Some(&task.sub(0.0, 0.95))).await?;
    }
    // Nach dem Snapshot: zurückgesetzte Configs wiederherstellen (auch wenn der Snapshot keine Configs enthielt)
    restore_configs(&state, &instance_id, &r.config_backups)?;
    if let Some(j) = r.prev_java.clone() {
        state.instances.patch(&instance_id, InstancePatch { java: Some(j), ..Default::default() })?;
    }
    if let Some(l) = r.prev_loader.clone() {
        // Alte Loader-Version wieder einstellen; deren Dateien sind noch da, der nächste Start prüft sie
        state.instances.modify(&instance_id, |i| {
            if i.loader.kind == l.kind {
                i.loader = l;
            }
        })?;
    }
    if !r.manual.is_empty() {
        let files: Vec<String> = r.manual.iter().map(|m| m.file_name.clone()).collect();
        let lock = state.content.lock(&instance_id);
        let _g = lock.lock().await;
        missing::forget(&state.paths, &instance_id, &files)?;
    }
    r.undone = true;
    save_report(&state, &instance_id, &r)?;
    state.content.emit_changed(&instance_id);
    task.message("Rückgängig gemacht");
    Ok(())
}
