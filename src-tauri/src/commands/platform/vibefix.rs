use super::*;

#[tauri::command]
pub async fn crash_analysis(
    state: State<'_, AppState>,
    instance_id: String,
    crash_report: Option<String>,
    exit_code: Option<i32>,
) -> AppResult<crash::CrashAnalysis> {
    crash::analyze_instance_full(&state, &instance_id, crash_report, exit_code).await
}

#[tauri::command]
pub async fn vibefix_status(state: State<'_, AppState>) -> AppResult<crate::vibefix::VibeFixStatus> {
    Ok(crate::vibefix::status(&state))
}
