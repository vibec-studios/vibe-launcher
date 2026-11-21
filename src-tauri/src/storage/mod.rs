pub mod cleanup;
pub mod commands;
pub mod dedup;
pub mod fastcache;
pub mod links;
pub mod maintenance;
pub mod store;
pub mod usage;
pub mod vibey;

use crate::state::AppState;

pub fn after_instance_delete(state: &AppState, id: &str) {
    let paths = state.paths.clone();
    let id = id.to_string();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = crate::content::snapshots::drop_instance(&paths, &id).await {
            tracing::warn!("Snapshots der gelöschten Instanz {id} nicht entfernt: {e}");
        }
        let root = paths.root.clone();
        let _ = tokio::task::spawn_blocking(move || store::gc(&root)).await;
    });
}

pub fn adopt_instance(state: &AppState, id: &str) {
    let data = state.paths.root.clone();
    let game = state.paths.game_dir(id);
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();
        dedup::instance_files(&game, &mut files);
        for c in files {
            let _ = store::adopt(&data, c.path(), None);
        }
    });
}

#[cfg(test)]
pub(crate) fn test_dir(tag: &str) -> std::path::PathBuf {
    let p = std::env::temp_dir().join(format!("vl-storage-{tag}-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&p).unwrap();
    p
}
