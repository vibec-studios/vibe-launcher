use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "console";
pub const SELECT_EVENT: &str = "console://select";

fn url_for(run_id: Option<&str>) -> String {
    match run_id.filter(|r| is_safe_id(r)) {
        Some(r) => format!("console.html?run={r}"),
        None => "console.html".to_string(),
    }
}

fn is_safe_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn open(app: &AppHandle, run_id: Option<&str>) -> AppResult<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        if let Some(r) = run_id.filter(|r| is_safe_id(r)) {
            let _ = w.emit_to(LABEL, SELECT_EVENT, r);
        }
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let english = app.try_state::<AppState>().is_some_and(|s| s.settings().language.starts_with("en"));
    let title = if english { "Vibe Launcher – Console" } else { "Vibe Launcher – Konsole" };
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App(url_for(run_id).into()))
        .title(title)
        .inner_size(980.0, 600.0)
        .min_inner_size(560.0, 320.0)
        .background_color(tauri::window::Color(10, 10, 12, 255))
        .zoom_hotkeys_enabled(false)
        .build()
        .map_err(|e| AppError::msg(format!("Konsolenfenster konnte nicht geöffnet werden: {e}")))?;
    Ok(())
}

pub fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
}

pub fn on_launch(state: &AppState, run_id: &str) {
    if !state.settings().console_on_launch {
        return;
    }
    if let Err(e) = open(&state.app, Some(run_id)) {
        tracing::warn!("{e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_only_carry_safe_ids() {
        assert_eq!(url_for(Some("run-3")), "console.html?run=run-3");
        assert_eq!(url_for(Some("x&y=1")), "console.html");
        assert_eq!(url_for(None), "console.html");
    }
}
