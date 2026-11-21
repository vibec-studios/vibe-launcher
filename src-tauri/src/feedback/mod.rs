//! Feedback und Fehlerberichte aus dem Launcher (`POST /api/v1/feedback`, docs/FEEDBACK.md).
//!
//! Ablauf: Die Oberfläche liefert nur die Auswahl ([`Draft`]: Art, Text, Kontakt, Instanz, Häkchen, IDs der
//! Screenshots). Rust liest die Logs selbst (keine Pfade vom Frontend), kürzt und bereinigt sie
//! ([`redact`]) und legt das fertige Paket unter einem Einmal-Token ab ([`prepare`]). Die Vorschau zeigt genau
//! dieses Paket; [`send`] schickt es unverändert ab. Screenshots kommen nur aus dem Fenster-Screenshot oder dem
//! Datei-Dialog, den Rust selbst öffnet, und liegen bis zum Senden/Verwerfen nur im Speicher.
//!
//! **Vibe-Hauptschalter:** Feedback ist eine Kernfunktion des Launchers und läuft deshalb auch bei
//! ausgeschalteten Vibe-Diensten – aber nur, wenn der Nutzer nach der Vorschau ausdrücklich auf „Senden“ drückt.
//! Es wird nichts im Hintergrund übertragen, und bei ausgeschaltetem Vibe wird nie ein Vibe-Konto verknüpft.
pub mod capture;
pub mod redact;

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime};

mod draft;
mod held;
mod shots;
mod logs;
mod meta;
mod send;

pub use draft::*;
pub use held::*;
pub use shots::*;
pub use logs::*;
pub use meta::*;
pub use send::*;

/// Nachricht: Länge in Zeichen
pub const MESSAGE_MIN: usize = 10;
pub const MESSAGE_MAX: usize = 5000;
pub const CONTACT_MAX: usize = 200;
/// Je Log höchstens so viel (Launcher-/Spiel-Log: das Ende, Crash-Report: der Anfang)
pub const LOG_MAX_BYTES: u64 = 256 * 1024;
/// Grenzen des Backends
pub const LOG_LIMIT: usize = 1024 * 1024;
pub const SHOT_LIMIT: usize = 5 * 1024 * 1024;
pub const MAX_FILES: usize = 3;
/// Crash-Reports ohne Bezug zur letzten Sitzung nur, wenn sie so frisch sind
const CRASH_MAX_AGE: Duration = Duration::from_secs(3 * 24 * 3600);
/// Vorbereitete Pakete verfallen nach
const PREPARED_TTL: Duration = Duration::from_secs(30 * 60);

#[cfg(test)]
mod tests;
