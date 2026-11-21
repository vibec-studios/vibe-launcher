//! Anbindung des gemeinsamen Server-Crates an den Launcher: Tauri-Ereignisse, Einstellungen, Minecraft-Konto.
use crate::settings::Settings;
use crate::state::AppState;
use futures::future::BoxFuture;
use parking_lot::RwLock;
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter};
use vibe_server_core::error::{AppError, AppResult};
use vibe_server_core::events::EventSink;
use vibe_server_core::host::{Host, JavaPrefs, RelayIdentity};

pub struct TauriSink(pub AppHandle);

impl EventSink for TauriSink {
    fn emit_json(&self, event: &str, payload: serde_json::Value) {
        if let Err(e) = self.0.emit(event, payload) {
            tracing::warn!("emit {event} fehlgeschlagen: {e}");
        }
    }
}

pub struct LauncherHost {
    pub settings: Arc<RwLock<Settings>>,
    pub state: OnceLock<AppState>,
}

impl Host for LauncherHost {
    fn java_prefs(&self) -> JavaPrefs {
        let s = self.settings.read();
        JavaPrefs { overrides: s.java_overrides.iter().map(|(k, v)| (k.clone(), v.clone())).collect(), auto_java: s.auto_java }
    }

    fn hosting_enabled(&self) -> bool {
        let v = &self.settings.read().vibe;
        v.enabled && v.hosting
    }

    fn relay_identity<'a>(&'a self, _server_id: &'a str) -> BoxFuture<'a, AppResult<RelayIdentity>> {
        Box::pin(async move {
            let state = self.state.get().ok_or_else(|| AppError::msg("Launcher wird noch gestartet"))?;
            let acc = state.auth.online_account(state, None).await?;
            Ok(RelayIdentity { username: acc.username, uuid: acc.uuid, access_token: acc.access_token, ticket: None })
        })
    }
}

pub fn product() -> vibe_server_core::product::Product {
    vibe_server_core::product::Product {
        display: "Vibe Launcher".into(),
        slug: "vibe-launcher".into(),
        ua_name: "VibeLauncher".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        client: "launcher".into(),
        relay_slot_base: 1,
    }
}
