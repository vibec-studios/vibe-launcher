//! Skins & Capes: Profil über Minecraft Services (Skin setzen/zurücksetzen, Cape wählen) und eine
//! lokale Skin-Bibliothek (`skins/<id>.png` + `skins.json` im Datenordner).
//!
//! OWNER: Auth-Agent. Bilder gehen als `data:`-URL ans Frontend (klein, kein CORS-Problem im 3D-Viewer).
use crate::error::{AppError, AppResult};
use crate::util::now_ms;
use base64::Engine;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};

const PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";
/// Payload: `{ scope: "library" }` oder `{ scope: "profile", account_id }`
pub const SKINS_CHANGED: &str = "skins://changed";
const MAX_PNG: usize = 512 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SkinVariant {
    #[default]
    Classic,
    Slim,
}

impl SkinVariant {
    pub fn api(self) -> &'static str {
        match self {
            SkinVariant::Classic => "classic",
            SkinVariant::Slim => "slim",
        }
    }
    pub fn from_api(s: &str) -> Self {
        if s.eq_ignore_ascii_case("slim") { SkinVariant::Slim } else { SkinVariant::Classic }
    }
}

/// Aktueller Skin eines Accounts.
#[derive(Debug, Clone, Serialize)]
pub struct ActiveSkin {
    pub id: String,
    pub url: String,
    pub variant: SkinVariant,
    /// PNG als data:-URL (None, wenn nicht ladbar)
    pub data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Cape {
    pub id: String,
    pub alias: String,
    pub url: String,
    /// "ACTIVE" | "INACTIVE"
    pub state: String,
    pub data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkinProfile {
    pub account_id: String,
    pub username: String,
    pub skin: Option<ActiveSkin>,
    pub capes: Vec<Cape>,
}

/// Eintrag der Bibliothek, wie ihn das Frontend sieht.
#[derive(Debug, Clone, Serialize)]
pub struct LibrarySkin {
    pub id: String,
    pub name: String,
    pub variant: SkinVariant,
    /// Dateiname im Ordner `skins/`
    pub file: String,
    pub added_at: i64,
    /// Herkunft, z. B. "file", "account:<name>", "player:<name>", "import:modrinth"
    pub source: Option<String>,
    /// Zugeordnetes Mojang-Cape (UUID), z. B. aus der Modrinth App übernommen
    pub cape_id: Option<String>,
    pub data_url: String,
}

// ------------------------------------------------------------------ Rohformat der API

#[derive(Debug, Deserialize)]
pub struct RawProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub skins: Vec<RawTexture>,
    #[serde(default)]
    pub capes: Vec<RawTexture>,
}

#[derive(Debug, Deserialize)]
pub struct RawTexture {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub variant: Option<String>,
    #[serde(default)]
    pub alias: Option<String>,
}

impl RawProfile {
    pub fn active_skin(&self) -> Option<&RawTexture> {
        self.skins.iter().find(|s| s.state.eq_ignore_ascii_case("active")).or(self.skins.first())
    }
}

// ------------------------------------------------------------------ Hilfen

/// Breite/Höhe aus dem PNG-Header (IHDR).
pub fn png_dimensions(b: &[u8]) -> Option<(u32, u32)> {
    const SIG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    if b.len() < 24 || b[..8] != SIG || &b[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes(b[16..20].try_into().ok()?);
    let h = u32::from_be_bytes(b[20..24].try_into().ok()?);
    Some((w, h))
}

/// Prüft, ob die Datei ein von Minecraft akzeptierter Skin ist (PNG 64×64 oder 64×32).
pub fn validate_skin_png(b: &[u8]) -> AppResult<()> {
    if b.len() > MAX_PNG {
        return Err(AppError::Invalid("Die Skin-Datei ist zu groß (max. 512 KB).".into()));
    }
    match png_dimensions(b) {
        None => Err(AppError::Invalid("Das ist keine PNG-Datei.".into())),
        Some((64, 64)) | Some((64, 32)) => Ok(()),
        Some((w, h)) => Err(AppError::Invalid(format!("Skins müssen 64×64 oder 64×32 Pixel groß sein (diese Datei: {w}×{h})."))),
    }
}

pub fn data_url(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
}

pub fn decode_png_payload(payload: &str) -> AppResult<Vec<u8>> {
    let s = payload.trim();
    let b64 = match s.strip_prefix("data:") {
        Some(rest) => rest.split_once(',').filter(|(head, _)| head.ends_with(";base64")).map(|(_, b)| b).ok_or_else(|| AppError::Invalid("Ungültige Bilddaten.".into()))?,
        None => s,
    };
    if b64.len() > MAX_PNG * 4 / 3 + 8 {
        return Err(AppError::Invalid("Die Skin-Datei ist zu groß (max. 512 KB).".into()));
    }
    let png = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|_| AppError::Invalid("Ungültige Bilddaten.".into()))?;
    validate_skin_png(&png)?;
    Ok(png)
}

/// Minecraft-Spielername (inkl. alter, kurzer Namen).
pub fn valid_player_name(n: &str) -> bool {
    (1..=16).contains(&n.len()) && n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Fehlerantworten der Minecraft-Services in verständliche Meldungen übersetzen.
pub fn services_error(status: u16, body: &[u8]) -> AppError {
    let v: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let detail = v["errorMessage"].as_str().or(v["details"]["reason"].as_str()).or(v["error"].as_str()).unwrap_or("").to_string();
    match status {
        429 => AppError::msg("Zu viele Skin-Änderungen – bitte kurz warten (etwa eine Minute) und erneut versuchen."),
        401 => AppError::Auth("Die Minecraft-Anmeldung ist abgelaufen – bitte den Account unter Accounts auffrischen.".into()),
        403 => AppError::msg("Minecraft erlaubt diese Änderung für diesen Account nicht."),
        404 => AppError::NotFound("Skin bzw. Cape (bei Minecraft nicht vorhanden)".into()),
        400 if !detail.is_empty() => AppError::Invalid(format!("Minecraft hat die Änderung abgelehnt: {detail}")),
        400 => AppError::Invalid("Minecraft hat die Skin-Datei abgelehnt (ungültiges Format?).".into()),
        s if s >= 500 => AppError::msg(format!("Minecraft-Dienste nicht erreichbar (HTTP {s}) – bitte später erneut versuchen.")),
        s => AppError::msg(format!("Skin-Änderung fehlgeschlagen (HTTP {s})")),
    }
}

async fn read_profile_response(resp: reqwest::Response) -> AppResult<RawProfile> {
    let status = resp.status().as_u16();
    let body = resp.bytes().await?;
    if !(200..300).contains(&status) {
        return Err(services_error(status, &body));
    }
    serde_json::from_slice(&body).map_err(|e| AppError::msg(format!("Ungültiges Minecraft-Profil: {e}")))
}

// ------------------------------------------------------------------ Minecraft Services

pub async fn fetch_profile(client: &reqwest::Client, token: &str) -> AppResult<RawProfile> {
    read_profile_response(client.get(PROFILE).bearer_auth(token).send().await?).await
}

pub async fn upload_skin(client: &reqwest::Client, token: &str, variant: SkinVariant, png: Vec<u8>) -> AppResult<RawProfile> {
    validate_skin_png(&png)?;
    let part = reqwest::multipart::Part::bytes(png).file_name("skin.png").mime_str("image/png").map_err(|e| AppError::msg(e.to_string()))?;
    let form = reqwest::multipart::Form::new().text("variant", variant.api()).part("file", part);
    read_profile_response(client.post(format!("{PROFILE}/skins")).bearer_auth(token).multipart(form).send().await?).await
}

pub async fn reset_skin(client: &reqwest::Client, token: &str) -> AppResult<RawProfile> {
    read_profile_response(client.delete(format!("{PROFILE}/skins/active")).bearer_auth(token).send().await?).await
}

pub async fn set_cape(client: &reqwest::Client, token: &str, cape_id: Option<&str>) -> AppResult<RawProfile> {
    let req = match cape_id {
        Some(id) => client.put(format!("{PROFILE}/capes/active")).json(&json!({ "capeId": id })),
        None => client.delete(format!("{PROFILE}/capes/active")),
    };
    read_profile_response(req.bearer_auth(token).send().await?).await
}

/// Textur laden (mit Datei-Cache – Textur-URLs sind inhaltsadressiert und ändern sich nie).
pub async fn fetch_texture(client: &reqwest::Client, cache_dir: &Path, url: &str) -> AppResult<Vec<u8>> {
    let url = url.replacen("http://textures.minecraft.net", "https://textures.minecraft.net", 1);
    let key = hex::encode(Sha1::digest(url.as_bytes()));
    let path = cache_dir.join(format!("{key}.png"));
    if let Ok(b) = tokio::fs::read(&path).await {
        if png_dimensions(&b).is_some() {
            return Ok(b);
        }
    }
    let resp = client.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("Textur konnte nicht geladen werden (HTTP {})", resp.status())));
    }
    let b = resp.bytes().await?.to_vec();
    if b.len() > MAX_PNG || png_dimensions(&b).is_none() {
        return Err(AppError::msg("Textur ist kein gültiges PNG"));
    }
    let _ = tokio::fs::create_dir_all(cache_dir).await;
    let _ = tokio::fs::write(&path, &b).await;
    Ok(b)
}

pub async fn build_profile(client: &reqwest::Client, cache_dir: &Path, account_id: &str, raw: &RawProfile) -> SkinProfile {
    let skin = match raw.active_skin() {
        Some(s) if !s.url.is_empty() => Some(ActiveSkin {
            id: s.id.clone(),
            url: s.url.clone(),
            variant: SkinVariant::from_api(s.variant.as_deref().unwrap_or("classic")),
            data_url: fetch_texture(client, cache_dir, &s.url).await.ok().map(|b| data_url(&b)),
        }),
        _ => None,
    };
    let caps = futures::future::join_all(raw.capes.iter().map(|c| async move {
        Cape {
            id: c.id.clone(),
            alias: c.alias.clone().unwrap_or_else(|| "Cape".into()),
            url: c.url.clone(),
            state: c.state.to_ascii_uppercase(),
            data_url: fetch_texture(client, cache_dir, &c.url).await.ok().map(|b| data_url(&b)),
        }
    }))
    .await;
    SkinProfile { account_id: account_id.to_string(), username: raw.name.clone(), skin, capes: caps }
}

// ------------------------------------------------------------------ Import per Spielername

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerSkin {
    pub name: String,
    pub url: String,
    pub variant: SkinVariant,
}

/// `textures`-Property des Session-Profils (Base64-JSON) auswerten.
pub fn parse_textures_property(value_b64: &str) -> Option<(String, SkinVariant)> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(value_b64.trim()).ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    let skin = &v["textures"]["SKIN"];
    let url = skin["url"].as_str()?.to_string();
    let variant = SkinVariant::from_api(skin["metadata"]["model"].as_str().unwrap_or("classic"));
    Some((url, variant))
}

pub async fn lookup_player(client: &reqwest::Client, name: &str) -> AppResult<PlayerSkin> {
    let name = name.trim();
    if !valid_player_name(name) {
        return Err(AppError::Invalid("Ungültiger Spielername (nur A–Z, 0–9 und _, höchstens 16 Zeichen).".into()));
    }
    let not_found = || AppError::NotFound(format!("Spieler „{name}“"));
    // Name -> UUID (api.mojang.com, Ersatz: Minecraft-Services-Lookup)
    let mut found: Option<(String, String)> = None;
    for url in [
        format!("https://api.mojang.com/users/profiles/minecraft/{name}"),
        format!("https://api.minecraftservices.com/minecraft/profile/lookup/name/{name}"),
    ] {
        let resp = client.get(&url).send().await?;
        let status = resp.status().as_u16();
        match status {
            200 => {
                let v: Value = resp.json().await.map_err(|e| AppError::msg(format!("Ungültige Antwort von Mojang: {e}")))?;
                if let (Some(id), Some(n)) = (v["id"].as_str(), v["name"].as_str()) {
                    found = Some((id.to_string(), n.to_string()));
                    break;
                }
            }
            204 | 404 => return Err(not_found()),
            429 => return Err(AppError::msg("Zu viele Anfragen an Mojang – bitte kurz warten.")),
            _ => continue,
        }
    }
    let (uuid, real_name) = found.ok_or_else(|| AppError::msg("Mojang-Dienst nicht erreichbar – bitte später erneut versuchen."))?;

    let resp = client.get(format!("https://sessionserver.mojang.com/session/minecraft/profile/{uuid}")).send().await?;
    match resp.status().as_u16() {
        200 => {}
        204 | 404 => return Err(not_found()),
        429 => return Err(AppError::msg("Zu viele Anfragen an Mojang – bitte kurz warten.")),
        s => return Err(AppError::msg(format!("Mojang-Sessionserver nicht erreichbar (HTTP {s})"))),
    }
    let v: Value = resp.json().await.map_err(|e| AppError::msg(format!("Ungültige Antwort von Mojang: {e}")))?;
    let prop = v["properties"]
        .as_array()
        .and_then(|a| a.iter().find(|p| p["name"] == "textures"))
        .and_then(|p| p["value"].as_str())
        .ok_or_else(|| AppError::msg("Mojang lieferte keine Texturen"))?;
    let (url, variant) =
        parse_textures_property(prop).ok_or_else(|| AppError::Invalid(format!("{real_name} nutzt den Standard-Skin (kein eigener Skin).")))?;
    Ok(PlayerSkin { name: real_name, url, variant })
}

// ------------------------------------------------------------------ Bibliothek

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredSkin {
    id: String,
    name: String,
    #[serde(default)]
    variant: SkinVariant,
    file: String,
    #[serde(default)]
    added_at: i64,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    sha1: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cape_id: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct LibraryFile {
    #[serde(default)]
    skins: Vec<StoredSkin>,
}

pub struct Library {
    dir: PathBuf,
    index: PathBuf,
    items: Mutex<Vec<StoredSkin>>,
}

impl Library {
    /// `root` = Datenordner des Launchers.
    pub fn load(root: &Path) -> Self {
        let dir = root.join("skins");
        let index = root.join("skins.json");
        let items = std::fs::read(&index)
            .ok()
            .and_then(|b| serde_json::from_slice::<LibraryFile>(&b).ok())
            .map(|f| f.skins)
            .unwrap_or_default()
            .into_iter()
            .filter(|s| dir.join(&s.file).is_file())
            .collect();
        Library { dir, index, items: Mutex::new(items) }
    }

    fn save(&self) -> AppResult<()> {
        let f = LibraryFile { skins: self.items.lock().clone() };
        crate::util::write_json_atomic(&self.index, &f)
    }

    fn to_public(&self, s: &StoredSkin) -> Option<LibrarySkin> {
        let bytes = std::fs::read(self.dir.join(&s.file)).ok()?;
        Some(LibrarySkin {
            id: s.id.clone(),
            name: s.name.clone(),
            variant: s.variant,
            file: s.file.clone(),
            added_at: s.added_at,
            source: s.source.clone(),
            cape_id: s.cape_id.clone(),
            data_url: data_url(&bytes),
        })
    }

    /// Neueste zuerst.
    pub fn list(&self) -> Vec<LibrarySkin> {
        let items = self.items.lock().clone();
        let mut out: Vec<LibrarySkin> = items.iter().filter_map(|s| self.to_public(s)).collect();
        out.sort_by_key(|s| std::cmp::Reverse(s.added_at));
        out
    }

    pub fn get(&self, id: &str) -> AppResult<LibrarySkin> {
        let s = self.items.lock().iter().find(|s| s.id == id).cloned().ok_or_else(|| AppError::NotFound("Skin".into()))?;
        self.to_public(&s).ok_or_else(|| AppError::NotFound("Skin-Datei".into()))
    }

    pub fn path(&self, id: &str) -> AppResult<PathBuf> {
        let s = self.items.lock().iter().find(|s| s.id == id).cloned().ok_or_else(|| AppError::NotFound("Skin".into()))?;
        Ok(self.dir.join(s.file))
    }

    pub fn bytes(&self, id: &str) -> AppResult<(Vec<u8>, SkinVariant)> {
        let variant = self.items.lock().iter().find(|s| s.id == id).map(|s| s.variant).ok_or_else(|| AppError::NotFound("Skin".into()))?;
        Ok((std::fs::read(self.path(id)?)?, variant))
    }

    /// Skin hinzufügen. Gleiche Datei (SHA-1) schon vorhanden -> vorhandenen Eintrag zurückgeben.
    pub fn add(&self, png: &[u8], name: &str, variant: SkinVariant, source: Option<String>) -> AppResult<LibrarySkin> {
        self.add_with(png, name, variant, source, None)
    }

    /// SHA-1 aller Bibliotheks-Skins (Duplikaterkennung beim Import).
    pub fn sha1s(&self) -> std::collections::HashSet<String> {
        self.items.lock().iter().map(|s| s.sha1.clone()).filter(|s| !s.is_empty()).collect()
    }

    /// Wie [`add`], optional mit Cape-Zuordnung.
    pub fn add_with(&self, png: &[u8], name: &str, variant: SkinVariant, source: Option<String>, cape_id: Option<String>) -> AppResult<LibrarySkin> {
        validate_skin_png(png)?;
        let sha = hex::encode(Sha1::digest(png));
        if let Some(existing) = self.items.lock().iter().find(|s| s.sha1 == sha).cloned() {
            return self.to_public(&existing).ok_or_else(|| AppError::NotFound("Skin-Datei".into()));
        }
        std::fs::create_dir_all(&self.dir)?;
        let id = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
        let file = format!("{id}.png");
        std::fs::write(self.dir.join(&file), png)?;
        let name = clean_name(name);
        let stored = StoredSkin { id: id.clone(), name, variant, file, added_at: now_ms(), source, sha1: sha, cape_id };
        self.items.lock().push(stored);
        self.save()?;
        self.get(&id)
    }

    pub fn modify(&self, id: &str, f: impl FnOnce(&mut StoredSkinEdit)) -> AppResult<LibrarySkin> {
        {
            let mut items = self.items.lock();
            let s = items.iter_mut().find(|s| s.id == id).ok_or_else(|| AppError::NotFound("Skin".into()))?;
            let mut e = StoredSkinEdit { name: s.name.clone(), variant: s.variant };
            f(&mut e);
            s.name = clean_name(&e.name);
            s.variant = e.variant;
        }
        self.save()?;
        self.get(id)
    }

    pub fn remove(&self, id: &str) -> AppResult<()> {
        let removed = {
            let mut items = self.items.lock();
            let pos = items.iter().position(|s| s.id == id).ok_or_else(|| AppError::NotFound("Skin".into()))?;
            items.remove(pos)
        };
        let _ = std::fs::remove_file(self.dir.join(&removed.file));
        self.save()
    }
}

/// Änderbare Felder eines Bibliothekseintrags.
pub struct StoredSkinEdit {
    pub name: String,
    pub variant: SkinVariant,
}

fn clean_name(name: &str) -> String {
    let n: String = name.trim().chars().filter(|c| !c.is_control()).take(48).collect();
    if n.trim().is_empty() { "Skin".into() } else { n.trim().to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimales PNG mit IHDR für Tests (Inhalt danach ist egal).
    pub fn fake_png(w: u32, h: u32) -> Vec<u8> {
        let mut b = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];
        b.extend_from_slice(b"IHDR");
        b.extend_from_slice(&w.to_be_bytes());
        b.extend_from_slice(&h.to_be_bytes());
        b.extend_from_slice(&[8, 6, 0, 0, 0, 1, 2, 3, 4]);
        b
    }

    #[test]
    fn png_checks() {
        assert_eq!(png_dimensions(&fake_png(64, 64)), Some((64, 64)));
        assert!(validate_skin_png(&fake_png(64, 64)).is_ok());
        assert!(validate_skin_png(&fake_png(64, 32)).is_ok());
        assert!(matches!(validate_skin_png(&fake_png(128, 128)), Err(AppError::Invalid(m)) if m.contains("128×128")));
        assert!(matches!(validate_skin_png(b"GIF89a....................."), Err(AppError::Invalid(m)) if m.contains("PNG")));
        assert!(validate_skin_png(&vec![0u8; MAX_PNG + 1]).is_err());
    }

    #[test]
    fn png_payload_decoding() {
        let png = fake_png(64, 64);
        let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
        assert_eq!(decode_png_payload(&format!("data:image/png;base64,{b64}")).unwrap(), png);
        assert_eq!(decode_png_payload(&b64).unwrap(), png);
        assert!(decode_png_payload("data:image/png,abc").is_err());
        assert!(decode_png_payload("!!!").is_err());
        let big = base64::engine::general_purpose::STANDARD.encode(fake_png(32, 32));
        assert!(matches!(decode_png_payload(&big), Err(AppError::Invalid(m)) if m.contains("32×32")));
    }

    #[test]
    fn profile_parsing() {
        let json = br#"{"id":"abc","name":"Steve","skins":[
            {"id":"s0","state":"INACTIVE","url":"http://textures.minecraft.net/texture/old","variant":"CLASSIC"},
            {"id":"s1","state":"ACTIVE","url":"http://textures.minecraft.net/texture/new","variant":"SLIM","textureKey":"new"}],
            "capes":[{"id":"c1","state":"ACTIVE","url":"http://textures.minecraft.net/texture/cape","alias":"Migrator"}]}"#;
        let p: RawProfile = serde_json::from_slice(json).unwrap();
        let s = p.active_skin().unwrap();
        assert_eq!(s.id, "s1");
        assert_eq!(SkinVariant::from_api(s.variant.as_deref().unwrap()), SkinVariant::Slim);
        assert_eq!(p.capes[0].alias.as_deref(), Some("Migrator"));
        let empty: RawProfile = serde_json::from_slice(br#"{"id":"x","name":"y"}"#).unwrap();
        assert!(empty.active_skin().is_none());
    }

    #[test]
    fn services_errors() {
        assert!(services_error(429, b"").to_string().contains("Zu viele Skin-Änderungen"));
        assert!(matches!(services_error(401, b""), AppError::Auth(_)));
        assert!(matches!(services_error(400, br#"{"errorMessage":"Could not validate image data"}"#), AppError::Invalid(m) if m.contains("validate")));
        assert!(matches!(services_error(503, b"<html>"), AppError::Msg(_)));
    }

    #[test]
    fn textures_property() {
        let raw = br#"{"timestamp":1,"profileId":"x","profileName":"Alex","textures":{"SKIN":{"url":"http://textures.minecraft.net/texture/abc","metadata":{"model":"slim"}}}}"#;
        let b64 = base64::engine::general_purpose::STANDARD.encode(raw);
        assert_eq!(parse_textures_property(&b64), Some(("http://textures.minecraft.net/texture/abc".into(), SkinVariant::Slim)));
        let classic = base64::engine::general_purpose::STANDARD.encode(br#"{"textures":{"SKIN":{"url":"u"}}}"#);
        assert_eq!(parse_textures_property(&classic), Some(("u".into(), SkinVariant::Classic)));
        let none = base64::engine::general_purpose::STANDARD.encode(br#"{"textures":{}}"#);
        assert_eq!(parse_textures_property(&none), None);
    }

    #[test]
    fn player_names() {
        assert!(valid_player_name("Notch"));
        assert!(valid_player_name("jeb_"));
        assert!(!valid_player_name(""));
        assert!(!valid_player_name("a b"));
        assert!(!valid_player_name("abcdefghijklmnopq"));
    }

    #[test]
    fn library_crud() {
        let root = std::env::temp_dir().join(format!("vl-skins-test-{}", uuid::Uuid::new_v4().simple()));
        let lib = Library::load(&root);
        let a = lib.add(&fake_png(64, 64), "  Mein Skin  ", SkinVariant::Slim, Some("file".into())).unwrap();
        assert_eq!(a.name, "Mein Skin");
        assert!(a.data_url.starts_with("data:image/png;base64,"));
        // Duplikat -> gleicher Eintrag
        assert_eq!(lib.add(&fake_png(64, 64), "Nochmal", SkinVariant::Classic, None).unwrap().id, a.id);
        let b = lib.add(&fake_png(64, 32), "", SkinVariant::Classic, None).unwrap();
        assert_eq!(b.name, "Skin");
        assert!(lib.add(&fake_png(32, 32), "x", SkinVariant::Classic, None).is_err());
        assert_eq!(lib.list().len(), 2);
        let r = lib.modify(&a.id, |e| {
            e.name = "Umbenannt".into();
            e.variant = SkinVariant::Classic;
        });
        assert_eq!(r.unwrap().name, "Umbenannt");
        // Neu laden -> persistiert
        let lib2 = Library::load(&root);
        let got = lib2.get(&a.id).unwrap();
        assert_eq!((got.name.as_str(), got.variant), ("Umbenannt", SkinVariant::Classic));
        lib2.remove(&a.id).unwrap();
        assert!(lib2.get(&a.id).is_err());
        assert!(!root.join("skins").join(&a.file).exists());
        assert_eq!(Library::load(&root).list().len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }
}
