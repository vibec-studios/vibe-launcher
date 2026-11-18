//! NoRisk Client (Standalone-Mod) und NoRisk Mini als Community-Packs.
//!
//! - Quelle: die öffentliche Download-Liste der NoRisk-Website, `GET https://norisk.gg/api/downloads`
//!   → `{ release, mods: [{loader, mcVersion, href}], mini: [...] }`. Nicht dokumentiert: jeder Fehler wird zu
//!   „NoRisk ist gerade nicht erreichbar“ (die Oberfläche verlinkt dann norisk.gg). Die Liste bleibt 10 min im
//!   Speicher, nie auf der Platte.
//! - `href` (`https://api.norisk.gg/api/v1/payback/mod-downloads/{standalone|mini}/{mc}/{loader}/download`) ist ein
//!   GET, der per 302 auf das Jar in `maven.norisk.gg` weiterleitet (HEAD liefert 404).
//! - Lizenz der Jars: ARR. Deshalb nur auf Klick, immer frisch über genau diesen Link, nie zwischengespeichert
//!   oder verändert – das Jar landet unverändert in `mods/` der Instanz.
//! - Version: Dateiname nach der Weiterleitung, z. B. `nrc-mini-26.4.3940900+fabric.26.3.jar`. Für die
//!   Update-Prüfung reicht der `Location`-Header (GET ohne Weiterleitung, das Jar wird dabei nicht geladen).
use crate::error::{AppError, AppResult};
use crate::instance::LoaderKind;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use url::Url;

pub const LIST_URL: &str = "https://norisk.gg/api/downloads";
pub const WEBSITE: &str = "https://norisk.gg";
const HREF_PREFIX: &str = "https://api.norisk.gg/api/v1/payback/mod-downloads/";
const LIST_TTL: Duration = Duration::from_secs(10 * 60);
/// Obergrenze für ein Jar (Schutz vor unsinnigen Antworten)
const MAX_JAR: usize = 256 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Flavor {
    /// NoRisk Client als Standalone-Mod (`mods` in der Liste)
    Standalone,
    /// NoRisk Mini (`mini`)
    Mini,
}

impl Flavor {
    /// Pfadsegment im Download-Link
    pub fn segment(self) -> &'static str {
        match self {
            Flavor::Standalone => "standalone",
            Flavor::Mini => "mini",
        }
    }
    /// Präfix des Jar-Namens auf dem Maven
    fn file_prefix(self) -> &'static str {
        match self {
            Flavor::Standalone => "nrc-standalone-",
            Flavor::Mini => "nrc-mini-",
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Flavor::Standalone => "NoRisk Client",
            Flavor::Mini => "NoRisk Mini",
        }
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub loader: String,
    pub mc_version: String,
    pub href: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct DownloadList {
    #[serde(default)]
    pub mods: Vec<Entry>,
    #[serde(default)]
    pub mini: Vec<Entry>,
}

/// Loader-Name in der Liste (Quilt/Vanilla gibt es nicht).
pub fn loader_name(kind: LoaderKind) -> Option<&'static str> {
    match kind {
        LoaderKind::Fabric => Some("fabric"),
        LoaderKind::Forge => Some("forge"),
        LoaderKind::Neoforge => Some("neoforge"),
        LoaderKind::Quilt | LoaderKind::Vanilla => None,
    }
}

impl DownloadList {
    pub fn entries(&self, f: Flavor) -> &[Entry] {
        match f {
            Flavor::Standalone => &self.mods,
            Flavor::Mini => &self.mini,
        }
    }

    /// Eintrag für genau diese Minecraft-Version + diesen Loader (nur gültige offizielle Links).
    pub fn select(&self, f: Flavor, mc: &str, loader: LoaderKind) -> Option<&Entry> {
        let l = loader_name(loader)?;
        self.entries(f).iter().find(|e| e.loader.eq_ignore_ascii_case(l) && e.mc_version == mc && valid_href(&e.href, f))
    }

    /// Alle Minecraft-Versionen eines Loaders (neueste zuerst, wie in der Liste).
    pub fn mc_versions(&self, f: Flavor, loader: LoaderKind) -> Vec<String> {
        let Some(l) = loader_name(loader) else { return vec![] };
        let mut out: Vec<String> = Vec::new();
        for e in self.entries(f).iter().filter(|e| e.loader.eq_ignore_ascii_case(l) && valid_href(&e.href, f)) {
            if !out.contains(&e.mc_version) {
                out.push(e.mc_version.clone());
            }
        }
        out
    }
}

/// Nur der offizielle Download-Endpunkt von NoRisk für die passende Variante.
pub fn valid_href(href: &str, f: Flavor) -> bool {
    let Some(rest) = href.strip_prefix(HREF_PREFIX) else { return false };
    let Ok(u) = Url::parse(href) else { return false };
    if u.scheme() != "https" || u.host_str() != Some("api.norisk.gg") || u.query().is_some() || u.fragment().is_some() {
        return false;
    }
    // {segment}/{mc}/{loader}/download
    let parts: Vec<&str> = rest.split('/').collect();
    parts.len() == 4
        && parts[0] == f.segment()
        && parts[3] == "download"
        && parts[1..3].iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_')) && *p != "." && *p != "..")
}

/// Weiterleitungen nur innerhalb von norisk.gg über HTTPS.
pub fn allowed_host(u: &Url) -> bool {
    u.scheme() == "https" && u.host_str().is_some_and(|h| h == "norisk.gg" || h.ends_with(".norisk.gg"))
}

/// Jar-Name aus der finalen URL (`…/nrc-mini-26.4.3940900+fabric.26.3.jar`).
pub fn file_from_url(u: &Url) -> Option<String> {
    let last = u.path_segments()?.next_back()?;
    let name = urlencoding::decode(last).ok()?.into_owned();
    crate::vibey_client::safe_file_name(&name, ".jar").ok()
}

/// Version aus dem Jar-Namen (`26.4.3940900+fabric.26.3`), `None` bei unbekanntem Schema.
pub fn version_from_file(file: &str, f: Flavor) -> Option<String> {
    let v = file.strip_prefix(f.file_prefix())?.strip_suffix(".jar")?;
    (!v.is_empty()).then(|| v.to_string())
}

/// Anzeige-Version ohne Build-Metadaten (`26.4.3940900`).
pub fn display_version(v: &str) -> &str {
    v.split('+').next().unwrap_or(v)
}

/// Fehlertext, wenn die Liste oder der Download nicht geht (die Oberfläche bietet norisk.gg als Ausweg an).
pub fn unreachable(detail: impl std::fmt::Display) -> AppError {
    AppError::msg(format!("NoRisk ist gerade nicht erreichbar ({detail}). Du kannst die Mod auf norisk.gg herunterladen."))
}

// ------------------------------------------------------------------ HTTP

fn client_follow() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(crate::net::USER_AGENT)
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::custom(|a| {
                if a.previous().len() >= 5 {
                    a.error("zu viele Weiterleitungen")
                } else if allowed_host(a.url()) {
                    a.follow()
                } else {
                    a.error("Weiterleitung außerhalb von norisk.gg")
                }
            }))
            .build()
            .expect("HTTP-Client")
    })
}

fn client_no_redirect() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(crate::net::USER_AGENT)
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("HTTP-Client")
    })
}

fn list_cache() -> &'static Mutex<Option<(Instant, DownloadList)>> {
    static C: OnceLock<Mutex<Option<(Instant, DownloadList)>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// Download-Liste (10 min im Speicher; `force` fragt neu).
pub async fn list(force: bool) -> AppResult<DownloadList> {
    if !force {
        if let Some((at, l)) = list_cache().lock().as_ref() {
            if at.elapsed() < LIST_TTL {
                return Ok(l.clone());
            }
        }
    }
    let r = client_follow().get(LIST_URL).header("accept", "application/json").timeout(Duration::from_secs(20)).send().await.map_err(unreachable)?;
    let status = r.status();
    if !status.is_success() {
        return Err(unreachable(format!("HTTP {}", status.as_u16())));
    }
    let body = r.bytes().await.map_err(unreachable)?;
    let l: DownloadList = serde_json::from_slice(&body).map_err(|_| unreachable("unerwartete Antwort"))?;
    if l.mods.is_empty() && l.mini.is_empty() {
        return Err(unreachable("leere Liste"));
    }
    *list_cache().lock() = Some((Instant::now(), l.clone()));
    Ok(l)
}

fn latest_cache() -> &'static Mutex<std::collections::HashMap<String, (Instant, String)>> {
    static C: OnceLock<Mutex<std::collections::HashMap<String, (Instant, String)>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// Aktueller Jar-Name hinter einem Link, ohne das Jar zu laden (nur `Location` der Weiterleitung).
pub async fn latest_file(entry: &Entry) -> AppResult<String> {
    if let Some((at, f)) = latest_cache().lock().get(&entry.href) {
        if at.elapsed() < LIST_TTL {
            return Ok(f.clone());
        }
    }
    let base = Url::parse(&entry.href).map_err(|_| unreachable("ungültiger Link"))?;
    let r = client_no_redirect().get(base.clone()).send().await.map_err(unreachable)?;
    if !r.status().is_redirection() {
        return Err(unreachable(format!("HTTP {}", r.status().as_u16())));
    }
    let loc = r.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()).ok_or_else(|| unreachable("keine Weiterleitung"))?;
    let target = base.join(loc).map_err(|_| unreachable("ungültige Weiterleitung"))?;
    if !allowed_host(&target) {
        return Err(unreachable("Weiterleitung außerhalb von norisk.gg"));
    }
    let file = file_from_url(&target).ok_or_else(|| unreachable("unerwarteter Dateiname"))?;
    latest_cache().lock().insert(entry.href.clone(), (Instant::now(), file.clone()));
    Ok(file)
}

/// Jar über den offiziellen Link laden (GET mit Weiterleitung). Liefert (Dateiname, Inhalt) unverändert.
pub async fn download(entry: &Entry, flavor: Flavor) -> AppResult<(String, bytes::Bytes)> {
    if !valid_href(&entry.href, flavor) {
        return Err(AppError::Invalid("Unerwarteter Download-Link in der NoRisk-Liste".into()));
    }
    let r = client_follow().get(&entry.href).timeout(Duration::from_secs(600)).send().await.map_err(unreachable)?;
    if !r.status().is_success() {
        return Err(unreachable(format!("HTTP {}", r.status().as_u16())));
    }
    let final_url = r.url().clone();
    if !allowed_host(&final_url) {
        return Err(unreachable("Weiterleitung außerhalb von norisk.gg"));
    }
    let file = file_from_url(&final_url).ok_or_else(|| unreachable("unerwarteter Dateiname"))?;
    if r.content_length().is_some_and(|n| n as usize > MAX_JAR) {
        return Err(AppError::msg("Die Datei von NoRisk ist unerwartet groß – Download abgebrochen."));
    }
    let bytes = r.bytes().await.map_err(unreachable)?;
    if bytes.len() > MAX_JAR || !bytes.starts_with(b"PK") {
        return Err(AppError::msg("Die Antwort von NoRisk ist kein gültiges Jar – Download verworfen."));
    }
    latest_cache().lock().insert(entry.href.clone(), (Instant::now(), file.clone()));
    Ok((file, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HREF: &str = "https://api.norisk.gg/api/v1/payback/mod-downloads";

    fn sample() -> DownloadList {
        serde_json::from_value(serde_json::json!({
            "release": { "version": "v0.6.30", "publishedAt": "2026-11-15T16:02:47Z", "sizes": {} },
            "mods": [
                { "loader": "fabric", "mcVersion": "26.3", "href": format!("{HREF}/standalone/26.3/fabric/download") },
                { "loader": "fabric", "mcVersion": "1.21.1", "href": format!("{HREF}/standalone/1.21.1/fabric/download") },
                { "loader": "neoforge", "mcVersion": "1.21.1", "href": format!("{HREF}/standalone/1.21.1/neoforge/download") },
                { "loader": "forge", "mcVersion": "1.8.9", "href": format!("{HREF}/standalone/1.8.9/forge/download") },
                // fremder Link wird ignoriert
                { "loader": "fabric", "mcVersion": "1.20.1", "href": "https://evil.example/standalone/1.20.1/fabric/download" }
            ],
            "mini": [
                { "loader": "fabric", "mcVersion": "26.3", "href": format!("{HREF}/mini/26.3/fabric/download") },
                { "loader": "fabric", "mcVersion": "26.2", "href": format!("{HREF}/mini/26.2/fabric/download") },
                // falsches Segment (standalone in der mini-Liste)
                { "loader": "fabric", "mcVersion": "1.21.1", "href": format!("{HREF}/standalone/1.21.1/fabric/download") }
            ],
            "neuesFeld": 1
        }))
        .unwrap()
    }

    #[test]
    fn select_matches_version_and_loader() {
        let l = sample();
        let e = l.select(Flavor::Standalone, "26.3", LoaderKind::Fabric).unwrap();
        assert!(e.href.ends_with("/standalone/26.3/fabric/download"));
        assert!(l.select(Flavor::Standalone, "1.21.1", LoaderKind::Neoforge).is_some());
        // Version gibt es nur für einen anderen Loader
        assert!(l.select(Flavor::Standalone, "26.3", LoaderKind::Neoforge).is_none());
        // Prefix-Treffer zählen nicht (26.3 ≠ 26.3.1, 1.21 ≠ 1.21.1)
        assert!(l.select(Flavor::Standalone, "26.3.1", LoaderKind::Fabric).is_none());
        assert!(l.select(Flavor::Standalone, "1.21", LoaderKind::Fabric).is_none());
        // Quilt/Vanilla gibt es nicht
        assert!(l.select(Flavor::Standalone, "26.3", LoaderKind::Quilt).is_none());
        assert!(l.select(Flavor::Standalone, "26.3", LoaderKind::Vanilla).is_none());
        // Mini getrennt von Standalone
        assert!(l.select(Flavor::Mini, "26.2", LoaderKind::Fabric).is_some());
        assert!(l.select(Flavor::Standalone, "26.2", LoaderKind::Fabric).is_none());
        // ungültige Links werden übersprungen
        assert!(l.select(Flavor::Standalone, "1.20.1", LoaderKind::Fabric).is_none());
        assert!(l.select(Flavor::Mini, "1.21.1", LoaderKind::Fabric).is_none());
        // Loader-Groß-/Kleinschreibung egal
        let mut l2 = l.clone();
        l2.mods[0].loader = "Fabric".into();
        assert!(l2.select(Flavor::Standalone, "26.3", LoaderKind::Fabric).is_some());
    }

    #[test]
    fn versions_per_loader() {
        let l = sample();
        assert_eq!(l.mc_versions(Flavor::Standalone, LoaderKind::Fabric), vec!["26.3", "1.21.1"]);
        assert_eq!(l.mc_versions(Flavor::Standalone, LoaderKind::Forge), vec!["1.8.9"]);
        assert_eq!(l.mc_versions(Flavor::Mini, LoaderKind::Fabric), vec!["26.3", "26.2"]);
        assert!(l.mc_versions(Flavor::Mini, LoaderKind::Quilt).is_empty());
    }

    #[test]
    fn hrefs() {
        assert!(valid_href(&format!("{HREF}/mini/26.3/fabric/download"), Flavor::Mini));
        assert!(!valid_href(&format!("{HREF}/mini/26.3/fabric/download"), Flavor::Standalone));
        assert!(!valid_href(&format!("{HREF}/mini/../fabric/download"), Flavor::Mini));
        assert!(!valid_href(&format!("{HREF}/mini/26.3/fabric/download?x=1"), Flavor::Mini));
        assert!(!valid_href(&format!("{HREF}/mini/26.3/fabric"), Flavor::Mini));
        assert!(!valid_href("http://api.norisk.gg/api/v1/payback/mod-downloads/mini/26.3/fabric/download", Flavor::Mini));
        assert!(!valid_href("https://api.norisk.gg.evil.example/api/v1/payback/mod-downloads/mini/26.3/fabric/download", Flavor::Mini));
    }

    #[test]
    fn redirect_hosts() {
        assert!(allowed_host(&Url::parse("https://maven.norisk.gg/x.jar").unwrap()));
        assert!(allowed_host(&Url::parse("https://norisk.gg/x").unwrap()));
        assert!(!allowed_host(&Url::parse("http://maven.norisk.gg/x.jar").unwrap()));
        assert!(!allowed_host(&Url::parse("https://evilnorisk.gg/x.jar").unwrap()));
        assert!(!allowed_host(&Url::parse("https://maven.norisk.gg.evil.example/x.jar").unwrap()));
    }

    #[test]
    fn file_and_version() {
        let u = Url::parse("https://maven.norisk.gg/repository/norisk-production/gg/norisk/nrc-mini/26.4.3940900+fabric.26.3/nrc-mini-26.4.3940900+fabric.26.3.jar").unwrap();
        let f = file_from_url(&u).unwrap();
        assert_eq!(f, "nrc-mini-26.4.3940900+fabric.26.3.jar");
        let v = version_from_file(&f, Flavor::Mini).unwrap();
        assert_eq!(v, "26.4.3940900+fabric.26.3");
        assert_eq!(display_version(&v), "26.4.3940900");
        assert_eq!(version_from_file(&f, Flavor::Standalone), None);
        // %2B wird dekodiert
        let u2 = Url::parse("https://maven.norisk.gg/a/nrc-standalone-26.4.1%2Bfabric.26.3.jar").unwrap();
        assert_eq!(file_from_url(&u2).unwrap(), "nrc-standalone-26.4.1+fabric.26.3.jar");
        // keine Pfade/fremden Endungen
        assert!(file_from_url(&Url::parse("https://maven.norisk.gg/a/evil.exe").unwrap()).is_none());
        assert!(file_from_url(&Url::parse("https://maven.norisk.gg/a/..%2Fevil.jar").unwrap()).is_none());
    }
}
