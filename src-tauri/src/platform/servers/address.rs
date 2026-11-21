use super::*;

/// "host", "host:port", "[ipv6]:port" -> (host, port). Prüft auf erlaubte Zeichen.
pub fn parse_address(addr: &str) -> AppResult<(String, u16)> {
    let a = addr.trim();
    let bad = || AppError::Invalid(format!("Ungültige Serveradresse: {a}"));
    if a.is_empty() || a.len() > 253 + 6 {
        return Err(bad());
    }
    let (host, port) = if let Some(rest) = a.strip_prefix('[') {
        let end = rest.find(']').ok_or_else(bad)?;
        let host = &rest[..end];
        let port = rest[end + 1..]
            .strip_prefix(':')
            .map(|p| p.parse::<u16>().map_err(|_| bad()))
            .transpose()?;
        (host.to_string(), port.unwrap_or(25565))
    } else {
        match a.rsplit_once(':') {
            Some((h, p)) if !h.contains(':') => {
                (h.to_string(), p.parse::<u16>().map_err(|_| bad())?)
            }
            _ => (a.to_string(), 25565),
        }
    };
    if host.is_empty()
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':'))
    {
        return Err(bad());
    }
    Ok((host, port))
}

/// Quick Play (`--quickPlayMultiplayer`) gibt es ab Minecraft 1.20 bzw. Snapshot 23w14a.
pub fn supports_quick_play(mc: &str) -> bool {
    let num = |s: &str| {
        s.split(|c: char| !c.is_ascii_digit())
            .next()
            .and_then(|x| x.parse::<u32>().ok())
    };
    if let Some(rest) = mc.strip_prefix("1.") {
        return num(rest).is_some_and(|m| m >= 20);
    }
    if let Some((y, w)) = mc.split_once('w') {
        if let (Some(y), Some(w)) = (num(y), num(w)) {
            return y > 23 || (y == 23 && w >= 14);
        }
    }
    num(mc).is_some_and(|m| m >= 2)
}
