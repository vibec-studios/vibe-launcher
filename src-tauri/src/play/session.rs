use super::*;

/// Gültige, nicht veraltete `session.json` lesen.
pub fn read_session_file(path: &Path, now_secs: i64) -> Option<Session> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.len() > 64 * 1024 {
        return None;
    }
    parse_session(&bytes, now_secs)
}

pub fn parse_session(bytes: &[u8], now_secs: i64) -> Option<Session> {
    let s: Session = serde_json::from_slice(bytes).ok()?;
    if s.schema != 1 || !matches!(s.state.as_str(), "menu" | "singleplayer" | "hosting" | "multiplayer") {
        return None;
    }
    // Sekunden oder (falls ein Client Millisekunden schreibt) Millisekunden
    let at = if s.updated_at > 100_000_000_000 { s.updated_at / 1000 } else { s.updated_at };
    if now_secs - at > SESSION_STALE_SECS {
        return None;
    }
    Some(s)
}

pub fn read_session(state: &AppState, id: &str) -> Option<Session> {
    read_session_file(&vibe_dir(state, id).join("session.json"), chrono::Utc::now().timestamp())
}

/// Ist `url` ein Spiel-Link unseres Backends (`<base>/j/<code>`)? Nur solche Links zeigen wir an.
/// Beim offiziellen Backend zählen auch `https://axolite.cc/j/<code>` und die alte Adresse
/// `https://vibe.henny.dev/j/<code>` (ältere Vibey Clients schreiben sie in `session.json`).
pub fn is_play_link_url(api_base: &str, url: &str) -> bool {
    if crate::domains::is_official(api_base) && crate::domains::official_invite_code(url).is_some() {
        return true;
    }
    let (Ok(b), Ok(u)) = (url::Url::parse(api_base), url::Url::parse(url)) else { return false };
    let scheme_ok = u.scheme() == "https" || (u.scheme() == "http" && b.scheme() == "http");
    let code = u.path().strip_prefix("/j/").unwrap_or("");
    scheme_ok && u.host_str() == b.host_str() && u.port_or_known_default() == b.port_or_known_default() && valid_code(code) && u.query().is_none()
}
