//! Ankündigungen des Backends (`GET /api/v1/announcements`, docs/DOMAINS.md): öffentlich, ohne Login.
//! Nur mit eingeschaltetem Vibe-Hauptschalter. Die Antwort wird hier streng geprüft (Länge, `https`-Links, Ablauf,
//! App, Version), damit das Frontend nur fertige Hinweise bekommt.
use super::Feature;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Fertiger Hinweis für das Frontend.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Announcement {
    pub id: String,
    /// "info" | "warn"
    pub level: String,
    pub title: String,
    pub body: String,
    /// Nur `https://…`
    pub url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Response {
    #[serde(default)]
    items: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct RawItem {
    id: String,
    #[serde(default)]
    level: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    until: Option<String>,
    #[serde(default)]
    apps: Option<Vec<String>>,
    #[serde(default)]
    max_version: Option<String>,
}

const APP: &str = "launcher";
const MAX_ITEMS: usize = 5;

/// Gültige Hinweis-ID: 1–64 Zeichen aus `[A-Za-z0-9._-]`.
pub fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

fn clip(s: &str, max: usize) -> String {
    let s: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() <= max {
        s
    } else {
        let mut out: String = s.chars().take(max - 1).collect();
        out.push('…');
        out
    }
}

fn https_url(u: &str) -> Option<String> {
    let p = url::Url::parse(u.trim()).ok()?;
    (p.scheme() == "https" && p.host_str().is_some() && u.len() <= 512).then(|| p.to_string())
}

/// Antwort prüfen und filtern. `now`: Unix-Sekunden, `version`: Version des Launchers.
pub fn sanitize(body: &str, now: i64, version: &str) -> Vec<Announcement> {
    let Ok(r) = serde_json::from_str::<Response>(body) else { return vec![] };
    let current = semver::Version::parse(version).ok();
    let mut out: Vec<Announcement> = Vec::new();
    for v in r.items {
        // Ein kaputter Eintrag verwirft nicht die ganze Liste
        let Ok(it) = serde_json::from_value::<RawItem>(v) else { continue };
        let id = it.id.trim().to_string();
        if !valid_id(&id) || out.iter().any(|a| a.id == id) {
            continue;
        }
        if let Some(apps) = &it.apps {
            if !apps.is_empty() && !apps.iter().any(|a| a.eq_ignore_ascii_case(APP)) {
                continue;
            }
        }
        if let Some(until) = it.until.as_deref().filter(|u| !u.trim().is_empty()) {
            match chrono::DateTime::parse_from_rfc3339(until.trim()) {
                Ok(t) if t.timestamp() > now => {}
                _ => continue,
            }
        }
        if let (Some(max), Some(cur)) = (it.max_version.as_deref().filter(|m| !m.trim().is_empty()), current.as_ref()) {
            match semver::Version::parse(max.trim().trim_start_matches('v')) {
                Ok(m) if *cur <= m => {}
                _ => continue,
            }
        }
        let title = clip(it.title.as_deref().unwrap_or(""), 120);
        let body = clip(it.body.as_deref().unwrap_or(""), 600);
        if title.is_empty() && body.is_empty() {
            continue;
        }
        let level = if it.level.as_deref().is_some_and(|l| l.eq_ignore_ascii_case("warn")) { "warn" } else { "info" };
        out.push(Announcement { id, level: level.into(), title, body, url: it.url.as_deref().and_then(https_url) });
        if out.len() >= MAX_ITEMS {
            break;
        }
    }
    out
}

/// Sprache für `?lang=`: nur "de" | "en"; alle anderen Sprachen bekommen Englisch.
fn lang_param(lang: &str) -> &'static str {
    if lang.eq_ignore_ascii_case("de") {
        "de"
    } else {
        "en"
    }
}

/// Ankündigungen abrufen. Hauptschalter aus -> `not_configured`, ohne Verbindung.
pub async fn fetch(state: &AppState, lang: &str) -> AppResult<Vec<Announcement>> {
    let base = super::ensure(state, Feature::Any)?;
    let version = env!("CARGO_PKG_VERSION");
    let url = format!("{base}/api/v1/announcements?app={APP}&version={}&lang={}", urlencoding::encode(version), lang_param(lang));
    let url = super::check_api_url(&base, &url)?;
    let r = state.net.client.get(url).header("accept", "application/json").timeout(Duration::from_secs(15)).send().await?;
    let status = r.status().as_u16();
    if status == 404 {
        return Ok(vec![]);
    }
    let body = r.text().await?;
    if !(200..300).contains(&status) {
        return Err(AppError::Msg(format!("Vibe-Server antwortet mit HTTP {status}")));
    }
    Ok(sanitize(&body, chrono::Utc::now().timestamp(), version))
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_795_000_000; // Nov. 2026

    #[test]
    fn contract_example() {
        let body = r#"{ "items": [ { "id": "domain-move-2026-11", "level": "info", "title": "Vibe zieht um",
            "body": "Neue Adressen vibe.axolite.app und *.axolite.cc.", "url": "https://vibe.axolite.app/news",
            "until": "2027-03-01T00:00:00Z", "apps": ["launcher", "client"], "max_version": null } ] }"#;
        let a = sanitize(body, NOW, "1.0.0-beta.4");
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].id, "domain-move-2026-11");
        assert_eq!(a[0].level, "info");
        assert_eq!(a[0].url.as_deref(), Some("https://vibe.axolite.app/news"));
    }

    #[test]
    fn filters() {
        let body = r#"{ "items": [
            { "id": "client-only", "title": "x", "apps": ["client"] },
            { "id": "expired", "title": "x", "until": "2020-01-01T00:00:00Z" },
            { "id": "bad-until", "title": "x", "until": "morgen" },
            { "id": "old-only", "title": "x", "max_version": "1.0.0-beta.3" },
            { "id": "böse", "title": "x" },
            { "id": "empty", "title": " ", "body": "" },
            { "id": 5, "title": "kaputt" },
            { "id": "warn", "level": "WARN", "title": "  Achtung \n bitte ", "url": "javascript:alert(1)" },
            { "id": "warn", "title": "doppelt" },
            { "id": "plain", "level": "danger", "body": "Nur Text", "url": "http://example.com" },
            { "id": "upto", "title": "x", "max_version": "1.0.0" }
        ] }"#;
        let a = sanitize(body, NOW, "1.0.0-beta.4");
        let ids: Vec<&str> = a.iter().map(|x| x.id.as_str()).collect();
        assert_eq!(ids, vec!["warn", "plain", "upto"]);
        assert_eq!(a[0].level, "warn");
        assert_eq!(a[0].title, "Achtung bitte");
        assert_eq!(a[0].url, None, "nur https-Links");
        assert_eq!(a[1].level, "info");
        assert_eq!(a[1].url, None);
    }

    #[test]
    fn garbage_is_empty() {
        assert!(sanitize("<html>", NOW, "1.0.0").is_empty());
        assert!(sanitize("{}", NOW, "1.0.0").is_empty());
        let long = format!(r#"{{"items":[{{"id":"a","title":"{}"}}]}}"#, "x".repeat(500));
        assert_eq!(sanitize(&long, NOW, "1.0.0")[0].title.chars().count(), 120);
    }

    #[test]
    fn ids_and_lang() {
        assert!(valid_id("domain-move-2026-11"));
        assert!(!valid_id(""));
        assert!(!valid_id("a b"));
        assert!(!valid_id(&"a".repeat(65)));
        assert_eq!(lang_param("EN"), "en");
        assert_eq!(lang_param("fr"), "en");
        assert_eq!(lang_param("de"), "de");
    }
}
