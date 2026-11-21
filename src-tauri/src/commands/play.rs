//! Commands für „Spiel mit mir“-Links (siehe `play/` und docs/PLAY-LINKS.md).
use crate::error::AppResult;
use crate::play::{self, join, PlayLink, Session};
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

/// Spiel-Link vom Backend laden. Abgelaufen/unbekannt -> Fehler `not_found` mit Text `play_link_expired`.
#[tauri::command]
pub async fn play_link_get(state: State<'_, AppState>, code: String) -> AppResult<PlayLink> {
    join::fetch(&state, &code).await
}

/// Was beim Beitreten passiert (passende Instanz, Installation, Größe, Probleme).
#[tauri::command]
pub async fn play_join_preview(state: State<'_, AppState>, link: PlayLink) -> AppResult<join::JoinPreview> {
    join::preview(&state, &link).await
}

/// Instanz für den Link vorbereiten (anlegen/ergänzen). Liefert die Task-ID; die Instanz steht danach in der Aufgabe.
#[tauri::command]
pub async fn play_join_setup(state: State<'_, AppState>, link: PlayLink, instance_id: Option<String>) -> AppResult<String> {
    if let Some(id) = &instance_id {
        state.instances.get(id)?;
    }
    let st = state.inner().clone();
    let title = format!("Einladung von {} vorbereiten", link.host.name);
    Ok(state.tasks.spawn("play_join", title, instance_id.clone(), move |task| join::run_setup(st, task, link, instance_id)))
}

#[derive(Debug, Serialize)]
pub struct RunningSession {
    pub instance_id: String,
    pub session: Session,
}

/// `session.json` aller laufenden Instanzen (nur gültige, nicht veraltete).
#[tauri::command]
pub async fn play_sessions(state: State<'_, AppState>) -> AppResult<Vec<RunningSession>> {
    let base = crate::vibe::api_base(&state);
    Ok(state
        .game
        .states()
        .into_iter()
        .filter(|g| g.state == crate::minecraft::RunState::Running)
        .map(|g| g.instance_id)
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .filter_map(|instance_id| {
            let mut session = play::read_session(&state, &instance_id)?;
            // nur Links unseres Backends weitergeben
            session.play_link = session.play_link.filter(|u| play::is_play_link_url(&base, u));
            Some(RunningSession { instance_id, session })
        })
        .collect())
}
