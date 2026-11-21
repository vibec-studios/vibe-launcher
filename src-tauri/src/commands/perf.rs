use crate::error::{AppError, AppResult};
use crate::content::quick_mod::{self, QuickMod, QuickModStatus};
use crate::minecraft::resources;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn game_resources(state: State<'_, AppState>) -> AppResult<Vec<resources::RunResources>> {
    let game = state.game.clone();
    tokio::task::spawn_blocking(move || resources::sample(&game))
        .await
        .map_err(|e| AppError::msg(e.to_string()))
}

#[tauri::command]
pub async fn quick_mod_status(state: State<'_, AppState>, instance_id: String, tool: QuickMod) -> AppResult<QuickModStatus> {
    let inst = state.instances.get(&instance_id)?;
    quick_mod::status(&state, &inst, tool).await
}

#[tauri::command]
pub async fn quick_mod_install(state: State<'_, AppState>, instance_id: String, tool: QuickMod) -> AppResult<String> {
    quick_mod::start(&state, instance_id, tool)
}

#[tauri::command]
pub async fn launch_skip_step(task_id: String) -> AppResult<()> {
    crate::minecraft::prelaunch::request_skip(&task_id);
    Ok(())
}

#[tauri::command]
pub async fn gpu_settings_open() -> AppResult<()> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe").arg("ms-settings:display-advancedgraphics").spawn().map_err(|e| AppError::msg(format!("Windows-Einstellungen nicht öffnbar: {e}")))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err(AppError::Invalid("Nur unter Windows verfügbar".into()))
    }
}
