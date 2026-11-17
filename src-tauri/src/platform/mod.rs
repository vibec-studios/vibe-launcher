//! OWNER: Frontend-Agent A (Plattform-Funktionen): Crash-Analyse, Server-Liste, Discord Rich Presence,
//! Optionen-Sync, Verknüpfungen/Kommandozeile, Deep-Links, Spielzeit-Statistik.
//!
//! Anbindung an den Rest: `init()` in `lib.rs` (setup), `on_launch()` in `instance_launch`.
//! Laufzeitzustände kommen über das Backend-Event `game://state` – der Spiel-Code bleibt unberührt.
pub mod crash;
pub mod discord;
pub mod links;
pub mod optsync;
pub mod servers;
pub mod shortcuts;
pub mod stats;

use crate::state::AppState;
use parking_lot::Mutex;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Listener, Manager};

/// Event an das Frontend: neue externe Aktionen liegen bereit (`app_actions_take`).
pub const ACTIONS_EVENT: &str = "app://actions";

#[derive(Debug, Clone, Default)]
struct LaunchCtx {
    world: Option<String>,
    server: Option<String>,
}

#[derive(Debug, Clone)]
struct Active {
    start: i64,
    ctx: LaunchCtx,
}

pub struct PlatformState {
    pub discord: discord::Discord,
    launch_ctx: Mutex<HashMap<String, LaunchCtx>>,
    active: Mutex<HashMap<String, Active>>,
    pending: Mutex<Vec<links::AppAction>>,
    opened_at: i64,
}

impl PlatformState {
    pub fn take_actions(&self) -> Vec<links::AppAction> {
        std::mem::take(&mut *self.pending.lock())
    }
}

/// Externe Aktionen einreihen und das Frontend benachrichtigen.
pub fn push_actions(app: &AppHandle, actions: Vec<links::AppAction>) {
    if actions.is_empty() {
        return;
    }
    if let Some(p) = app.try_state::<PlatformState>() {
        p.pending.lock().extend(actions);
    }
    let _ = app.emit(ACTIONS_EVENT, ());
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Vor dem Start (aus `instance_launch`): Kontext merken, Optionen-Sync anwenden.
pub fn on_launch(state: &AppState, id: &str, world: Option<String>, server: Option<String>) {
    if let Some(p) = state.app.try_state::<PlatformState>() {
        p.launch_ctx.lock().insert(id.to_string(), LaunchCtx { world, server });
    }
    if let Ok(inst) = state.instances.get(id) {
        match optsync::apply(&state.paths.root, &state.paths.game_dir(id), id, &inst.mc_version) {
            Ok(n) if n > 0 => tracing::info!("Optionen-Sync: {n} Einstellungen in {id} übernommen"),
            Ok(_) => {}
            Err(e) => tracing::warn!("Optionen-Sync für {id} fehlgeschlagen: {e}"),
        }
    }
}

pub fn init(app: &AppHandle) {
    let p = PlatformState {
        discord: discord::Discord::start(),
        launch_ctx: Mutex::new(HashMap::new()),
        active: Mutex::new(HashMap::new()),
        pending: Mutex::new(links::parse_args(std::env::args().skip(1))),
        opened_at: chrono::Utc::now().timestamp_millis(),
    };
    app.manage(p);

    let h = app.clone();
    app.listen(crate::events::GAME_STATE, move |ev| {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(ev.payload()) else { return };
        on_game_state(&h, &v);
    });
    let h = app.clone();
    app.listen(crate::events::SETTINGS_CHANGED, move |_| update_presence(&h));
    update_presence(app);
}

fn on_game_state(app: &AppHandle, v: &serde_json::Value) {
    let (Some(state), Some(p)) = (app.try_state::<AppState>(), app.try_state::<PlatformState>()) else { return };
    let Some(id) = v.get("instance_id").and_then(|x| x.as_str()) else { return };
    let now = chrono::Utc::now().timestamp_millis();
    match v.get("state").and_then(|x| x.as_str()) {
        Some("running") => {
            let start = v.get("started_at").and_then(|x| x.as_i64()).unwrap_or(now);
            let ctx = p.launch_ctx.lock().remove(id).unwrap_or_default();
            p.active.lock().entry(id.to_string()).or_insert(Active { start, ctx });
        }
        Some("stopped") => {
            p.launch_ctx.lock().remove(id);
            if let Some(a) = p.active.lock().remove(id) {
                let s = stats::Session { instance_id: id.to_string(), start: a.start, end: now, world: a.ctx.world, server: a.ctx.server };
                if let Err(e) = stats::append(&state.paths.root, &s) {
                    tracing::warn!("Spielzeit konnte nicht gespeichert werden: {e}");
                }
            }
            if let Err(e) = optsync::pull(&state.paths.root, &state.paths.game_dir(id), id) {
                tracing::warn!("Optionen-Sync (Übernahme) fehlgeschlagen: {e}");
            }
        }
        _ => {}
    }
    update_presence(app);
}

/// Discord-Anzeige aus dem aktuellen Zustand ableiten.
pub fn update_presence(app: &AppHandle) {
    let (Some(state), Some(p)) = (app.try_state::<AppState>(), app.try_state::<PlatformState>()) else { return };
    if !state.settings().discord_rpc {
        p.discord.set(None);
        return;
    }
    let active = p.active.lock().iter().max_by_key(|(_, a)| a.start).map(|(id, a)| (id.clone(), a.clone()));
    let act = match active {
        Some((id, a)) => {
            let inst = state.instances.get(&id).ok();
            let name = inst.as_ref().map(|i| i.name.clone()).unwrap_or(id);
            let loader = inst.as_ref().map(|i| {
                (i.loader.kind.as_str().to_string(), format!("{} · Minecraft {}", loader_name(&i.loader.kind), i.mc_version))
            });
            let state_line = match (&a.ctx.server, &a.ctx.world) {
                (Some(s), _) => Some(format!("Auf Server {s}")),
                (_, Some(w)) => Some(format!("Einzelspieler: {w}")),
                _ => loader.as_ref().map(|l| l.1.clone()),
            };
            discord::Activity {
                details: format!("Spielt {name}"),
                state: state_line,
                start: Some(a.start),
                small_image: loader.as_ref().map(|l| l.0.clone()),
                small_text: loader.map(|l| l.1),
            }
        }
        None => discord::Activity { details: "Im Launcher".into(), state: None, start: Some(p.opened_at), small_image: None, small_text: None },
    };
    p.discord.set(Some(act));
}

fn loader_name(k: &crate::instance::LoaderKind) -> &'static str {
    use crate::instance::LoaderKind::*;
    match k {
        Vanilla => "Vanilla",
        Fabric => "Fabric",
        Quilt => "Quilt",
        Forge => "Forge",
        Neoforge => "NeoForge",
    }
}

/// Deep-Links (`vibelauncher://…`) aus dem Plugin entgegennehmen.
pub fn handle_urls(app: &AppHandle, urls: Vec<String>) {
    let acts: Vec<_> = urls.iter().filter_map(|u| links::parse_url(u)).collect();
    if acts.is_empty() && !urls.is_empty() {
        tracing::warn!("Ungültiger Deep-Link ignoriert: {urls:?}");
    }
    push_actions(app, acts);
}
