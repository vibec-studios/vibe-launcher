use super::Restore;
use tauri::AppHandle;

#[tauri::command]
pub fn lean_handoff(app: AppHandle, route: Option<String>) {
    super::set_route(&app, route);
    super::finish(&app);
}

#[tauri::command]
pub fn lean_restore_take(app: AppHandle) -> Option<Restore> {
    super::take_restore(&app)
}

#[tauri::command]
pub fn lean_dev_session(
    state: tauri::State<'_, crate::state::AppState>,
    instance_id: String,
    running: bool,
    stop_after_ms: Option<u64>,
    crash: Option<bool>,
) -> crate::error::AppResult<Option<String>> {
    if !cfg!(debug_assertions) {
        return Err(crate::error::AppError::Invalid("Nur in Test-Builds".into()));
    }
    if running {
        let run = state.game.begin(&instance_id)?;
        state.game.mark_running(&run, None, crate::util::now_ms());
        if let Some(ms) = stop_after_ms {
            let game = state.game.clone();
            let key = run.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(ms));
                game.mark_stopped(&key, crash.unwrap_or(false), "Test-Sitzung beendet.".into());
            });
        }
        return Ok(Some(run));
    }
    for run in state.game.active_runs(&instance_id) {
        state.game.mark_stopped(&run, false, "Test-Sitzung beendet.".into());
    }
    Ok(None)
}
