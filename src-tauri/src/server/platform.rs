//! Plugin-Server-Software: Paper und Folia (PaperMC Fill-API v3, `fill.papermc.io`) sowie Purpur
//! (`api.purpurmc.org/v2`). Versionslisten, Builds (stabil/experimentell), Download mit Prüfsumme.
//!
//! Die alte PaperMC-API `api.papermc.io/v2` ist abgeschaltet; Fill v3 liefert je Build `channel`
//! (STABLE/BETA/ALPHA/RECOMMENDED), sha256 und die Mindest-Java-Version je Minecraft-Version.
//! Purpur liefert nur MD5 – das wird geprüft. Spigot/Bukkit gibt es nur per BuildTools (lokal kompilieren);
//! das bieten wir nicht an, Spigot-/Bukkit-Plugins laufen auf Paper.
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::tasks::SubProgress;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const FILL: &str = "https://fill.papermc.io/v3";
pub const PURPUR: &str = "https://api.purpurmc.org/v2";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum PlatformKind {
    Paper,
    Purpur,
    Folia,
}

impl PlatformKind {
    pub fn as_str(self) -> &'static str {
        match self {
            PlatformKind::Paper => "paper",
            PlatformKind::Purpur => "purpur",
            PlatformKind::Folia => "folia",
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            PlatformKind::Paper => "Paper",
            PlatformKind::Purpur => "Purpur",
            PlatformKind::Folia => "Folia",
        }
    }
    /// Modrinth-Loader, deren Plugins auf dieser Software laufen (Reihenfolge = Vorzug).
    /// Folia braucht ausdrücklich Folia-fähige Plugins (eigenes Threading-Modell).
    pub fn plugin_loaders(self) -> &'static [&'static str] {
        match self {
            PlatformKind::Paper => &["paper", "spigot", "bukkit"],
            PlatformKind::Purpur => &["purpur", "paper", "spigot", "bukkit"],
            PlatformKind::Folia => &["folia"],
        }
    }
}

/// Gewählte Server-Software eines Plugin-Servers (`Server.platform`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Platform {
    pub kind: PlatformKind,
    /// Build-Nummer; `None` = beim Installieren neuesten stabilen Build wählen
    #[serde(default)]
    pub build: Option<String>,
}

/// Minecraft-Version, für die es Builds gibt.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PlatformVersion {
    pub id: String,
    /// Release (keine -pre/-rc/Snapshot-Version)
    pub release: bool,
    /// Von den Entwicklern noch unterstützt (nur Fill-API; Purpur: neueste Version)
    pub supported: bool,
    pub java_min: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BuildChannel {
    Stable,
    Beta,
    Alpha,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlatformBuild {
    pub id: String,
    pub channel: BuildChannel,
    /// ISO-8601
    pub time: Option<String>,
    /// Erste Commit-Zeile (Änderung)
    pub summary: Option<String>,
    pub file_name: String,
    pub url: String,
    pub size: Option<u64>,
    pub sha256: Option<String>,
    pub md5: Option<String>,
}

// ------------------------------------------------------------------ Fill-API (Paper, Folia)

#[derive(Deserialize)]
struct FillVersions {
    versions: Vec<FillVersionEntry>,
}

#[derive(Deserialize)]
struct FillVersionEntry {
    version: FillVersion,
}

#[derive(Deserialize)]
struct FillVersion {
    id: String,
    #[serde(default)]
    support: Option<FillSupport>,
    #[serde(default)]
    java: Option<FillJava>,
}

#[derive(Deserialize)]
struct FillSupport {
    #[serde(default)]
    status: String,
}

#[derive(Deserialize)]
struct FillJava {
    #[serde(default)]
    version: Option<FillJavaVersion>,
    #[serde(default)]
    flags: Option<FillJavaFlags>,
}

#[derive(Deserialize)]
struct FillJavaVersion {
    #[serde(default)]
    minimum: Option<u32>,
}

#[derive(Deserialize, Default)]
struct FillJavaFlags {
    #[serde(default)]
    recommended: Vec<String>,
}

#[derive(Deserialize)]
struct FillBuild {
    id: u64,
    #[serde(default)]
    time: Option<String>,
    #[serde(default)]
    channel: String,
    #[serde(default)]
    commits: Vec<FillCommit>,
    #[serde(default)]
    downloads: std::collections::HashMap<String, FillDownload>,
}

#[derive(Deserialize)]
struct FillCommit {
    #[serde(default)]
    message: String,
}

#[derive(Deserialize)]
struct FillDownload {
    name: String,
    #[serde(default)]
    checksums: FillChecksums,
    #[serde(default)]
    size: Option<u64>,
    url: String,
}

#[derive(Deserialize, Default)]
struct FillChecksums {
    #[serde(default)]
    sha256: Option<String>,
}

/// Release = nur Ziffern und Punkte (26.3, 1.21.11); alles mit -pre/-rc/Buchstaben ist Vorabversion.
pub fn is_release(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_digit() || c == '.')
}

fn first_line(s: &str) -> Option<String> {
    let l = s.lines().map(str::trim).find(|l| !l.is_empty())?;
    Some(l.chars().take(140).collect())
}

pub fn parse_fill_versions(b: &[u8]) -> AppResult<Vec<PlatformVersion>> {
    let v: FillVersions = serde_json::from_slice(b).map_err(|e| AppError::msg(format!("PaperMC: unerwartete Antwort ({e})")))?;
    Ok(v
        .versions
        .into_iter()
        .map(|e| PlatformVersion {
            release: is_release(&e.version.id),
            supported: e.version.support.as_ref().is_some_and(|s| s.status.eq_ignore_ascii_case("SUPPORTED")),
            java_min: e.version.java.as_ref().and_then(|j| j.version.as_ref()).and_then(|v| v.minimum),
            id: e.version.id,
        })
        .collect())
}

/// Mindest-Java + empfohlene JVM-Flags einer Version (Fill `/versions/{v}`).
pub fn parse_fill_version_java(b: &[u8]) -> (Option<u32>, Vec<String>) {
    #[derive(Deserialize)]
    struct One {
        version: FillVersion,
    }
    match serde_json::from_slice::<One>(b) {
        Ok(o) => {
            let j = o.version.java;
            let min = j.as_ref().and_then(|j| j.version.as_ref()).and_then(|v| v.minimum);
            let flags = j.and_then(|j| j.flags).map(|f| f.recommended).unwrap_or_default();
            (min, flags)
        }
        Err(_) => (None, vec![]),
    }
}

fn fill_channel(c: &str) -> BuildChannel {
    match c.to_ascii_uppercase().as_str() {
        "STABLE" | "RECOMMENDED" => BuildChannel::Stable,
        "BETA" => BuildChannel::Beta,
        _ => BuildChannel::Alpha,
    }
}

/// Builds neueste zuerst. Builds ohne Server-Download werden ausgelassen.
pub fn parse_fill_builds(b: &[u8]) -> AppResult<Vec<PlatformBuild>> {
    let list: Vec<FillBuild> = serde_json::from_slice(b).map_err(|e| AppError::msg(format!("PaperMC: unerwartete Antwort ({e})")))?;
    let mut out: Vec<(u64, PlatformBuild)> = list
        .into_iter()
        .filter_map(|b| {
            let d = b.downloads.get("server:default").or_else(|| b.downloads.values().next())?;
            Some((
                b.id,
                PlatformBuild {
                    id: b.id.to_string(),
                    channel: fill_channel(&b.channel),
                    time: b.time.clone(),
                    summary: b.commits.first().and_then(|c| first_line(&c.message)),
                    file_name: d.name.clone(),
                    url: d.url.clone(),
                    size: d.size,
                    sha256: d.checksums.sha256.clone().map(|s| s.to_ascii_lowercase()),
                    md5: None,
                },
            ))
        })
        .collect();
    out.sort_by_key(|x| std::cmp::Reverse(x.0));
    Ok(out.into_iter().map(|(_, b)| b).collect())
}

// ------------------------------------------------------------------ Purpur

#[derive(Deserialize)]
struct PurpurProject {
    #[serde(default)]
    versions: Vec<String>,
    #[serde(default)]
    metadata: Option<PurpurMeta>,
}

#[derive(Deserialize)]
struct PurpurMeta {
    #[serde(default)]
    current: Option<String>,
}

#[derive(Deserialize)]
struct PurpurDetailed {
    builds: PurpurDetailedBuilds,
}

#[derive(Deserialize)]
struct PurpurDetailedBuilds {
    #[serde(default)]
    all: Vec<PurpurBuild>,
}

#[derive(Deserialize)]
struct PurpurBuild {
    build: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    result: String,
    #[serde(default)]
    timestamp: Option<i64>,
    #[serde(default)]
    commits: Vec<PurpurCommit>,
    #[serde(default)]
    metadata: serde_json::Value,
    #[serde(default)]
    md5: Option<String>,
}

#[derive(Deserialize)]
struct PurpurCommit {
    #[serde(default)]
    description: String,
}

/// Purpur listet älteste zuerst -> neueste zuerst zurückgeben.
pub fn parse_purpur_versions(b: &[u8]) -> AppResult<Vec<PlatformVersion>> {
    let p: PurpurProject = serde_json::from_slice(b).map_err(|e| AppError::msg(format!("Purpur: unerwartete Antwort ({e})")))?;
    let current = p.metadata.and_then(|m| m.current);
    Ok(p
        .versions
        .into_iter()
        .rev()
        .map(|id| PlatformVersion { release: is_release(&id), supported: current.as_deref() == Some(id.as_str()), java_min: None, id })
        .collect())
}

/// `?detailed=true`-Antwort. Fehlgeschlagene Builds fallen weg; „experimental“ in den Metadaten -> Beta.
pub fn parse_purpur_builds(b: &[u8]) -> AppResult<Vec<PlatformBuild>> {
    let d: PurpurDetailed = serde_json::from_slice(b).map_err(|e| AppError::msg(format!("Purpur: unerwartete Antwort ({e})")))?;
    let mut out: Vec<(u64, PlatformBuild)> = d
        .builds
        .all
        .into_iter()
        .filter(|b| b.result.eq_ignore_ascii_case("SUCCESS"))
        .map(|b| {
            let n: u64 = b.build.parse().unwrap_or(0);
            let experimental = b.metadata.get("type").and_then(|t| t.as_str()).is_some_and(|t| t.eq_ignore_ascii_case("experimental"));
            let time = b.timestamp.and_then(chrono::DateTime::from_timestamp_millis).map(|t| t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
            (
                n,
                PlatformBuild {
                    url: format!("{PURPUR}/purpur/{}/{}/download", b.version, b.build),
                    file_name: format!("purpur-{}-{}.jar", b.version, b.build),
                    id: b.build,
                    channel: if experimental { BuildChannel::Beta } else { BuildChannel::Stable },
                    time,
                    summary: b.commits.first().and_then(|c| first_line(&c.description)),
                    size: None,
                    sha256: None,
                    md5: b.md5.map(|s| s.to_ascii_lowercase()),
                },
            )
        })
        .collect();
    out.sort_by_key(|x| std::cmp::Reverse(x.0));
    Ok(out.into_iter().map(|(_, b)| b).collect())
}

// ------------------------------------------------------------------ Auswahl

/// Build wählen: gewünschte Nummer, sonst neuester stabiler, sonst neuester überhaupt.
pub fn pick_build<'a>(builds: &'a [PlatformBuild], wanted: Option<&str>) -> Option<&'a PlatformBuild> {
    if let Some(w) = wanted.map(str::trim).filter(|w| !w.is_empty()) {
        return builds.iter().find(|b| b.id == w);
    }
    builds.iter().find(|b| b.channel == BuildChannel::Stable).or(builds.first())
}

/// Benötigte Java-Version: Maximum aus Mojang-Angabe und Mindestversion der Software.
/// Ist die Software strenger als Mojang, passt die Mojang-Laufzeit-Komponente nicht mehr -> keine Komponente.
pub fn java_requirement(mojang_major: u32, mojang_component: Option<String>, platform_min: Option<u32>) -> (u32, Option<String>) {
    match platform_min {
        Some(min) if min > mojang_major => (min, None),
        _ => (mojang_major, mojang_component),
    }
}

// ------------------------------------------------------------------ API-Aufrufe

async fn get(state: &AppState, url: &str, service: &str) -> AppResult<bytes::Bytes> {
    crate::content::http::cached(state, url.to_string(), state.net.client.get(url), service).await
}

pub async fn versions(state: &AppState, kind: PlatformKind) -> AppResult<Vec<PlatformVersion>> {
    match kind {
        PlatformKind::Paper | PlatformKind::Folia => {
            let b = get(state, &format!("{FILL}/projects/{}/versions", kind.as_str()), "PaperMC").await?;
            parse_fill_versions(&b)
        }
        PlatformKind::Purpur => {
            let b = get(state, &format!("{PURPUR}/purpur"), "Purpur").await?;
            parse_purpur_versions(&b)
        }
    }
}

pub async fn builds(state: &AppState, kind: PlatformKind, mc: &str) -> AppResult<Vec<PlatformBuild>> {
    let mc_enc = urlencoding::encode(mc);
    match kind {
        PlatformKind::Paper | PlatformKind::Folia => {
            let b = get(state, &format!("{FILL}/projects/{}/versions/{mc_enc}/builds", kind.as_str()), "PaperMC").await?;
            parse_fill_builds(&b)
        }
        PlatformKind::Purpur => {
            let b = get(state, &format!("{PURPUR}/purpur/{mc_enc}?detailed=true"), "Purpur").await?;
            parse_purpur_builds(&b)
        }
    }
}

/// Mindest-Java und empfohlene Flags (nur Fill-API).
pub async fn java_info(state: &AppState, kind: PlatformKind, mc: &str) -> (Option<u32>, Vec<String>) {
    match kind {
        PlatformKind::Paper | PlatformKind::Folia => {
            let url = format!("{FILL}/projects/{}/versions/{}", kind.as_str(), urlencoding::encode(mc));
            match get(state, &url, "PaperMC").await {
                Ok(b) => parse_fill_version_java(&b),
                Err(_) => (None, vec![]),
            }
        }
        PlatformKind::Purpur => (None, vec![]),
    }
}

fn md5_file(path: &Path) -> std::io::Result<String> {
    use md5::{Digest, Md5};
    use std::io::Read;
    let mut f = std::fs::File::open(path)?;
    let mut h = Md5::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

/// Datei gegen die Prüfsumme der API prüfen. `Ok(false)` = falsch; ohne Prüfsumme `Ok(true)`.
pub fn verify(path: &Path, b: &PlatformBuild) -> std::io::Result<bool> {
    if let Some(want) = &b.sha256 {
        return Ok(crate::net::sha256_file(path)?.eq_ignore_ascii_case(want));
    }
    if let Some(want) = &b.md5 {
        return Ok(md5_file(path)?.eq_ignore_ascii_case(want));
    }
    Ok(true)
}

/// Server-JAR eines Builds in den Cache laden (geprüft) und zurückgeben.
pub async fn download(state: &AppState, kind: PlatformKind, mc: &str, b: &PlatformBuild, force: bool, sp: &SubProgress) -> AppResult<PathBuf> {
    let safe = |s: &str| s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' }).collect::<String>();
    let cache = state.paths.meta().join("server-jars").join(kind.as_str()).join(safe(mc)).join(safe(&b.id)).join(safe(&b.file_name));
    if !force && cache.is_file() {
        let (c2, b2) = (cache.clone(), b.clone());
        if tokio::task::spawn_blocking(move || verify(&c2, &b2)).await?.unwrap_or(false) {
            return Ok(cache);
        }
    }
    let _ = tokio::fs::remove_file(&cache).await;
    sp.message(format!("{} {mc} (Build {}) wird geladen …", kind.name(), b.id));
    let item = crate::net::DownloadItem::new(&b.url, &cache).size(b.size);
    state.net.download_all(vec![item], Some(sp)).await?;
    let (c2, b2) = (cache.clone(), b.clone());
    let ok = tokio::task::spawn_blocking(move || verify(&c2, &b2)).await??;
    if !ok {
        let _ = tokio::fs::remove_file(&cache).await;
        return Err(AppError::msg(format!("{} Build {}: Prüfsumme stimmt nicht – Download beschädigt, bitte erneut versuchen.", kind.name(), b.id)));
    }
    Ok(cache)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILL_VERSIONS: &str = include_str!("testdata/fill-paper-versions.json");
    const FILL_BUILDS: &str = include_str!("testdata/fill-paper-builds.json");
    const PURPUR_PROJECT: &str = include_str!("testdata/purpur-project.json");
    const PURPUR_BUILDS: &str = include_str!("testdata/purpur-builds.json");

    #[test]
    fn fill_versions() {
        let v = parse_fill_versions(FILL_VERSIONS.as_bytes()).unwrap();
        assert_eq!(v[0], PlatformVersion { id: "26.3".into(), release: true, supported: true, java_min: Some(25) });
        let rc = v.iter().find(|x| x.id == "26.3-rc-3").unwrap();
        assert!(!rc.release && !rc.supported);
        assert_eq!(v.iter().find(|x| x.id == "1.20.4").unwrap().java_min, Some(17));
    }

    #[test]
    fn fill_version_java() {
        let one = r#"{"version":{"id":"1.21.11","support":{"status":"UNSUPPORTED","end":"2026-06-15"},
            "java":{"version":{"minimum":21},"flags":{"recommended":["-XX:+UseG1GC","-XX:+AlwaysPreTouch"]}}},"builds":[1,2]}"#;
        let (min, flags) = parse_fill_version_java(one.as_bytes());
        assert_eq!(min, Some(21));
        assert_eq!(flags, vec!["-XX:+UseG1GC", "-XX:+AlwaysPreTouch"]);
        assert_eq!(parse_fill_version_java(b"{}"), (None, vec![]));
    }

    #[test]
    fn fill_builds_and_pick() {
        let b = parse_fill_builds(FILL_BUILDS.as_bytes()).unwrap();
        // neueste zuerst, auch wenn die API anders sortiert
        assert_eq!(b.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["257", "256", "255", "254"]);
        assert_eq!(b[0].channel, BuildChannel::Alpha);
        assert_eq!(b[1].channel, BuildChannel::Beta);
        assert_eq!(b[2].channel, BuildChannel::Stable);
        assert_eq!(b[2].sha256.as_deref(), Some("a7116085a8ba88cf00771d5e61a2925007942092650811da7327dc23243f0cec"));
        assert_eq!(b[2].file_name, "paper-26.3-255.jar");
        assert_eq!(b[2].summary.as_deref(), Some("Add BlockSpreadEvent for Fire (#14442)"));
        // Auswahl: neuester stabiler; RECOMMENDED zählt als stabil
        assert_eq!(pick_build(&b, None).unwrap().id, "255");
        assert_eq!(b[3].channel, BuildChannel::Stable);
        assert_eq!(pick_build(&b, Some("257")).unwrap().id, "257");
        assert!(pick_build(&b, Some("999")).is_none());
        // nur experimentelle -> neuester
        let exp: Vec<PlatformBuild> = b.iter().filter(|x| x.channel != BuildChannel::Stable).cloned().collect();
        assert_eq!(pick_build(&exp, None).unwrap().id, "257");
        assert!(pick_build(&[], None).is_none());
    }

    #[test]
    fn purpur() {
        let v = parse_purpur_versions(PURPUR_PROJECT.as_bytes()).unwrap();
        assert_eq!(v[0].id, "26.3");
        assert!(v[0].supported && v[0].release);
        assert!(!v[1].supported);
        assert_eq!(v.last().unwrap().id, "1.14.1");
        let b = parse_purpur_builds(PURPUR_BUILDS.as_bytes()).unwrap();
        // FAILURE-Build 2660 fällt weg, experimentell -> Beta
        assert_eq!(b.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["2659", "2658", "2657"]);
        assert_eq!(b[0].channel, BuildChannel::Stable);
        assert_eq!(b[1].channel, BuildChannel::Beta);
        assert_eq!(b[0].md5.as_deref(), Some("e6010134e10554cfeb1952c4b520856c"));
        assert_eq!(b[0].url, "https://api.purpurmc.org/v2/purpur/26.3/2659/download");
        assert_eq!(b[0].time.as_deref(), Some("2026-11-16T19:58:27Z"));
        assert_eq!(pick_build(&b, None).unwrap().id, "2659");
    }

    #[test]
    fn releases() {
        assert!(is_release("26.3"));
        assert!(is_release("1.21.11"));
        assert!(!is_release("1.21.11-rc3"));
        assert!(!is_release("26.3-rc-3"));
        assert!(!is_release("1.13-pre7"));
        assert!(!is_release(""));
    }

    #[test]
    fn java_req() {
        assert_eq!(java_requirement(21, Some("java-runtime-delta".into()), Some(21)), (21, Some("java-runtime-delta".into())));
        assert_eq!(java_requirement(17, Some("java-runtime-gamma".into()), Some(21)), (21, None));
        assert_eq!(java_requirement(8, Some("jre-legacy".into()), None), (8, Some("jre-legacy".into())));
    }

    #[test]
    fn checksum_verify() {
        let dir = std::env::temp_dir().join(format!("vibe-plat-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("x.jar");
        std::fs::write(&f, b"hello").unwrap();
        let mut b = PlatformBuild {
            id: "1".into(),
            channel: BuildChannel::Stable,
            time: None,
            summary: None,
            file_name: "x.jar".into(),
            url: String::new(),
            size: None,
            sha256: Some("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824".into()),
            md5: None,
        };
        assert!(verify(&f, &b).unwrap());
        b.sha256 = Some("00".into());
        assert!(!verify(&f, &b).unwrap());
        b.sha256 = None;
        b.md5 = Some("5d41402abc4b2a76b9719d911017c592".into());
        assert!(verify(&f, &b).unwrap());
        b.md5 = Some("ffff".into());
        assert!(!verify(&f, &b).unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
