//! Relay-Adressen von Vibe.
/// Verbindung Host → Relay (gleicher Port wie vorher).
pub const RELAY: &str = "relay.axolite.cc:25565";
/// Alter Relay-Host.
pub const LEGACY_RELAY: &str = "vibey.henny.dev:25565";

fn norm(s: &str) -> String {
    s.trim().trim_end_matches('/').to_ascii_lowercase()
}

/// Gespeicherter Relay-Host: alter Standard (mit oder ohne Standard-Port) → neuer Standard, alles andere bleibt.
pub fn migrate_relay(saved: &str) -> String {
    let n = norm(saved);
    let legacy_host = LEGACY_RELAY.split(':').next().unwrap_or_default();
    if n == LEGACY_RELAY || n == legacy_host {
        RELAY.to_string()
    } else {
        saved.to_string()
    }
}
