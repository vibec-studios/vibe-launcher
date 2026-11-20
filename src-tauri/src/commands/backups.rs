//! Instanz-Snapshots und Welt-Backups (`content::snapshots`, `content::worldbackup`).
use crate::content::snapshots::{self, SnapshotInfo};
use crate::content::worldbackup::{self, WorldBackup};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::State;

fn not_running(state: &AppState, instance_id: &str) -> AppResult<()> {
    if state.game.is_running(instance_id) {
        return Err(AppError::Invalid("Die Instanz läuft gerade – bitte zuerst das Spiel beenden.".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn snapshots_list(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<SnapshotInfo>> {
    snapshots::list(&state, &instance_id).await
}

/// Snapshot anlegen (Name optional). Gibt die Task-ID zurück.
#[tauri::command]
pub async fn snapshot_create(state: State<'_, AppState>, instance_id: String, name: Option<String>) -> AppResult<String> {
    state.instances.get(&instance_id)?;
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("backup", "Snapshot erstellen", Some(instance_id), move |task| async move {
        snapshots::create(&st, &iid, name.as_deref().unwrap_or(""), false, Some(&task.sub(0.0, 1.0))).await?;
        st.content.emit_changed(&iid);
        Ok(())
    }))
}

#[tauri::command]
pub async fn snapshot_restore(state: State<'_, AppState>, instance_id: String, snapshot_id: String) -> AppResult<String> {
    state.instances.get(&instance_id)?;
    not_running(&state, &instance_id)?;
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("backup", "Snapshot wiederherstellen", Some(instance_id), move |task| async move {
        snapshots::restore(&st, &iid, &snapshot_id, Some(&task.sub(0.0, 1.0))).await
    }))
}

#[tauri::command]
pub async fn snapshot_delete(state: State<'_, AppState>, instance_id: String, snapshot_id: String) -> AppResult<()> {
    snapshots::delete(&state, &instance_id, &snapshot_id).await
}

/// Alle Welt-Backups einer Instanz, neueste zuerst.
#[tauri::command]
pub async fn world_backups_list(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<WorldBackup>> {
    worldbackup::list(&state, &instance_id).await
}

#[tauri::command]
pub async fn world_backup_create(state: State<'_, AppState>, instance_id: String, folder: String) -> AppResult<String> {
    state.instances.get(&instance_id)?;
    if let Some(dir) = crate::util::safe_join(&state.paths.game_dir(&instance_id).join("saves"), &folder) {
        crate::util::spacecheck::for_world_backup(&state.paths, dir).await?;
    }
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("backup", format!("Welt sichern: {folder}"), Some(instance_id), move |task| async move {
        worldbackup::create(&st, &iid, &folder, Some(&task.sub(0.0, 1.0))).await.map(|_| ())
    }))
}

#[tauri::command]
pub async fn world_backup_restore(state: State<'_, AppState>, instance_id: String, backup_id: String) -> AppResult<String> {
    state.instances.get(&instance_id)?;
    not_running(&state, &instance_id)?;
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("backup", "Welt wiederherstellen", Some(instance_id), move |task| async move {
        worldbackup::restore(&st, &iid, &backup_id, Some(&task.sub(0.0, 1.0))).await
    }))
}

#[tauri::command]
pub async fn world_backup_delete(state: State<'_, AppState>, instance_id: String, backup_id: String) -> AppResult<()> {
    worldbackup::delete(&state, &instance_id, &backup_id).await
}

/// Welt in eine andere Instanz kopieren (eindeutiger Ordnername im Ziel). Gibt die Task-ID zurück.
#[tauri::command]
pub async fn world_copy(state: State<'_, AppState>, instance_id: String, folder: String, target_instance_id: String) -> AppResult<String> {
    state.instances.get(&instance_id)?;
    let target = state.instances.get(&target_instance_id)?;
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("backup", format!("Welt kopieren nach {}", target.name), Some(target_instance_id.clone()), move |task| async move {
        worldbackup::copy(&st, &iid, &folder, &target_instance_id, Some(&task.sub(0.0, 1.0))).await.map(|_| ())
    }))
}

/// Welt aus einer ZIP-Datei importieren. Gibt die Task-ID zurück.
#[tauri::command]
pub async fn world_import_zip(state: State<'_, AppState>, instance_id: String, path: String) -> AppResult<String> {
    state.instances.get(&instance_id)?;
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("backup", "Welt importieren", Some(instance_id), move |task| async move {
        worldbackup::import_zip(&st, &iid, std::path::Path::new(&path), Some(&task.sub(0.0, 1.0))).await.map(|_| ())
    }))
}

/// Backup-Ordner der Instanz im Explorer öffnen (`kind`: "worlds" | "snapshots").
#[tauri::command]
pub async fn backups_open_folder(state: State<'_, AppState>, instance_id: String, kind: String) -> AppResult<()> {
    state.instances.get(&instance_id)?;
    let sub = match kind.as_str() {
        "worlds" => "worlds",
        "snapshots" => "snapshots",
        _ => return Err(AppError::Invalid(format!("Unbekannter Ordner: {kind}"))),
    };
    let dir = snapshots::backups_root(&state.paths).join(sub).join(&instance_id);
    std::fs::create_dir_all(&dir)?;
    crate::util::open_in_explorer(&dir)
}
