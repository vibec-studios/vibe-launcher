//! Launcher-Selbstupdate mit zwei Kanälen:
//! - `release`: nur veröffentlichte GitHub-Releases (`releases/latest`)
//! - `dev`: jeder Commit auf `main` (Vorab-Release mit Tag `dev`, wird bei jedem Push ersetzt)
//!
//! Beide Kanäle liefern eine Tauri-`latest.json` mit signiertem NSIS-Installer.
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::Arc;
use tauri_plugin_updater::{Update, UpdaterExt};

pub mod guard;

pub const REPO: &str = "vibec-studios/vibe-launcher";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    Release,
    Dev,
}

impl Channel {
    pub fn parse(s: &str) -> Channel {
        if s.eq_ignore_ascii_case("dev") { Channel::Dev } else { Channel::Release }
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            Channel::Release => "release",
            Channel::Dev => "dev",
        }
    }
    fn endpoint(&self) -> String {
        match self {
            Channel::Release => format!("https://github.com/{REPO}/releases/latest/download/latest.json"),
            Channel::Dev => format!("https://github.com/{REPO}/releases/download/dev/latest.json"),
        }
    }
}

/// Standardkanal des Builds (Dev-Builds aus CI setzen `VIBE_UPDATE_CHANNEL=dev`).
pub fn default_channel() -> String {
    option_env!("VIBE_UPDATE_CHANNEL").filter(|c| *c == "dev").unwrap_or("release").to_string()
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub channel: String,
    pub notes: Option<String>,
    /// RFC 3339
    pub date: Option<String>,
}

/// Gefundenes, noch nicht installiertes Update (zwischen `update_check` und `update_install`).
#[derive(Default)]
pub struct Pending(pub Mutex<Option<Update>>);

pub type PendingUpdate = Arc<Pending>;

/// Soll `remote` die laufende Version ersetzen?
/// - normal: nur neuere Versionen
/// - Kanalwechsel Dev -> Release: ein Dev-Build (Vorabversion) wird durch das aktuelle Release ersetzt,
///   auch wenn dessen Versionsnummer kleiner ist.
pub fn should_update(channel: Channel, current: &semver::Version, remote: &semver::Version) -> bool {
    if remote > current {
        return true;
    }
    channel == Channel::Release && !current.pre.is_empty() && remote != current
}

pub async fn check(state: &AppState) -> AppResult<Option<UpdateInfo>> {
    let channel = Channel::parse(&state.settings().update_channel);
    let url = channel.endpoint().parse().map_err(|e| AppError::msg(format!("Update-Adresse ungültig: {e}")))?;
    let updater = state
        .app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| AppError::msg(format!("Updater: {e}")))?
        .version_comparator(move |current, remote| should_update(channel, &current, &remote.version))
        .build()
        .map_err(|e| AppError::msg(format!("Updater: {e}")))?;
    let found = updater.check().await.map_err(|e| {
        tracing::warn!("Update-Prüfung ({}) fehlgeschlagen: {e}", channel.as_str());
        AppError::msg(format!("Update-Prüfung fehlgeschlagen: {e}"))
    })?;
    let info = found.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        channel: channel.as_str().to_string(),
        notes: u.body.clone().filter(|b| !b.trim().is_empty()),
        date: u.date.map(|d| d.to_string()),
    });
    *state.pending_update.0.lock() = found;
    Ok(info)
}

/// Lädt das zuvor gefundene Update (mit Fortschritt) und installiert es. Unter Windows startet
/// der NSIS-Installer im passiven Modus und beendet den Launcher; er startet danach neu.
pub async fn install(state: &AppState, task: &crate::tasks::TaskHandle) -> AppResult<()> {
    if crate::paths::portable::active() {
        return Err(AppError::Msg("Im portablen Modus aktualisiert sich der Launcher nicht selbst. Lade die neue portable Version herunter und ersetze die Datei, deine Daten im Ordner VibeData bleiben erhalten.".into()));
    }
    let update = state
        .pending_update
        .0
        .lock()
        .take()
        .ok_or_else(|| AppError::Invalid("Kein Update gefunden – bitte erneut suchen".into()))?;
    task.stage(format!("Version {} wird heruntergeladen …", update.version), Some(0.0));
    let mut done: u64 = 0;
    let t2 = task.clone();
    let bytes = update
        .download(
            move |chunk, total| {
                done += chunk as u64;
                match total {
                    Some(t) if t > 0 => t2.progress(done as f64 / t as f64),
                    _ => {}
                }
            },
            || {},
        )
        .await
        .map_err(|e| AppError::msg(format!("Download des Updates fehlgeschlagen: {e}")))?;
    task.check()?;
    guard::ensure_allowed(&guard::collect(state), true)?;
    task.stage("Update wird installiert – der Launcher startet neu …", None);
    // Kurz warten, damit das Frontend den Status noch anzeigen kann
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    update.install(bytes).map_err(|e| AppError::msg(format!("Installation des Updates fehlgeschlagen: {e}")))?;
    // Nicht-Windows: Neustart selbst auslösen (Windows beendet der Installer)
    state.app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;
    fn v(s: &str) -> semver::Version {
        semver::Version::parse(s).unwrap()
    }
    #[test]
    fn compare() {
        assert!(should_update(Channel::Release, &v("1.0.0"), &v("1.0.1")));
        assert!(!should_update(Channel::Release, &v("1.0.1"), &v("1.0.1")));
        assert!(!should_update(Channel::Release, &v("1.0.1"), &v("1.0.0")));
        // Dev-Kanal: jeder neue Commit-Build ist neuer
        assert!(should_update(Channel::Dev, &v("1.0.1-dev.41"), &v("1.0.1-dev.42")));
        assert!(should_update(Channel::Dev, &v("1.0.0"), &v("1.0.1-dev.1")));
        assert!(!should_update(Channel::Dev, &v("1.0.1-dev.42"), &v("1.0.1-dev.42")));
        // Wechsel Dev -> Release: zurück auf das Release, auch wenn kleiner
        assert!(should_update(Channel::Release, &v("1.0.1-dev.42"), &v("1.0.0")));
        assert!(should_update(Channel::Release, &v("1.0.1-dev.42"), &v("1.0.1")));
    }
}
