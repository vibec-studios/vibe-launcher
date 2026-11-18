//! Event-Namen (Backend -> Frontend). Siehe docs/CONTRACT.md.
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Payload: `TaskInfo`
pub const TASK_UPDATE: &str = "task://update";
/// Payload: `Instance` (vollständig, nach jeder Änderung)
pub const INSTANCE_CHANGED: &str = "instance://changed";
/// Payload: `{ id: string }`
pub const INSTANCE_REMOVED: &str = "instance://removed";
/// Payload: `GameState`
pub const GAME_STATE: &str = "game://state";
/// Payload: `{ instance_id: string, lines: LogLine[] }` (gebündelt, max. ~10/s)
pub const GAME_LOG: &str = "game://log";
/// Payload: `{ instance_id: string }` – Mods/Packs/Welten einer Instanz haben sich geändert
pub const CONTENT_CHANGED: &str = "content://changed";
/// Payload: `ManualArrived` – manuell geladene Datei aus dem Download-Ordner übernommen
pub const CONTENT_MANUAL_ARRIVED: &str = "content://manual-arrived";
/// Payload: `Account[]`
pub const ACCOUNTS_CHANGED: &str = "accounts://changed";
/// Payload: `Settings`
pub const SETTINGS_CHANGED: &str = "settings://changed";

pub fn emit<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: &S) {
    if let Err(e) = app.emit(event, payload.clone()) {
        tracing::warn!("emit {event} fehlgeschlagen: {e}");
    }
}
