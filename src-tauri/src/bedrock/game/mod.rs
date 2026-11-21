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

mod status;
mod launch;
mod lifecycle;
mod shots;

pub use status::*;
pub use launch::*;
pub use lifecycle::*;
pub use shots::*;

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

#[cfg(test)]
mod tests;
