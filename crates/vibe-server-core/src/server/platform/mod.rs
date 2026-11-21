//! Plugin-Server-Software: Paper und Folia (PaperMC Fill-API v3, `fill.papermc.io`) sowie Purpur
//! (`api.purpurmc.org/v2`). Versionslisten, Builds (stabil/experimentell), Download mit Prüfsumme.
//!
//! Die alte PaperMC-API `api.papermc.io/v2` ist abgeschaltet; Fill v3 liefert je Build `channel`
//! (STABLE/BETA/ALPHA/RECOMMENDED), sha256 und die Mindest-Java-Version je Minecraft-Version.
//! Purpur liefert nur MD5 – das wird geprüft. Spigot/Bukkit gibt es nur per BuildTools (lokal kompilieren);
//! das bieten wir nicht an, Spigot-/Bukkit-Plugins laufen auf Paper.
use crate::error::{AppError, AppResult};
use crate::Core;
use crate::tasks::SubProgress;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

mod fill;
pub use fill::*;
mod purpur;
pub use purpur::*;

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

async fn get(state: &Core, url: &str, service: &str) -> AppResult<bytes::Bytes> {
    crate::content::http::cached(state, url.to_string(), state.net.client.get(url), service).await
}

pub async fn versions(state: &Core, kind: PlatformKind) -> AppResult<Vec<PlatformVersion>> {
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

pub async fn builds(state: &Core, kind: PlatformKind, mc: &str) -> AppResult<Vec<PlatformBuild>> {
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
pub async fn java_info(state: &Core, kind: PlatformKind, mc: &str) -> (Option<u32>, Vec<String>) {
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
pub async fn download(state: &Core, kind: PlatformKind, mc: &str, b: &PlatformBuild, force: bool, sp: &SubProgress) -> AppResult<PathBuf> {
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
mod tests;
