use crate::error::{AppError, AppResult};

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
