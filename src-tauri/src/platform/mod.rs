//! OWNER: Frontend-Agent A (Plattform-Funktionen): Crash-Analyse, Server-Liste, Discord Rich Presence,
//! Optionen-Sync, Verknüpfungen/Kommandozeile, Deep-Links, Spielzeit-Statistik.
//!
//! Anbindung an den Rest: `init()` in `lib.rs` (setup), `on_launch()` in `instance_launch`.
//! Laufzeitzustände kommen über das Backend-Event `game://state` – der Spiel-Code bleibt unberührt.
pub mod app_icon;
pub mod crash;
pub mod discord;
pub mod gpupref;
pub mod links;
pub mod optsync;
pub mod presence;
pub mod presence_art;
pub mod servers;
pub mod shortcuts;
pub mod stats;
pub mod syncdir;
pub mod syncservers;

use crate::state::AppState;
use parking_lot::Mutex;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Listener, Manager};

/// Event an das Frontend: neue externe Aktionen liegen bereit (`app_actions_take`).
pub const ACTIONS_EVENT: &str = "app://actions";
/// Event an das Frontend: Synchronisieren hat etwas geändert (Payload: Instanz-ID).
pub const SYNC_EVENT: &str = "sync://changed";

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
    /// Öffentliche Icon-URLs von Modrinth-Modpacks (Projekt-ID -> URL), für das große Discord-Bild
    icons: Mutex<HashMap<String, Option<String>>>,
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
        // Gleiche Aktion nicht doppelt (Deep-Link kann beim Kaltstart über Argument und Plugin ankommen)
        let mut pending = p.pending.lock();
        for a in actions {
            if !pending.contains(&a) {
                pending.push(a);
            }
        }
    }
    let _ = app.emit(ACTIONS_EVENT, ());
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Vor dem Start (aus `instance_launch`): Kontext merken, Optionen-Sync anwenden.
pub fn on_launch(state: &AppState, id: &str, run: &str, world: Option<String>, server: Option<String>) {
    let extra = state.game.others_active(id, run) > 0;
    if let Some(p) = state.app.try_state::<PlatformState>() {
        if !extra || !p.active.lock().contains_key(id) {
            p.launch_ctx.lock().insert(id.to_string(), LaunchCtx { world, server });
        }
    }
    if extra {
        return;
    }
    // Vertrag mit dem Vibey Client: `.vibe/instance.json` vor jedem Start (docs/PLAY-LINKS.md §2)
    if let Err(e) = crate::play::write_instance_file(state, id) {
        tracing::warn!(".vibe/instance.json für {id} nicht geschrieben: {e}");
    }
    if let Ok(inst) = state.instances.get(id) {
        // Synchronisieren: gemeinsame Ordner, Server-Liste, Optionen (blockiert kurz; große Dateien sind Hardlinks)
        optsync::before_launch(&state.paths.root, &state.paths.game_dir(id), id, &inst.name, &inst.mc_version);
    }
}

pub fn init(app: &AppHandle) {
    let p = PlatformState {
        discord: discord::Discord::start(),
        launch_ctx: Mutex::new(HashMap::new()),
        active: Mutex::new(HashMap::new()),
        pending: Mutex::new(links::parse_args(std::env::args().skip(1))),
        opened_at: chrono::Utc::now().timestamp_millis(),
        icons: Mutex::new(HashMap::new()),
    };
    let rpc = p.discord.available();
    app.manage(p);
    // `session.json` der laufenden Instanzen regelmäßig nachlesen (der Vibey Client aktualisiert sie)
    if rpc {
        let h = app.clone();
        std::thread::Builder::new()
            .name("presence-poll".into())
            .spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(10));
                let busy = h.try_state::<PlatformState>().is_some_and(|p| !p.active.lock().is_empty());
                if busy {
                    update_presence(&h);
                }
            })
            .ok();
    }

    let h = app.clone();
    app.listen(crate::events::GAME_STATE, move |ev| {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(ev.payload()) else { return };
        on_game_state(&h, &v);
    });
    let h = app.clone();
    app.listen(crate::events::SETTINGS_CHANGED, move |_| update_presence(&h));
    let h = app.clone();
    app.listen(crate::events::ACCOUNTS_CHANGED, move |_| update_presence(&h));
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
        Some("stopped") if state.game.is_process_running(id) => {}
        Some("stopped") => {
            p.launch_ctx.lock().remove(id);
            let mut since = None;
            if let Some(a) = p.active.lock().remove(id) {
                since = Some(a.start);
                let s = stats::Session { instance_id: id.to_string(), start: a.start, end: now, world: a.ctx.world, server: a.ctx.server };
                if let Err(e) = stats::append(&state.paths.root, &s) {
                    tracing::warn!("Spielzeit konnte nicht gespeichert werden: {e}");
                }
            }
            if let Ok(inst) = state.instances.get(id) {
                let s = optsync::after_exit(&state.paths.root, &state.paths.game_dir(id), id, &inst.name, &inst.mc_version, since);
                if !s.conflicts.is_empty() || s.changes > 0 {
                    let _ = app.emit(SYNC_EVENT, id);
                }
            }
        }
        _ => {}
    }
    update_presence(app);
}

/// Discord-Anzeige aus dem aktuellen Zustand ableiten.
pub fn update_presence(app: &AppHandle) {
    let (Some(state), Some(p)) = (app.try_state::<AppState>(), app.try_state::<PlatformState>()) else { return };
    let settings = state.settings();
    if !settings.discord_rpc || !p.discord.available() {
        p.discord.set(None);
        return;
    }
    let english = !settings.language.starts_with("de");
    let art = presence_art::Art::from_settings(&settings);
    let head = active_head(&state);
    let active = p.active.lock().iter().max_by_key(|(_, a)| a.start).map(|(id, a)| (id.clone(), a.clone()));
    let input = match active {
        Some((id, a)) => {
            let inst = state.instances.get(&id).ok();
            let session = crate::play::read_session(&state, &id);
            let base = crate::vibe::api_base(&state);
            let play_link = session.as_ref().and_then(|s| s.play_link.clone()).filter(|u| crate::play::is_play_link_url(&base, u));
            presence::PresenceInput {
                instance_name: Some(inst.as_ref().map(|i| i.name.clone()).unwrap_or_else(|| id.clone())),
                loader: inst.as_ref().map(|i| {
                    if i.is_bedrock() {
                        ("vanilla".to_string(), "Minecraft Bedrock".to_string())
                    } else {
                        (i.loader.kind.as_str().to_string(), format!("{} · Minecraft {}", loader_name(&i.loader.kind), i.mc_version))
                    }
                }),
                session,
                launch_world: a.ctx.world.clone(),
                launch_server: a.ctx.server.clone(),
                details: settings.discord_details,
                english,
                start: a.start,
                icon_url: inst.as_ref().and_then(|i| icon_url(app, &p, i)),
                play_link,
                art,
                head,
            }
        }
        None => presence::PresenceInput { english, start: p.opened_at, details: settings.discord_details, art, head, ..Default::default() },
    };
    p.discord.set(Some(presence::build_activity(&input)));
}

fn active_head(state: &AppState) -> Option<presence_art::Head> {
    let acc = state.auth.list().into_iter().find(|a| a.active && a.kind == crate::auth::AccountKind::Microsoft)?;
    presence_art::Head::new(&acc.uuid, &acc.username)
}

/// Öffentliche Icon-URL eines Modrinth-Modpacks (einmal im Hintergrund laden, dann aus dem Speicher).
fn icon_url(app: &AppHandle, p: &PlatformState, inst: &crate::instance::Instance) -> Option<String> {
    let src = inst.source.as_ref().filter(|s| s.kind == crate::instance::PackSourceKind::Modrinth)?;
    let pid = src.project_id.clone()?;
    if let Some(v) = p.icons.lock().get(&pid) {
        return v.clone();
    }
    p.icons.lock().insert(pid.clone(), None);
    let h = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(state) = h.try_state::<AppState>() else { return };
        let url = crate::content::provider::brief(&state, crate::content::Source::Modrinth, &pid)
            .await
            .ok()
            .and_then(|b| b.icon_url)
            .filter(|u| u.starts_with("https://"));
        if url.is_some() {
            if let Some(p) = h.try_state::<PlatformState>() {
                p.icons.lock().insert(pid, url);
            }
            update_presence(&h);
        }
    });
    None
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
