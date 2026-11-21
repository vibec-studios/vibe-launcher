use super::files::AfkEvent;
use super::registry::{self, Snapshot};
use super::{agent, runtime, window};
use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Support {
    pub supported: bool,
    pub agent: &'static str,
    pub agent_version: Option<String>,
    pub window: &'static str,
    pub fps: &'static str,
    pub sound: &'static str,
    pub chat_read: &'static str,
    pub chat_send: bool,
    pub reconnect: bool,
}

pub fn support_for(bedrock: bool, loader: &str, mc: &str, cached: Option<String>, windows: bool) -> Support {
    if bedrock {
        return Support { supported: false, agent: "none", agent_version: None, window: "none", fps: "none", sound: "none", chat_read: "none", chat_send: false, reconnect: false };
    }
    let game = agent::game_state_supported(loader, mc);
    Support {
        supported: true,
        agent: if cached.is_some() { "ready" } else { "download" },
        agent_version: cached,
        window: if agent::modern_lwjgl(mc) { "agent" } else if windows { "system" } else { "none" },
        fps: "agent",
        sound: "agent",
        chat_read: "agent",
        chat_send: game,
        reconnect: game,
    }
}

#[tauri::command]
pub async fn afk_support(state: State<'_, AppState>, instance_id: String) -> AppResult<Support> {
    let inst = state.instances.get(&instance_id)?;
    let loader = serde_json::to_value(inst.loader.kind).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default();
    let cached = agent::cached(&state).map(|j| j.version);
    Ok(support_for(inst.is_bedrock(), &loader, &inst.mc_version, cached, window::SUPPORTED))
}

#[tauri::command]
pub async fn afk_sessions() -> AppResult<Vec<Snapshot>> {
    Ok(registry::with(|r| r.values().map(|x| x.snapshot()).collect()))
}

#[tauri::command]
pub async fn afk_events(run_id: String) -> AppResult<Vec<AfkEvent>> {
    Ok(registry::with(|r| r.get(&run_id).map(|x| x.events.iter().cloned().collect()).unwrap_or_default()))
}

#[tauri::command]
pub async fn afk_set_background(state: State<'_, AppState>, run_id: String, background: bool) -> AppResult<Snapshot> {
    runtime::set_background(&state, &run_id, background)
}

#[tauri::command]
pub async fn afk_send(state: State<'_, AppState>, run_id: String, text: String) -> AppResult<String> {
    runtime::send(&state, &run_id, &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn support_matrix() {
        assert!(!support_for(true, "vanilla", "1.21.4", None, true).supported);
        let old = support_for(false, "forge", "1.8.9", None, true);
        assert_eq!((old.agent, old.window, old.fps, old.chat_read, old.chat_send), ("download", "system", "agent", "agent", false));
        let new = support_for(false, "fabric", "1.21.11", Some("0.1.0".into()), true);
        assert_eq!((new.agent, new.window, new.chat_send, new.reconnect), ("ready", "agent", true, true));
        assert!(!support_for(false, "forge", "1.20.1", None, true).chat_send);
        assert_eq!(support_for(false, "vanilla", "1.8.9", None, false).window, "none");
    }
}
