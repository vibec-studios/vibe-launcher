//! MinecraftCapes (https://minecraftcapes.net): Cape/Ohren des eigenen Accounts lesen und die Mod in
//! Instanzen verwalten. Verhalten wie die offizielle Mod (MinecraftCapes/minecraftcapes-mod,
//! `DownloadManager`/`PlayerHandler`): Profil per `GET /profile/{uuid}`, Texturen über `cape_url`/`ear_url`
//! (die base64-`textures` werden abgeschafft und bewusst ignoriert), Platten-Cache nach Datei-Hash,
//! Animation = vertikal gestapelte Frames (Höhe ≠ Breite/2), 100 ms pro Frame.
//!
//! Datenschutz: Es wird nur die UUID des eigenen Accounts abgefragt, hochgeladen wird nichts.
use crate::auth::skins::{data_url, png_dimensions};
use crate::content::index::ContentIndex;
use crate::content::{local, provider, ContentKind, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{Instance, LoaderKind};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const PROFILE_API: &str = "https://api.minecraftcapes.net/profile/";
pub const WEBSITE: &str = "https://minecraftcapes.net";
/// Modrinth-Projekt der Mod (Slug `minecraftcapes`)
pub const MOD_PROJECT_ID: &str = "9gNVPfzw";
/// Mod-ID in `fabric.mod.json`/`mods.toml` (für manuell installierte Dateien)
pub const MOD_ID: &str = "minecraftcapes";
/// Frame-Dauer animierter Capes (wie `PlayerHandler#getFrame`)
pub const FRAME_MS: u32 = 100;
/// Wie die Mod: 10 s Verbindungs-/Lese-Timeout
const TIMEOUT: Duration = Duration::from_secs(10);
/// Obergrenze für Texturen (animierte Capes können einige Frames haben)
const MAX_TEXTURE: usize = 8 * 1024 * 1024;

// ------------------------------------------------------------------ Profil

/// Antwort von `api.minecraftcapes.net/profile/{id}` (nur die Felder, die die Mod auch nutzt).
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct RawProfile {
    #[serde(rename = "capeGlint")]
    pub cape_glint: bool,
    #[serde(rename = "upsideDown")]
    pub upside_down: bool,
    pub cape_url: Option<String>,
    pub ear_url: Option<String>,
}

pub fn parse_profile(body: &[u8]) -> AppResult<RawProfile> {
    serde_json::from_slice(body).map_err(|e| AppError::msg(format!("Ungültige Antwort von MinecraftCapes: {e}")))
}

/// Kennung für die API wie in der Mod: UUID (v4) ohne Bindestriche, sonst ein gültiger Spielername.
pub fn identifier(uuid: &str, name: &str) -> Option<String> {
    let hex: String = uuid.chars().filter(|c| *c != '-').collect::<String>().to_ascii_lowercase();
    if hex.len() == 32 && hex.bytes().all(|b| b.is_ascii_hexdigit()) && hex.as_bytes()[12] == b'4' {
        return Some(hex);
    }
    crate::auth::skins::valid_player_name(name).then(|| name.to_string())
}

/// Nur HTTPS-URLs von minecraftcapes.net akzeptieren.
fn texture_url_ok(url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else { return false };
    u.scheme() == "https" && u.host_str().is_some_and(|h| h == "minecraftcapes.net" || h.ends_with(".minecraftcapes.net"))
}

/// Cache-Pfad wie in der Mod: `<typ>/<erste 2 Zeichen>/<hash>` (Hash = letzter URL-Teil).
/// `None`, wenn der Hash keine harmlose Zeichenkette ist.
pub fn cache_path(root: &Path, kind: &str, url: &str) -> Option<PathBuf> {
    let hash = url.split(['?', '#']).next()?.rsplit('/').next()?;
    if hash.is_empty() || hash.len() > 128 || !hash.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
        return None;
    }
    let prefix = if hash.len() > 2 { &hash[..2] } else { "xx" };
    Some(root.join(kind).join(prefix).join(hash))
}

/// Aufteilung einer Cape-Textur, wie sie die Mod vornimmt (`PlayerHandler#applyCape`).
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub struct CapeLayout {
    /// Größe der Originaldatei
    pub width: u32,
    pub height: u32,
    /// Anzahl Frames (1 = statisch)
    pub frames: u32,
    /// Ausschnitt je Frame (von oben nach unten gestapelt)
    pub frame_width: u32,
    pub frame_height: u32,
    /// Zielgröße der Textur je Frame (statische Capes werden oben links in 64×32·2ⁿ eingesetzt)
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub frame_ms: u32,
}

pub fn cape_layout(width: u32, height: u32) -> Option<CapeLayout> {
    if width < 2 || height == 0 {
        return None;
    }
    let half = width / 2;
    if height != half {
        // Animiert: Frames der Größe Breite × Breite/2, Rest wird (wie in der Mod) ignoriert
        let frames = height / half;
        if frames == 0 {
            return None;
        }
        return Some(CapeLayout { width, height, frames, frame_width: width, frame_height: half, canvas_width: width, canvas_height: half, frame_ms: FRAME_MS });
    }
    let (mut cw, mut ch) = (64u32, 32u32);
    while cw < width || ch < height {
        cw *= 2;
        ch *= 2;
    }
    Some(CapeLayout { width, height, frames: 1, frame_width: width, frame_height: height, canvas_width: cw, canvas_height: ch, frame_ms: FRAME_MS })
}

#[derive(Debug, Clone, Serialize)]
pub struct McCape {
    pub data_url: String,
    pub layout: CapeLayout,
}

#[derive(Debug, Clone, Serialize)]
pub struct McEars {
    /// 14×7-Textur (Ohren-Layout wie die Deadmau5-Ohren)
    pub data_url: String,
}

/// Profil fürs Frontend.
#[derive(Debug, Clone, Serialize)]
pub struct McProfile {
    pub account_id: String,
    pub cape: Option<McCape>,
    pub ears: Option<McEars>,
    pub glint: bool,
    pub upside_down: bool,
    /// Textur angegeben, aber nicht ladbar
    pub texture_error: bool,
}

async fn get_limited(client: &reqwest::Client, url: &str) -> AppResult<Vec<u8>> {
    let resp = client.get(url).timeout(TIMEOUT).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("MinecraftCapes antwortet mit HTTP {}", resp.status().as_u16())));
    }
    if resp.content_length().is_some_and(|l| l as usize > MAX_TEXTURE) {
        return Err(AppError::msg("Antwort von MinecraftCapes ist zu groß"));
    }
    let b = resp.bytes().await?;
    if b.len() > MAX_TEXTURE {
        return Err(AppError::msg("Antwort von MinecraftCapes ist zu groß"));
    }
    Ok(b.to_vec())
}

/// Nur vollständige Dateien veröffentlichen (tmp + rename), damit nie halbe Texturen im Cache liegen.
async fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir).await?;
    }
    let tmp = path.with_extension("tmp");
    tokio::fs::write(&tmp, bytes).await?;
    if let Err(e) = tokio::fs::rename(&tmp, path).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e);
    }
    Ok(())
}

/// Textur aus dem Cache oder herunterladen (nur gültige PNGs werden gespeichert).
async fn texture(client: &reqwest::Client, cache_root: &Path, kind: &str, url: &str) -> AppResult<Vec<u8>> {
    if !texture_url_ok(url) {
        return Err(AppError::Invalid(format!("Unerwartete Textur-Adresse: {url}")));
    }
    let path = cache_path(cache_root, kind, url);
    if let Some(p) = &path {
        if let Ok(b) = tokio::fs::read(p).await {
            if png_dimensions(&b).is_some() {
                return Ok(b);
            }
        }
    }
    let b = get_limited(client, url).await?;
    if png_dimensions(&b).is_none() {
        return Err(AppError::msg("MinecraftCapes lieferte kein PNG"));
    }
    if let Some(p) = path {
        // Fehler beim Cachen dürfen die Anzeige nicht verhindern
        if let Err(e) = write_atomic(&p, &b).await {
            tracing::warn!("MinecraftCapes-Textur nicht gecacht ({}): {e}", p.display());
        }
    }
    Ok(b)
}

pub fn cache_root(state: &AppState) -> PathBuf {
    state.paths.cache().join("minecraftcapes")
}

pub async fn fetch(state: &AppState, account_id: &str, ident: &str) -> AppResult<McProfile> {
    let client = &state.net.client;
    let body = get_limited(client, &format!("{PROFILE_API}{}", urlencoding::encode(ident))).await?;
    let raw = parse_profile(&body)?;
    let root = cache_root(state);
    let mut texture_error = false;
    let cape = match raw.cape_url.as_deref() {
        Some(url) => match texture(client, &root, "capes", url).await {
            Ok(b) => match png_dimensions(&b).and_then(|(w, h)| cape_layout(w, h)) {
                Some(layout) => Some(McCape { data_url: data_url(&b), layout }),
                None => {
                    texture_error = true;
                    None
                }
            },
            Err(e) => {
                tracing::warn!("MinecraftCapes-Cape nicht ladbar: {e}");
                texture_error = true;
                None
            }
        },
        None => None,
    };
    let ears = match raw.ear_url.as_deref() {
        Some(url) => match texture(client, &root, "ears", url).await {
            Ok(b) => Some(McEars { data_url: data_url(&b) }),
            Err(e) => {
                tracing::warn!("MinecraftCapes-Ohren nicht ladbar: {e}");
                texture_error = true;
                None
            }
        },
        None => None,
    };
    Ok(McProfile { account_id: account_id.to_string(), cape, ears, glint: raw.cape_glint, upside_down: raw.upside_down, texture_error })
}

// ------------------------------------------------------------------ Mod in Instanzen

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Unsupported {
    /// Instanz ohne Mod-Loader
    Vanilla,
    /// Keine Version für Loader + Minecraft-Version
    NoVersion,
    /// Modrinth nicht erreichbar
    Offline,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModStatus {
    pub instance_id: String,
    pub installed: bool,
    /// Installierte Dateien (Ordner `mods`)
    pub files: Vec<String>,
    /// Version, die installiert würde
    pub version_number: Option<String>,
    pub unsupported: Option<Unsupported>,
}

/// Dateien der Mod in einer Instanz (über den Inhalts-Index oder die Mod-ID der Datei).
async fn installed_files(state: &AppState, inst: &Instance) -> AppResult<Vec<String>> {
    let (scanned, idx): (_, ContentIndex) = local::scan(state, &inst.id, ContentKind::Mod).await?;
    let keys = idx.keys_of_project(Source::Modrinth, MOD_PROJECT_ID);
    Ok(scanned
        .into_iter()
        .filter(|s| keys.contains(&s.key) || s.meta.mod_id.as_deref() == Some(MOD_ID))
        .map(|s| s.file_name)
        .collect())
}

pub async fn status(state: &AppState, inst: &Instance) -> ModStatus {
    let files = installed_files(state, inst).await.unwrap_or_default();
    let mut st = ModStatus { instance_id: inst.id.clone(), installed: !files.is_empty(), files, version_number: None, unsupported: None };
    if inst.loader.kind == LoaderKind::Vanilla {
        st.unsupported = Some(Unsupported::Vanilla);
        return st;
    }
    match provider::versions_for(state, Source::Modrinth, MOD_PROJECT_ID, Some(&inst.mc_version), Some(inst.loader.kind)).await {
        Ok((list, pref, _)) => match provider::pick_best(&list, pref.as_deref()) {
            Some(v) => st.version_number = Some(v.version_number),
            None => st.unsupported = Some(Unsupported::NoVersion),
        },
        Err(e) => {
            tracing::warn!("MinecraftCapes-Versionen nicht abrufbar: {e}");
            st.unsupported = Some(Unsupported::Offline);
        }
    }
    st
}

/// Mod deinstallieren (Pflicht-Abhängigkeiten wie die Fabric API bleiben, andere Mods brauchen sie evtl.).
pub async fn uninstall(state: &AppState, inst: &Instance) -> AppResult<()> {
    let files = installed_files(state, inst).await?;
    if files.is_empty() {
        return Ok(());
    }
    local::remove(state, &inst.id, ContentKind::Mod, &files).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_profile_with_textures() {
        let body = br#"{"animatedCape":true,"capeGlint":true,"upsideDown":false,"animated_cape_url":null,
            "cape_url":"https://textures.minecraftcapes.net/capes/6c95d3509caa","ear_url":"https://textures.minecraftcapes.net/ears/0ed6ea78",
            "textures":{"_IMPORTANT":"We are removing base64 textures","cape":"iVBORw0KGgo=","ears":null}}"#;
        let p = parse_profile(body).unwrap();
        assert!(p.cape_glint);
        assert!(!p.upside_down);
        assert_eq!(p.cape_url.as_deref(), Some("https://textures.minecraftcapes.net/capes/6c95d3509caa"));
        assert_eq!(p.ear_url.as_deref(), Some("https://textures.minecraftcapes.net/ears/0ed6ea78"));
    }

    #[test]
    fn parses_empty_and_minimal_profiles() {
        let empty = br#"{"animatedCape":false,"capeGlint":false,"upsideDown":false,"cape_url":null,"ear_url":null,"textures":{"cape":null,"ears":null}}"#;
        assert_eq!(parse_profile(empty).unwrap(), RawProfile::default());
        // Ältere Antworten ohne die URL-Felder
        let old = br#"{"animatedCape":false,"capeGlint":false,"upsideDown":true,"textures":{}}"#;
        let p = parse_profile(old).unwrap();
        assert!(p.upside_down);
        assert!(p.cape_url.is_none() && p.ear_url.is_none());
        assert!(parse_profile(b"<html>").is_err());
    }

    #[test]
    fn identifier_like_the_mod() {
        assert_eq!(identifier("ba4161c0-3a42-496c-8ae0-7d13372f3371", "james090500").as_deref(), Some("ba4161c03a42496c8ae07d13372f3371"));
        assert_eq!(identifier("BA4161C03A42496C8AE07D13372F3371", "x").as_deref(), Some("ba4161c03a42496c8ae07d13372f3371"));
        // Keine v4-UUID (z. B. Offline-UUID v3) -> Name
        assert_eq!(identifier("ba4161c0-3a42-396c-8ae0-7d13372f3371", "Steve").as_deref(), Some("Steve"));
        assert_eq!(identifier("", "bad name"), None);
        assert_eq!(identifier("", "../x"), None);
    }

    #[test]
    fn cache_path_by_hash() {
        let root = Path::new("cache");
        assert_eq!(cache_path(root, "capes", "https://textures.minecraftcapes.net/capes/6c95d3"), Some(root.join("capes").join("6c").join("6c95d3")));
        assert_eq!(cache_path(root, "ears", "https://x.minecraftcapes.net/ears/ab"), Some(root.join("ears").join("xx").join("ab")));
        assert_eq!(cache_path(root, "capes", "https://x/capes/.."), None);
        assert_eq!(cache_path(root, "capes", "https://x/capes/"), None);
    }

    #[test]
    fn only_minecraftcapes_texture_urls() {
        assert!(texture_url_ok("https://textures.minecraftcapes.net/capes/abc"));
        assert!(!texture_url_ok("http://textures.minecraftcapes.net/capes/abc"));
        assert!(!texture_url_ok("https://evil.example/capes/abc"));
        assert!(!texture_url_ok("https://minecraftcapes.net.evil.example/x"));
    }

    #[test]
    fn static_cape_layouts() {
        let l = cape_layout(64, 32).unwrap();
        assert_eq!((l.frames, l.canvas_width, l.canvas_height), (1, 64, 32));
        let hd = cape_layout(256, 128).unwrap();
        assert_eq!((hd.frames, hd.canvas_width, hd.canvas_height), (1, 256, 128));
        // Krumme Größen werden oben links in die nächste 64×32·2ⁿ-Fläche gesetzt
        let odd = cape_layout(100, 50).unwrap();
        assert_eq!((odd.frames, odd.frame_width, odd.frame_height, odd.canvas_width, odd.canvas_height), (1, 100, 50, 128, 64));
    }

    #[test]
    fn animated_cape_frames() {
        // 64×32-Frames, 10 Stück übereinander
        let a = cape_layout(64, 320).unwrap();
        assert_eq!((a.frames, a.frame_width, a.frame_height, a.canvas_width, a.canvas_height, a.frame_ms), (10, 64, 32, 64, 32, 100));
        // Unvollständiger letzter Frame wird ignoriert (Ganzzahldivision wie in der Mod)
        assert_eq!(cape_layout(64, 330).unwrap().frames, 10);
        // Höhe ≠ Breite/2 gilt auch bei nur einem Frame als „animiert“ (Ausschnitt oben)
        let one = cape_layout(22, 17).unwrap();
        assert_eq!((one.frames, one.frame_width, one.frame_height), (1, 22, 11));
        // Zu niedrig für einen Frame -> unbrauchbar
        assert!(cape_layout(64, 20).is_none());
        assert!(cape_layout(1, 1).is_none());
        assert!(cape_layout(64, 0).is_none());
    }
}
