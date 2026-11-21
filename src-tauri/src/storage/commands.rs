use super::{cleanup, dedup, fastcache, store, usage, vibey};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use tauri::{Manager, State};

fn running(state: &AppState) -> HashSet<String> {
    state.instances.list().into_iter().map(|i| i.id).filter(|id| state.game.is_running(id)).collect()
}

fn webview_dir(state: &AppState) -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("WEBVIEW2_USER_DATA_FOLDER") {
        return Some(PathBuf::from(p));
    }
    state.app.path().app_local_data_dir().ok().map(|d| d.join("EBWebView"))
}

#[tauri::command]
pub async fn storage_usage(state: State<'_, AppState>) -> AppResult<usage::Usage> {
    let busy = running(&state);
    let metas: HashMap<String, usage::InstanceMeta> = state
        .instances
        .list()
        .into_iter()
        .map(|i| (i.id.clone(), usage::InstanceMeta { running: busy.contains(&i.id), name: i.name }))
        .collect();
    let data = state.paths.root.clone();
    let extra: Vec<(&'static str, PathBuf)> = webview_dir(&state).into_iter().map(|p| ("webview", p)).collect();
    Ok(tokio::task::spawn_blocking(move || usage::scan(&data, &metas, &extra)).await?)
}

#[tauri::command]
pub async fn storage_clean(state: State<'_, AppState>, category: String, instance_id: Option<String>, folder: Option<String>) -> AppResult<u64> {
    let data = state.paths.root.clone();
    let busy = running(&state);
    let live: HashSet<String> = state.instances.list().into_iter().map(|i| i.id).collect();
    let games: Vec<PathBuf> = live.iter().filter(|id| !busy.contains(*id)).map(|id| state.paths.game_dir(id)).collect();
    if category == "snapshots" {
        let orphans: Vec<String> = usage::orphan_dirs(&data.join("backups").join("snapshots"), &live)
            .into_iter()
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
            .collect();
        let before = cleanup::size_of(&data.join("backups"));
        for id in orphans {
            crate::content::snapshots::drop_instance(&state.paths, &id).await?;
        }
        let d = data.clone();
        tokio::task::spawn_blocking(move || store::gc(&d)).await?;
        return Ok(before.saturating_sub(cleanup::size_of(&data.join("backups"))));
    }
    let game = match (&instance_id, category.as_str()) {
        (Some(id), "folder") => {
            state.instances.get(id)?;
            if busy.contains(id) {
                return Err(AppError::Invalid("Die Instanz läuft gerade. Beende sie zuerst.".into()));
            }
            Some(state.paths.game_dir(id))
        }
        _ => None,
    };
    tokio::task::spawn_blocking(move || -> AppResult<u64> {
        Ok(match category.as_str() {
            "cache" => cleanup::clear_cache(&data),
            "launcher_logs" => cleanup::clear_launcher_logs(&data),
            "vibey" => vibey::clear(&data),
            "fast_cache" => fastcache::clear(&data, &busy),
            "instance_logs" => games.iter().map(|g| cleanup::clear_instance_logs(g)).sum(),
            "mod_caches" => games.iter().map(|g| cleanup::clear_mod_caches(g)).sum(),
            "orphan_world_backups" => usage::orphan_dirs(&data.join("backups").join("worlds"), &live).iter().map(|p| cleanup::remove(p)).sum(),
            "folder" => {
                let game = game.ok_or_else(|| AppError::Invalid("Instanz fehlt".into()))?;
                cleanup::clear_folder(&game, folder.as_deref().unwrap_or("")).map_err(AppError::Invalid)?
            }
            _ => return Err(AppError::Invalid("Unbekannte Kategorie".into())),
        })
    })
    .await?
}

#[tauri::command]
pub async fn storage_dedup(state: State<'_, AppState>) -> AppResult<String> {
    let st = state.inner().clone();
    Ok(state.tasks.spawn("storage", "Platz sparen", None, move |task| async move {
        let skip = running(&st);
        let data = st.paths.root.clone();
        task.stage("Gleiche Dateien werden gesucht …", Some(0.0));
        let t = task.clone();
        let report = tokio::task::spawn_blocking(move || {
            dedup::run(&data, &skip, &|p| {
                t.progress(p);
                !t.is_cancelled()
            })
        })
        .await?;
        let saved = report.before.saturating_sub(report.after);
        task.message(format!("{} Dateien zusammengelegt, {} MB frei", report.linked, saved / (1024 * 1024)));
        tracing::info!("Platz sparen: {report:?}");
        Ok(())
    }))
}
