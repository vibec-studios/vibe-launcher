//! Commands für Feedback/Fehlerberichte (siehe `feedback/`, docs/FEEDBACK.md).
//! Läuft bewusst auch bei ausgeschalteten Vibe-Diensten (Kernfunktion, nur auf ausdrücklichen Klick).
use crate::error::AppResult;
use crate::feedback::{self, AvailableLog, Draft, ImageInfo, Preview, SendResult};
use crate::state::AppState;
use tauri::{AppHandle, State};

/// Screenshot des Launcher-Fensters (wird vor dem Öffnen des Dialogs aufgenommen). Bleibt nur im Speicher.
#[tauri::command]
pub async fn feedback_capture(app: AppHandle) -> AppResult<ImageInfo> {
    tokio::task::spawn_blocking(move || feedback::capture_window(&app)).await?
}

/// Bilder per Datei-Dialog wählen (Rust öffnet den Dialog selbst – keine Pfade vom Frontend).
/// Liefert die angenommenen Bilder und Fehlermeldungen für abgelehnte Dateien.
#[tauri::command]
pub async fn feedback_pick_screenshots(app: AppHandle, title: String) -> AppResult<PickResult> {
    use tauri_plugin_dialog::DialogExt;
    let title: String = title.chars().take(80).collect();
    tokio::task::spawn_blocking(move || {
        let files = app.dialog().file().set_title(title).add_filter("PNG / JPEG", &["png", "jpg", "jpeg"]).blocking_pick_files().unwrap_or_default();
        let mut out = PickResult::default();
        for f in files.into_iter().take(feedback::MAX_FILES) {
            let Ok(p) = f.into_path() else { continue };
            match feedback::hold_file(&p) {
                Ok(i) => out.images.push(i),
                Err(e) => out.errors.push(e.to_string()),
            }
        }
        Ok(out)
    })
    .await?
}

#[derive(serde::Serialize, Default)]
pub struct PickResult {
    pub images: Vec<ImageInfo>,
    pub errors: Vec<String>,
}

/// Screenshots verwerfen (abgewählt / Dialog geschlossen).
#[tauri::command]
pub async fn feedback_discard(ids: Vec<String>) -> AppResult<()> {
    feedback::discard(&ids);
    Ok(())
}

/// Welche Logs bei „Logs anhängen“ dabei wären.
#[tauri::command]
pub async fn feedback_logs(state: State<'_, AppState>, instance_id: Option<String>) -> AppResult<Vec<AvailableLog>> {
    let st = state.inner().clone();
    Ok(tokio::task::spawn_blocking(move || feedback::available_logs(&st, instance_id.as_deref())).await?)
}

/// Paket bauen (Logs lesen, kürzen, bereinigen) und zur Vorschau zurückgeben.
#[tauri::command]
pub async fn feedback_preview(state: State<'_, AppState>, draft: Draft) -> AppResult<Preview> {
    let st = state.inner().clone();
    tokio::task::spawn_blocking(move || feedback::prepare(&st, &draft)).await?
}

/// Das zur Vorschau gebaute Paket unverändert senden.
#[tauri::command]
pub async fn feedback_send(state: State<'_, AppState>, token: String) -> AppResult<SendResult> {
    feedback::send(&state, &token).await
}
