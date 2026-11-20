//! Bedrock starten: Profil eintauschen, Spiel über das installierte Paket öffnen, Prozess beobachten,
//! danach zurücktauschen, Spielzeit/Screenshots übernehmen. Wiederaufnahme beim Launcher-Start.
use super::{detect, options, profile_dir, swap, swapper, target, Layout};
use crate::error::{AppError, AppResult};
use crate::instance::{BedrockChannel, BedrockProfile};
use crate::minecraft::LogLevel;
use crate::state::AppState;
use crate::tasks::TaskHandle;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::Duration;

/// Sperre für alles, was Bedrock-Daten verschiebt oder schreibt (Tausch, Packs, Welten). Verhindert, dass
/// ein Pack in den falschen Ordner geschrieben wird, während gerade getauscht wird.
pub static DATA_LOCK: Mutex<()> = parking_lot::const_mutex(());

/// Kanäle, für die gerade bestehende Daten in eine neue Instanz kopiert werden (kein Tausch währenddessen).
static ADOPTING: Mutex<Option<HashSet<BedrockChannel>>> = parking_lot::const_mutex(None);

/// Simulierte Sitzungen (nur Debug mit `VIBE_BEDROCK_ROOT`): Instanz -> (Ende, gestoppt)
static SIM: Mutex<Option<HashMap<String, (std::time::Instant, bool)>>> = parking_lot::const_mutex(None);

/// Wie lange auf den Spielprozess gewartet wird (Xbox-Anmeldung, Updates …).
const START_TIMEOUT: Duration = Duration::from_secs(180);

pub fn adopting(channel: BedrockChannel) -> bool {
    ADOPTING.lock().as_ref().is_some_and(|s| s.contains(&channel))
}

pub(crate) fn set_adopting(channel: BedrockChannel, on: bool) {
    let mut g = ADOPTING.lock();
    let s = g.get_or_insert_with(HashSet::new);
    if on {
        s.insert(channel);
    } else {
        s.remove(&channel);
    }
}

fn sim_alive(id: &str) -> bool {
    SIM.lock().as_ref().and_then(|m| m.get(id)).is_some_and(|(until, stopped)| !stopped && std::time::Instant::now() < *until)
}

fn sim_any() -> bool {
    let g = SIM.lock();
    g.as_ref().is_some_and(|m| m.keys().any(|k| m.get(k).is_some_and(|(u, s)| !s && std::time::Instant::now() < *u)))
}

/// Läuft das Spiel dieses Kanals (bzw. ein Bedrock unbekannten Kanals)? Vor jedem Tausch geprüft.
pub fn game_running(channel: BedrockChannel) -> bool {
    if super::simulated() {
        return sim_any();
    }
    detect::running_pid(channel).is_some()
}

// ------------------------------------------------------------------ Status

#[derive(Debug, Clone, Serialize)]
pub struct ChannelStatus {
    pub channel: BedrockChannel,
    pub installed: bool,
    pub version: Option<String>,
    pub layout: Option<Layout>,
    /// Echter Datenordner
    pub data_dir: Option<String>,
    /// Es gibt schon Bedrock-Daten (Welten/Packs), die übernommen werden können
    pub has_data: bool,
    /// Instanz, deren Profil gerade eingetauscht ist (oder deren Tausch offen ist)
    pub active_instance: Option<String>,
    pub running: bool,
    pub store_url: String,
    pub swap_locked: bool,
    pub same_volume: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Status {
    /// Windows
    pub supported: bool,
    /// Entwicklungsmodus mit Testordner (Spiel wird nur simuliert)
    pub simulated: bool,
    /// Warum Bedrock gerade nicht nutzbar ist (z. B. Debug-Sperre)
    pub blocked: Option<String>,
    pub channels: Vec<ChannelStatus>,
}

pub fn status(state: &AppState) -> Status {
    let supported = cfg!(windows) || super::simulated();
    let mut blocked = None;
    let mut channels = Vec::new();
    for ch in [BedrockChannel::Release, BedrockChannel::Preview] {
        let store_url = super::store_url(ch).to_string();
        match target(ch) {
            Ok(t) => {
                let inst = detect::install(ch);
                let sw = swapper(&state.paths, &t);
                // Billig: bricht bei der ersten Datei ab (Welten können viele GB groß sein)
                let has_data = sw.active_instance().is_none()
                    && t.layout.slots(&t.base).iter().any(|s| walkdir::WalkDir::new(super::slot_path(&t.base, s)).into_iter().flatten().any(|e| e.file_type().is_file()));
                channels.push(ChannelStatus {
                    channel: ch,
                    installed: inst.installed,
                    version: inst.version,
                    layout: Some(t.layout),
                    data_dir: Some(t.base.to_string_lossy().to_string()),
                    has_data,
                    active_instance: sw.active_instance(),
                    running: game_running(ch),
                    store_url,
                    swap_locked: super::issues::is_locked(ch),
                    same_volume: swap::check_same_volume(&state.paths.root, &t.base).is_ok(),
                });
            }
            Err(e) => {
                if supported {
                    blocked = Some(e.to_string());
                }
                channels.push(ChannelStatus { channel: ch, installed: false, version: None, layout: None, data_dir: None, has_data: false, active_instance: None, running: false, store_url, swap_locked: false, same_volume: true });
            }
        }
    }
    Status { supported, simulated: super::simulated(), blocked, channels }
}

// ------------------------------------------------------------------ Start

/// Start als Aufgabe (wie bei Java). Gibt die Task-ID zurück.
pub fn start(state: &AppState, id: &str) -> AppResult<String> {
    let inst = state.instances.get(id)?;
    let o = options(&inst)?;
    // Als „ungültig“ melden – „nicht konfiguriert“ würde in der Oberfläche zur Account-Anmeldung führen
    target(o.channel).map_err(|e| AppError::Invalid(e.to_string()))?;
    if adopting(o.channel) {
        return Err(AppError::Invalid("Bestehende Bedrock-Daten werden gerade übernommen – bitte kurz warten.".into()));
    }
    state.game.begin(id)?;
    let st = state.clone();
    let iid = id.to_string();
    let task_id = state.tasks.spawn("launch", format!("{} wird gestartet", inst.name), Some(id.to_string()), move |task| async move {
        let r = run(&st, &iid, &task).await;
        if let Err(e) = &r {
            st.game.fail(&iid, e);
        }
        r
    });
    state.game.set_task(id, &task_id);
    Ok(task_id)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(f).await?
}

async fn run(state: &AppState, id: &str, task: &TaskHandle) -> AppResult<()> {
    let inst = state.instances.get(id)?;
    let o = options(&inst)?;
    let ch = o.channel;
    let t = target(ch)?;
    let name = if ch == BedrockChannel::Preview { "Minecraft Bedrock Preview" } else { "Minecraft Bedrock" };
    task.stage(format!("{name} wird gesucht …"), None);
    let found = blocking(move || Ok(detect::install(ch))).await?;
    if !found.installed {
        return Err(AppError::Invalid(format!("{name} ist nicht installiert. Installiere es über den Microsoft Store.")));
    }
    let isolated = o.profile == BedrockProfile::Isolated;
    // Offene Reste aufräumen, beim ersten Mal sichern, eintauschen
    {
        let (st, iid, t2, task2) = (state.clone(), id.to_string(), t.clone(), task.clone());
        let recovered = blocking(move || {
            if game_running(ch) {
                return Err(AppError::Invalid(format!("{name} läuft bereits. Bitte schließe das Spiel und starte es dann über den Launcher.")));
            }
            let _g = DATA_LOCK.lock();
            let r = swapper(&st.paths, &t2).swap_out(&|| game_running(ch))?;
            drop(_g);
            if isolated {
                let total: u64 = t2.layout.slots(&t2.base).iter().map(|s| super::dir_size(&super::slot_path(&t2.base, s))).sum();
                let done = std::sync::atomic::AtomicU64::new(0);
                let marker = super::launcher_dir(&st.paths).join(format!("initial-backup-{}.json", ch.as_str()));
                if !marker.exists() {
                    task2.stage("Erste vollständige Sicherung deiner Bedrock-Daten …", Some(0.0));
                }
                let on = |n: u64| {
                    let d = done.fetch_add(n, std::sync::atomic::Ordering::Relaxed) + n;
                    if total > 0 {
                        task2.progress(d as f64 / total as f64);
                    }
                };
                let backups = super::launcher_dir(&st.paths).join("backups").join(ch.as_str());
                if let Some(p) = swap::ensure_initial_backup(&t2.base, t2.layout, &backups, &marker, &on, &|| task2.is_cancelled())? {
                    tracing::info!("Bedrock: erste Sicherung unter {p:?}");
                    st.game.launcher_line(&iid, LogLevel::Launcher, format!("Erste Sicherung deiner Bedrock-Daten: {}", p.display()));
                }
                task2.stage("Profil wird eingetauscht …", None);
                let profile = profile_dir(&st.paths, &iid);
                std::fs::create_dir_all(&profile)?;
                if game_running(ch) {
                    return Err(AppError::Invalid(swap::RUNNING_MSG.into()));
                }
                let _g = DATA_LOCK.lock();
                swapper(&st.paths, &t2).swap_in(&iid, &profile, &|| game_running(ch))?;
            }
            Ok(r)
        })
        .await?;
        if let Some(r) = recovered {
            tracing::info!("Bedrock: offenen Tausch von {} abgeschlossen", r.instance_id);
        }
    }
    // Ab hier bei jedem Fehler zurücktauschen
    let started_ms = crate::util::now_ms();
    let res: AppResult<Option<u32>> = async {
        task.stage(format!("{name} wird geöffnet …"), None);
        state.game.launcher_line(id, LogLevel::Launcher, format!("{name} wird geöffnet ({})", if isolated { "eigenes Profil" } else { "gemeinsames Profil" }));
        open_game(state, id, ch, &t)?;
        task.stage(format!("Warte auf {name} …"), None);
        let deadline = std::time::Instant::now() + START_TIMEOUT;
        loop {
            if task.is_cancelled() {
                return Err(AppError::Cancelled);
            }
            if super::simulated() {
                if sim_alive(id) {
                    return Ok(None);
                }
            } else if let Some(pid) = blocking(move || Ok(detect::running_pid(ch))).await? {
                return Ok(Some(pid));
            }
            if std::time::Instant::now() > deadline {
                return Err(AppError::msg(format!("{name} wurde nicht gestartet. Öffne es einmal direkt und melde dich bei Xbox an, dann klappt es auch hier.")));
            }
            tokio::time::sleep(Duration::from_millis(800)).await;
        }
    }
    .await;
    let pid = match res {
        Ok(pid) => pid,
        Err(e) => {
            if isolated {
                swap_back(state, ch).await;
            }
            return Err(e);
        }
    };
    state.game.mark_running(id, pid, started_ms);
    let _ = state.instances.modify(id, |i| i.last_played = Some(started_ms));
    crate::minecraft::process::apply_launch_behavior(state, true);
    let st = state.clone();
    let iid = id.to_string();
    tauri::async_runtime::spawn(async move { monitor(st, iid, ch, isolated, started_ms).await });
    Ok(())
}

/// Spiel öffnen: über das Protokoll des installierten Pakets (`minecraft:` / `minecraft-preview:`).
fn open_game(_state: &AppState, id: &str, ch: BedrockChannel, t: &super::Target) -> AppResult<()> {
    if super::simulated() {
        // Wie das echte Spiel beim ersten Start: Spieler- und Pack-Ordner anlegen
        if t.layout == Layout::Gdk {
            std::fs::create_dir_all(t.base.join("Users/2535400000000001/games/com.mojang/minecraftWorlds"))?;
            std::fs::create_dir_all(t.base.join("Users/2535400000000001/games/com.mojang/minecraftpe"))?;
        }
        std::fs::create_dir_all(t.packs_dir().join("resource_packs"))?;
        let secs = std::env::var("VIBE_BEDROCK_SIM_SECS").ok().and_then(|s| s.parse().ok()).unwrap_or(20u64);
        SIM.lock().get_or_insert_with(HashMap::new).insert(id.to_string(), (std::time::Instant::now() + Duration::from_secs(secs), false));
        return Ok(());
    }
    let uri = match ch {
        BedrockChannel::Release => "minecraft:",
        BedrockChannel::Preview => "minecraft-preview:",
    };
    #[cfg(windows)]
    {
        std::process::Command::new("explorer").arg(uri).spawn().map_err(|e| AppError::msg(format!("Spiel konnte nicht geöffnet werden: {e}")))?;
    }
    #[cfg(not(windows))]
    {
        let _ = uri;
        return Err(AppError::Invalid("Minecraft Bedrock gibt es nur unter Windows.".into()));
    }
    #[allow(unreachable_code)]
    Ok(())
}

/// Zurücktauschen mit Wiederholung (Dateien können kurz nach Spielende noch gesperrt sein).
async fn swap_back(state: &AppState, ch: BedrockChannel) -> bool {
    for attempt in 0..12 {
        let st = state.clone();
        let r = blocking(move || {
            let t = target(ch)?;
            let _g = DATA_LOCK.lock();
            swapper(&st.paths, &t).swap_out(&|| game_running(ch))
        })
        .await;
        super::issues::record(ch, &r);
        match r {
            Ok(rep) => {
                if let Some(rep) = rep.filter(|r| !r.rescued.is_empty()) {
                    tracing::warn!("Bedrock: unerwartete Daten gesichert: {:?}", rep.rescued);
                }
                return true;
            }
            Err(e) => {
                tracing::warn!("Bedrock: Zurücktauschen (Versuch {}) fehlgeschlagen: {e}", attempt + 1);
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
    false
}

/// Spiel beobachten bis es beendet ist, dann aufräumen.
async fn monitor(state: AppState, id: String, ch: BedrockChannel, isolated: bool, started_ms: i64) {
    let mut misses = 0;
    loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let alive = if super::simulated() { sim_alive(&id) } else { blocking(move || Ok(detect::running_pid(ch).is_some())).await.unwrap_or(true) };
        if alive {
            misses = 0;
            continue;
        }
        // Zweimal hintereinander weg (das Spiel startet sich z. B. nach Updates kurz neu)
        misses += 1;
        if misses >= 2 {
            break;
        }
    }
    if super::simulated() {
        if let Some(m) = SIM.lock().as_mut() {
            m.remove(&id);
        }
    }
    let ended = crate::util::now_ms();
    let ok = !isolated || swap_back(&state, ch).await;
    let shots = {
        let (paths, iid) = (state.paths.clone(), id.clone());
        blocking(move || Ok(copy_screenshots(&paths, &iid, started_ms, ended))).await.unwrap_or(0)
    };
    let secs = ((ended - started_ms).max(0) / 1000) as u64;
    let _ = state.instances.modify(&id, |i| i.play_time_secs = i.play_time_secs.saturating_add(secs));
    let mut msg = if state.game.was_killed(&id) { "Spiel wurde beendet.".to_string() } else { "Spiel beendet.".to_string() };
    if shots > 0 {
        msg.push_str(&format!(" {shots} Screenshot(s) übernommen."));
    }
    if !ok {
        msg.push_str(" Die Profildaten konnten noch nicht zurückgetauscht werden – das passiert automatisch beim nächsten Start.");
    }
    state.game.mark_stopped(&id, !ok, msg);
    if !state.game.any_running() {
        crate::minecraft::process::apply_launch_behavior(&state, false);
    }
}

/// Stoppen: Spielprozess beenden bzw. Vorbereitung abbrechen.
pub fn kill(state: &AppState, id: &str) -> AppResult<()> {
    if super::simulated() {
        if let Some(e) = SIM.lock().as_mut().and_then(|m| m.get_mut(id)) {
            e.1 = true;
        }
    }
    state.game.kill(state, id)
}

/// Beim Launcher-Start: offene Tausche abschließen oder (Spiel läuft noch) weiter beobachten.
pub fn on_startup(state: &AppState) {
    for ch in [BedrockChannel::Release, BedrockChannel::Preview] {
        let Ok(t) = target(ch) else { continue };
        let sw = swapper(&state.paths, &t);
        let Some(j) = sw.load_journal() else { continue };
        if game_running(ch) {
            // Spiel läuft noch mit eingetauschtem Profil -> Sitzung wieder aufnehmen
            if state.instances.get(&j.instance_id).is_ok() && state.game.begin(&j.instance_id).is_ok() {
                let pid = if super::simulated() { None } else { detect::running_pid(ch) };
                state.game.mark_running(&j.instance_id, pid, j.started_at);
                state.game.launcher_line(&j.instance_id, LogLevel::Launcher, "Laufende Bedrock-Sitzung wieder aufgenommen.".into());
                let st = state.clone();
                tauri::async_runtime::spawn(async move { monitor(st, j.instance_id.clone(), ch, true, j.started_at).await });
            }
            continue;
        }
        let _g = DATA_LOCK.lock();
        let r = sw.swap_out(&|| game_running(ch));
        super::issues::record(ch, &r);
        match r {
            Ok(Some(r)) => tracing::info!("Bedrock: offenen Tausch von {} nach Neustart abgeschlossen (gerettet: {:?})", r.instance_id, r.rescued),
            Ok(None) => {}
            Err(e) => tracing::error!("Bedrock: Wiederaufnahme des Tauschs fehlgeschlagen: {e}"),
        }
    }
}

/// Manuell „Daten zurücktauschen“ (falls das automatische Zurücktauschen nicht klappte).
pub fn recover(state: &AppState, ch: BedrockChannel) -> AppResult<bool> {
    if adopting(ch) {
        return Err(AppError::Invalid("Bitte warte, bis die Übernahme fertig ist.".into()));
    }
    let t = target(ch)?;
    let sw = swapper(&state.paths, &t);
    if let Some(j) = sw.load_journal() {
        if state.game.is_running(&j.instance_id) {
            return Err(AppError::Invalid("Die Instanz läuft noch.".into()));
        }
    }
    let _g = DATA_LOCK.lock();
    let r = sw.swap_out(&|| game_running(ch));
    super::issues::record(ch, &r);
    Ok(r?.is_some())
}

// ------------------------------------------------------------------ Screenshots

/// Ordner der Xbox-Game-Bar-Aufnahmen (Standard: Videos\Captures).
fn captures_dir() -> Option<PathBuf> {
    if let Some(r) = super::dev_root() {
        return Some(r.join("Captures"));
    }
    dirs::video_dir().map(|v| v.join("Captures"))
}

/// Aufnahmen von Minecraft aus der Sitzung in die Galerie (`screenshots/` der Instanz) kopieren.
/// Die Originale bleiben unberührt.
pub fn copy_screenshots(paths: &crate::paths::Paths, id: &str, from_ms: i64, to_ms: i64) -> usize {
    let Some(dir) = captures_dir() else { return 0 };
    copy_shots_from(&dir, &paths.game_dir(id).join("screenshots"), from_ms, to_ms)
}

pub fn copy_shots_from(dir: &std::path::Path, dest: &std::path::Path, from_ms: i64, to_ms: i64) -> usize {
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    let mut n = 0;
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let lower = name.to_ascii_lowercase();
        if !lower.starts_with("minecraft") || !(lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg")) {
            continue;
        }
        let Some(t) = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64) else { continue };
        if t < from_ms - 5_000 || t > to_ms + 60_000 {
            continue;
        }
        let target = dest.join(&name);
        if target.exists() || std::fs::create_dir_all(dest).is_err() {
            continue;
        }
        if std::fs::copy(e.path(), &target).is_ok() {
            n += 1;
        }
    }
    n
}

#[cfg(test)]
mod tests {
    #[test]
    fn screenshots_from_session_only() {
        let tmp = super::super::tempdir("shots");
        let caps = tmp.join("Captures");
        std::fs::create_dir_all(&caps).unwrap();
        std::fs::write(caps.join("Minecraft 19.11.2026 14_03_22.png"), b"png").unwrap();
        std::fs::write(caps.join("Anderes Spiel.png"), b"png").unwrap();
        std::fs::write(caps.join("Minecraft clip.mp4"), b"mp4").unwrap();
        let now = crate::util::now_ms();
        let dest = tmp.join("shots");
        assert_eq!(super::copy_shots_from(&caps, &dest, now - 60_000, now), 1);
        assert!(dest.join("Minecraft 19.11.2026 14_03_22.png").is_file());
        assert!(caps.join("Minecraft 19.11.2026 14_03_22.png").is_file(), "Original bleibt");
        // Nicht doppelt, nicht außerhalb der Sitzung
        assert_eq!(super::copy_shots_from(&caps, &dest, now - 60_000, now), 0);
        assert_eq!(super::copy_shots_from(&caps, &tmp.join("b"), now + 3_600_000, now + 7_200_000), 0);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
