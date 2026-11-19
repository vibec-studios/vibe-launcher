//! Adressen der Vibe-Dienste und der Umzug henny.dev → axolite (docs/DOMAINS.md).
//!
//! Neue Versionen nutzen nur die neuen Adressen. Die alten (`vibe.henny.dev`, `*.vibey.henny.dev`) laufen parallel
//! weiter (gleicher Server, gleiche Datenbank) und werden deshalb überall **angenommen**: Einladungslinks,
//! Server-Adressen, Deep-Links, Download-URLs des Backends und gespeicherte Werte. Gespeicherte Werte, die genau der
//! alten Standardadresse entsprechen, werden einmalig auf die neue umgestellt; eigene Adressen bleiben unverändert.

/// Backend-API, Konten, Website von Vibe.
pub const API_URL: &str = "https://vibe.axolite.app";
/// Alte Backend-Adresse (bis Launcher 1.0.0-beta.3 fest eingebaut).
pub const LEGACY_API_URL: &str = "https://vibe.henny.dev";

/// Verbindung Host → Relay (gleicher Port wie vorher).
pub const RELAY: &str = "relay.axolite.cc:25565";
/// Alter Relay-Host.
pub const LEGACY_RELAY: &str = "vibey.henny.dev:25565";

/// Domain der Minecraft-Adressen über das Relay (`<name>.axolite.cc`).
pub const RELAY_DOMAIN: &str = "axolite.cc";
/// Alte Domain der Relay-Adressen (`<name>.vibey.henny.dev`).
pub const LEGACY_RELAY_DOMAIN: &str = "vibey.henny.dev";

/// Host der Einladungslinks (`https://axolite.cc/j/<code>`).
pub const INVITE_HOST: &str = "axolite.cc";

/// Status-API.
pub const STATUS_URL: &str = "https://status.axolite.app";

fn norm(s: &str) -> String {
    s.trim().trim_end_matches('/').to_ascii_lowercase()
}

/// Gespeicherte Backend-Adresse: genau die alte Standardadresse → neue Standardadresse, alles andere bleibt.
pub fn migrate_api_url(saved: &str) -> String {
    if norm(saved) == LEGACY_API_URL {
        API_URL.to_string()
    } else {
        saved.to_string()
    }
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

/// Hosts, die zum offiziellen Backend gehören (neu und alt). Für ein anderes Backend (Debug: `VIBE_API_URL`) nur
/// dessen eigener Host.
pub fn backend_hosts(base: &str) -> Vec<String> {
    let Ok(b) = url::Url::parse(base) else { return vec![] };
    let Some(host) = b.host_str().map(str::to_ascii_lowercase) else { return vec![] };
    if is_official(base) {
        official_hosts()
    } else {
        vec![host]
    }
}

/// Ist `base` das offizielle Backend (neue oder alte Adresse)?
pub fn is_official(base: &str) -> bool {
    let n = norm(base);
    n == API_URL || n == LEGACY_API_URL
}

fn host_of(u: &str) -> String {
    url::Url::parse(u).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_default()
}

fn official_hosts() -> Vec<String> {
    vec![host_of(API_URL), host_of(LEGACY_API_URL)]
}

/// Code aus einem Einladungslink des offiziellen Backends: `https://axolite.cc/j/<code>`,
/// `https://vibe.axolite.app/j/<code>` und (alt) `https://vibe.henny.dev/j/<code>`. Nur HTTPS, ohne Query.
pub fn official_invite_code(raw: &str) -> Option<String> {
    let u = url::Url::parse(raw.trim()).ok()?;
    if u.scheme() != "https" || u.query().is_some() || u.port().is_some_and(|p| p != 443) {
        return None;
    }
    let host = u.host_str()?.to_ascii_lowercase();
    if host != INVITE_HOST && !official_hosts().contains(&host) {
        return None;
    }
    let code = u.path().strip_prefix("/j/")?.trim_end_matches('/');
    crate::play::valid_code(code).then(|| code.to_string())
}

/// Relay-Adresse der alten Domain (`name.vibey.henny.dev[:port]`) → gleiche Adresse unter der neuen Domain
/// (`name.axolite.cc[:port]`). `None`, wenn die Adresse nicht unter der alten Domain liegt.
pub fn modern_server_address(addr: &str) -> Option<String> {
    let a = addr.trim();
    let (host, port) = match a.rsplit_once(':') {
        Some((h, p)) if !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()) => (h, Some(p)),
        _ => (a, None),
    };
    let lower = host.trim_end_matches('.').to_ascii_lowercase();
    let name = lower.strip_suffix(&format!(".{LEGACY_RELAY_DOMAIN}"))?;
    if name.is_empty() || !name.split('.').all(|l| !l.is_empty() && l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')) {
        return None;
    }
    Some(match port {
        Some(p) => format!("{name}.{RELAY_DOMAIN}:{p}"),
        None => format!("{name}.{RELAY_DOMAIN}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_url_migration() {
        assert_eq!(migrate_api_url("https://vibe.henny.dev"), API_URL);
        assert_eq!(migrate_api_url("https://vibe.henny.dev/"), API_URL);
        assert_eq!(migrate_api_url(" HTTPS://Vibe.Henny.Dev "), API_URL);
        // Eigene Adressen bleiben
        assert_eq!(migrate_api_url("http://127.0.0.1:3917"), "http://127.0.0.1:3917");
        assert_eq!(migrate_api_url("https://vibe.henny.dev:8443"), "https://vibe.henny.dev:8443");
        assert_eq!(migrate_api_url("http://vibe.henny.dev"), "http://vibe.henny.dev");
        assert_eq!(migrate_api_url(API_URL), API_URL);
    }

    #[test]
    fn relay_migration() {
        assert_eq!(migrate_relay("vibey.henny.dev:25565"), RELAY);
        assert_eq!(migrate_relay("vibey.henny.dev"), RELAY);
        assert_eq!(migrate_relay("relay.axolite.cc:25565"), RELAY);
        assert_eq!(migrate_relay("127.0.0.1:25566"), "127.0.0.1:25566");
        assert_eq!(migrate_relay("vibey.henny.dev:30000"), "vibey.henny.dev:30000");
        assert_eq!(RELAY.split(':').nth(1), LEGACY_RELAY.split(':').nth(1), "gleicher Port");
    }

    #[test]
    fn hosts() {
        assert_eq!(backend_hosts(API_URL), vec!["vibe.axolite.app", "vibe.henny.dev"]);
        assert_eq!(backend_hosts(LEGACY_API_URL), vec!["vibe.axolite.app", "vibe.henny.dev"]);
        assert_eq!(backend_hosts("http://127.0.0.1:3917"), vec!["127.0.0.1"]);
        assert!(backend_hosts("kaputt").is_empty());
    }

    #[test]
    fn invite_links() {
        assert_eq!(official_invite_code("https://axolite.cc/j/k3x9q2").as_deref(), Some("k3x9q2"));
        assert_eq!(official_invite_code("https://axolite.cc/j/k3x9q2/").as_deref(), Some("k3x9q2"));
        assert_eq!(official_invite_code("https://vibe.henny.dev/j/k3x9q2").as_deref(), Some("k3x9q2"));
        assert_eq!(official_invite_code("https://vibe.axolite.app/j/k3x9q2").as_deref(), Some("k3x9q2"));
        assert_eq!(official_invite_code("http://axolite.cc/j/k3x9q2"), None);
        assert_eq!(official_invite_code("https://axolite.cc/j/k3x9q2?x=1"), None);
        assert_eq!(official_invite_code("https://axolite.cc.evil.example/j/k3x9q2"), None);
        assert_eq!(official_invite_code("https://api.axolite.app/j/k3x9q2"), None);
        assert_eq!(official_invite_code("https://axolite.cc/p/k3x9q2"), None);
        assert_eq!(official_invite_code("https://axolite.cc/j/K3X9Q0"), None);
    }

    #[test]
    fn server_address_conversion() {
        assert_eq!(modern_server_address("mossy-otter-27.vibey.henny.dev").as_deref(), Some("mossy-otter-27.axolite.cc"));
        assert_eq!(modern_server_address("Mossy-Otter-27.VIBEY.henny.dev:25566").as_deref(), Some("mossy-otter-27.axolite.cc:25566"));
        assert_eq!(modern_server_address(" a.vibey.henny.dev. ").as_deref(), Some("a.axolite.cc"));
        assert_eq!(modern_server_address("vibey.henny.dev"), None);
        assert_eq!(modern_server_address("evilvibey.henny.dev"), None);
        assert_eq!(modern_server_address("a.vibey.henny.dev.evil.example"), None);
        assert_eq!(modern_server_address("mossy-otter-27.axolite.cc"), None);
        assert_eq!(modern_server_address("play.hypixel.net"), None);
    }
}
