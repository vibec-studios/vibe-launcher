//! Skins aus anderen Launchern finden und in die eigene Bibliothek übernehmen. Fremde Dateien werden
//! ausschließlich gelesen, nie verändert.
//!
//! - **Modrinth App**: SQLite `<data>/ModrinthApp/app.db` (Tabellen `custom_minecraft_skins` +
//!   `custom_minecraft_skin_textures`, PNG als BLOB, Variante CLASSIC/SLIM, `cape_id` = Mojang-Cape-UUID).
//!   Die Datenbank läuft im WAL-Modus; damit wir nichts an ihr (auch nicht an `-shm`) verändern, wird sie
//!   samt `-wal`/`-shm` in einen eigenen Temp-Ordner kopiert, dort gelesen und die Kopie sofort gelöscht.
//!   `THESEUS_CONFIG_DIR` verlegt den Ordner (wie in der App).
//! - **NoRisk Client**: `minecraft_skins.json` (`{ skins: [{ id, name, base64_data, variant, added_at }] }`)
//!   unter Windows `%APPDATA%\norisk\NoRiskClientV3`, macOS `~/Library/Application Support/gg.norisk.NoRiskClientV3`,
//!   Linux `~/.local/share/noriskclientv3`.
//! - **Lunar Client**: `~/.lunarclient/settings/game/saved_skins.json` (Objekt Textur-URL -> `{ type, name }`);
//!   enthält nur URLs, die PNGs kommen von textures.minecraft.net. Standard-Steve/Alex werden übersprungen.
use super::skins::{self, SkinVariant};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ImportSource {
    Modrinth,
    Norisk,
    Lunar,
}

impl ImportSource {
    pub const ALL: [ImportSource; 3] = [ImportSource::Modrinth, ImportSource::Norisk, ImportSource::Lunar];
    pub fn as_str(self) -> &'static str {
        match self {
            ImportSource::Modrinth => "modrinth",
            ImportSource::Norisk => "norisk",
            ImportSource::Lunar => "lunar",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            ImportSource::Modrinth => "Modrinth App",
            ImportSource::Norisk => "NoRisk Client",
            ImportSource::Lunar => "Lunar Client",
        }
    }
}

/// Basisordner, aus denen die Pfade gebildet werden (für Tests austauschbar).
#[derive(Debug, Clone)]
pub struct Roots {
    /// `%APPDATA%` bzw. `~/Library/Application Support` bzw. `~/.local/share`
    pub data: Option<PathBuf>,
    pub home: Option<PathBuf>,
    /// `THESEUS_CONFIG_DIR` der Modrinth App
    pub modrinth_override: Option<PathBuf>,
}

impl Roots {
    pub fn system() -> Self {
        Roots {
            data: dirs::data_dir(),
            home: dirs::home_dir(),
            modrinth_override: std::env::var_os("THESEUS_CONFIG_DIR").map(PathBuf::from).filter(|p| !p.as_os_str().is_empty()),
        }
    }

    pub fn file(&self, src: ImportSource) -> Option<PathBuf> {
        match src {
            ImportSource::Modrinth => {
                let dir = self.modrinth_override.clone().or_else(|| self.data.as_ref().map(|d| d.join("ModrinthApp")))?;
                Some(dir.join("app.db"))
            }
            ImportSource::Norisk => {
                let d = self.data.as_ref()?;
                let dir = if cfg!(windows) {
                    d.join("norisk").join("NoRiskClientV3")
                } else if cfg!(target_os = "macos") {
                    d.join("gg.norisk.NoRiskClientV3")
                } else {
                    d.join("noriskclientv3")
                };
                Some(dir.join("minecraft_skins.json"))
            }
            ImportSource::Lunar => Some(self.home.as_ref()?.join(".lunarclient").join("settings").join("game").join("saved_skins.json")),
        }
    }
}

/// Ein gefundener Skin (Rohdaten, PNG schon gelesen bzw. – bei Lunar – noch als URL).
#[derive(Debug, Clone)]
pub struct RawFound {
    pub name: Option<String>,
    pub variant: SkinVariant,
    pub cape_id: Option<String>,
    pub png: Option<Vec<u8>>,
    pub url: Option<String>,
}

/// Für die Vorschau-Auswahl im Frontend.
#[derive(Debug, Clone, Serialize)]
pub struct FoundSkin {
    /// `<quelle>:<bild-hash>` – stabil, Grundlage für Auswahl und „schon gesehen“
    pub key: String,
    pub source: ImportSource,
    pub name: String,
    pub variant: SkinVariant,
    pub cape_id: Option<String>,
    /// Bild-Hash: SHA-1 der dekodierten RGBA-Pixel (gleiches Bild, andere PNG-Kodierung = gleicher Hash)
    pub sha1: String,
    pub data_url: String,
    /// Gleiches Bild liegt schon in der Bibliothek
    pub in_library: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceScan {
    pub source: ImportSource,
    pub label: &'static str,
    pub path: String,
    pub skins: Vec<FoundSkin>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportScan {
    pub sources: Vec<SourceScan>,
    /// Neue Skins (noch nicht in der Bibliothek)
    pub new_count: usize,
    pub auto_import: bool,
}

// ------------------------------------------------------------------ Leser

fn variant_of(s: &str) -> SkinVariant {
    SkinVariant::from_api(s)
}

/// Modrinth-Datenbank (Pfad einer *Kopie*) lesen.
pub fn read_modrinth_db(db: &Path) -> AppResult<Vec<RawFound>> {
    use rusqlite::OpenFlags;
    let c = rusqlite::Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| AppError::msg(format!("Modrinth-Datenbank nicht lesbar: {e}")))?;
    let has_order = c
        .prepare("SELECT 1 FROM pragma_table_info('custom_minecraft_skins') WHERE name = 'display_order'")
        .and_then(|mut s| s.exists([]))
        .unwrap_or(false);
    // Nur Skin-Tabellen + Benutzername (für den Namen); keine Token-Spalten
    let sql = format!(
        "SELECT s.texture_key, s.variant, s.cape_id, t.texture, u.username
         FROM custom_minecraft_skins s
         JOIN custom_minecraft_skin_textures t ON t.texture_key = s.texture_key
         LEFT JOIN minecraft_users u ON u.uuid = s.minecraft_user_uuid
         ORDER BY {}",
        if has_order { "s.display_order, s.rowid" } else { "s.rowid" }
    );
    let mut st = c.prepare(&sql).map_err(|e| AppError::msg(format!("Modrinth-Datenbank: Skin-Tabellen fehlen ({e})")))?;
    let rows = st
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Vec<u8>>(3)?, r.get::<_, Option<String>>(4)?))
        })
        .map_err(|e| AppError::msg(e.to_string()))?;
    let mut out = Vec::new();
    for (i, r) in rows.flatten().enumerate() {
        let (_key, variant, cape, png, user) = r;
        out.push(RawFound {
            name: Some(match user {
                Some(u) if !u.is_empty() => format!("{u} ({})", i + 1),
                _ => format!("Modrinth-Skin {}", i + 1),
            }),
            variant: variant_of(&variant),
            cape_id: cape.filter(|c| !c.trim().is_empty()),
            png: Some(png),
            url: None,
        });
    }
    Ok(out)
}

/// Kopie der Datenbank (mit WAL) anlegen, lesen, Kopie löschen.
fn read_modrinth(db: &Path, tmp_root: &Path) -> AppResult<Vec<RawFound>> {
    let dir = tmp_root.join(format!("mr-skins-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir)?;
    struct Cleanup(PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _guard = Cleanup(dir.clone());
    let copy = dir.join("app.db");
    std::fs::copy(db, &copy).map_err(|e| AppError::msg(format!("Modrinth-Datenbank nicht lesbar: {e}")))?;
    for ext in ["-wal", "-shm"] {
        let mut p = db.as_os_str().to_owned();
        p.push(ext);
        let p = PathBuf::from(p);
        if p.is_file() {
            let _ = std::fs::copy(&p, dir.join(format!("app.db{ext}")));
        }
    }
    // Lesen auf der Kopie (darf dort WAL-Index anlegen); Original bleibt unberührt
    use rusqlite::OpenFlags;
    {
        // WAL der Kopie in die Kopie übernehmen, damit der Nur-Lese-Zugriff alle Daten sieht
        if let Ok(c) = rusqlite::Connection::open_with_flags(&copy, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX) {
            let _ = c.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
        }
    }
    read_modrinth_db(&copy)
}

#[derive(Deserialize)]
struct NoriskFile {
    #[serde(default)]
    skins: Vec<NoriskSkin>,
}

#[derive(Deserialize)]
struct NoriskSkin {
    #[serde(default)]
    name: String,
    #[serde(default)]
    base64_data: String,
    #[serde(default)]
    variant: String,
}

pub fn parse_norisk(b: &[u8]) -> AppResult<Vec<RawFound>> {
    let f: NoriskFile = serde_json::from_slice(b).map_err(|e| AppError::msg(format!("NoRisk-Skinliste unlesbar: {e}")))?;
    Ok(f.skins
        .into_iter()
        .filter_map(|s| {
            let data = s.base64_data.rsplit(',').next().unwrap_or_default().trim().to_string();
            let png = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).ok()?;
            Some(RawFound { name: Some(s.name).filter(|n| !n.trim().is_empty()), variant: variant_of(&s.variant), cape_id: None, png: Some(png), url: None })
        })
        .collect())
}

/// Standard-Skins, die Lunar selbst einträgt (Steve/Alex).
const LUNAR_DEFAULTS: &[&str] = &["1a4af718455d4aab528e7a61f86fa25e6a369d1768dcb13f7df319a713eb810b", "3b60a1f6d562f52aaebbf1434f1de147933a3affe0e764fa49ea057536623cd3"];

#[derive(Deserialize)]
struct LunarEntry {
    #[serde(default, rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

pub fn parse_lunar(b: &[u8]) -> AppResult<Vec<RawFound>> {
    let m: serde_json::Map<String, serde_json::Value> = serde_json::from_slice(b).map_err(|e| AppError::msg(format!("Lunar-Skinliste unlesbar: {e}")))?;
    let mut out = Vec::new();
    for (url, v) in m {
        let u = url.trim();
        let host_ok = u.starts_with("http://textures.minecraft.net/texture/") || u.starts_with("https://textures.minecraft.net/texture/");
        if !host_ok {
            continue;
        }
        let hash = u.rsplit('/').next().unwrap_or_default();
        if hash.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) || LUNAR_DEFAULTS.iter().any(|d| hash.eq_ignore_ascii_case(d)) {
            continue;
        }
        let e: LunarEntry = serde_json::from_value(v).unwrap_or(LunarEntry { kind: None, name: None });
        out.push(RawFound {
            name: e.name.filter(|n| !n.trim().is_empty()),
            variant: variant_of(e.kind.as_deref().unwrap_or("classic")),
            cape_id: None,
            png: None,
            url: Some(u.to_string()),
        });
    }
    Ok(out)
}

/// Rohdaten einer Quelle lesen (ohne Netz). `None` = App nicht installiert.
pub fn read_source(src: ImportSource, roots: &Roots, tmp_root: &Path) -> Option<(PathBuf, AppResult<Vec<RawFound>>)> {
    let path = roots.file(src)?;
    if !path.is_file() {
        return None;
    }
    let res = match src {
        ImportSource::Modrinth => read_modrinth(&path, tmp_root),
        ImportSource::Norisk => std::fs::read(&path).map_err(AppError::from).and_then(|b| parse_norisk(&b)),
        ImportSource::Lunar => std::fs::read(&path).map_err(AppError::from).and_then(|b| parse_lunar(&b)),
    };
    Some((path, res))
}

// ------------------------------------------------------------------ Zustand (Auto-Import)

#[derive(Debug, Default, Serialize, Deserialize)]
struct ImportState {
    #[serde(default)]
    auto: bool,
    /// Schon angebotene/übernommene Schlüssel – Auto-Import nimmt nur neue
    #[serde(default)]
    seen: Vec<String>,
}

fn state_path(st: &AppState) -> PathBuf {
    st.paths.root.join("skin-import.json")
}

fn load_state(st: &AppState) -> ImportState {
    std::fs::read(state_path(st)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save_state(st: &AppState, s: &ImportState) -> AppResult<()> {
    crate::util::write_json_atomic(&state_path(st), s)
}

pub fn set_auto(st: &AppState, on: bool) -> AppResult<()> {
    let mut s = load_state(st);
    s.auto = on;
    save_state(st, &s)
}

// ------------------------------------------------------------------ Scan + Import

/// SHA-1 über Größe + RGBA-Pixel; nicht dekodierbar -> SHA-1 der Datei.
pub fn content_hash(png: &[u8]) -> String {
    match image::load_from_memory_with_format(png, image::ImageFormat::Png) {
        Ok(img) => {
            let rgba = img.to_rgba8();
            let mut h = Sha1::new();
            h.update(rgba.width().to_be_bytes());
            h.update(rgba.height().to_be_bytes());
            // Voll transparente Pixel vereinheitlichen (Farbwerte dort sind unsichtbar)
            for px in rgba.pixels() {
                if px.0[3] == 0 {
                    h.update([0u8; 4]);
                } else {
                    h.update(px.0);
                }
            }
            hex::encode(h.finalize())
        }
        Err(_) => hex::encode(Sha1::digest(png)),
    }
}

/// Bild-Hashes aller Bibliotheks-Skins.
fn library_hashes(st: &AppState) -> HashSet<String> {
    st.auth
        .skins
        .list()
        .iter()
        .filter_map(|s| s.data_url.split_once(',').map(|x| x.1.to_string()))
        .filter_map(|b| base64::engine::general_purpose::STANDARD.decode(b).ok())
        .map(|png| content_hash(&png))
        .collect()
}

fn found_from(src: ImportSource, raw: RawFound, png: Vec<u8>, have: &HashSet<String>, n: usize) -> Option<FoundSkin> {
    skins::validate_skin_png(&png).ok()?;
    let sha1 = content_hash(&png);
    Some(FoundSkin {
        key: format!("{}:{sha1}", src.as_str()),
        source: src,
        name: raw.name.unwrap_or_else(|| format!("{} {n}", src.label())),
        variant: raw.variant,
        cape_id: raw.cape_id,
        in_library: have.contains(&sha1),
        sha1,
        data_url: skins::data_url(&png),
    })
}

/// Alle installierten Quellen lesen (Lunar lädt die Bilder von Mojang, gecacht).
pub async fn scan(st: &AppState) -> ImportScan {
    let roots = Roots::system();
    let tmp = st.paths.cache().join("tmp");
    let raw: Vec<(ImportSource, PathBuf, AppResult<Vec<RawFound>>)> = {
        let tmp = tmp.clone();
        tokio::task::spawn_blocking(move || {
            ImportSource::ALL.iter().filter_map(|s| read_source(*s, &roots, &tmp).map(|(p, r)| (*s, p, r))).collect()
        })
        .await
        .unwrap_or_default()
    };
    let have = library_hashes(st);
    let cache = st.paths.cache().join("textures");
    let mut sources = Vec::new();
    for (src, path, res) in raw {
        let mut scan = SourceScan { source: src, label: src.label(), path: path.to_string_lossy().to_string(), skins: vec![], error: None };
        match res {
            Err(e) => scan.error = Some(e.to_string()),
            Ok(list) => {
                let mut seen = HashSet::new();
                let mut failed = 0;
                for (i, r) in list.into_iter().enumerate() {
                    let png = match (&r.png, &r.url) {
                        (Some(p), _) => p.clone(),
                        (None, Some(u)) => match skins::fetch_texture(&st.net.client, &cache, u).await {
                            Ok(b) => b,
                            Err(_) => {
                                failed += 1;
                                continue;
                            }
                        },
                        _ => continue,
                    };
                    if let Some(f) = found_from(src, r, png, &have, i + 1) {
                        // gleiche Textur in derselben Quelle nur einmal
                        if seen.insert(f.sha1.clone()) {
                            scan.skins.push(f);
                        }
                    }
                }
                if failed > 0 {
                    scan.error = Some(format!("{failed} Skin(s) konnten nicht von Mojang geladen werden."));
                }
            }
        }
        sources.push(scan);
    }
    // Gleiche Textur aus mehreren Quellen: nur beim ersten Vorkommen als neu zählen
    let mut counted = HashSet::new();
    let new_count = sources.iter().flat_map(|s| s.skins.iter()).filter(|f| !f.in_library && counted.insert(f.sha1.clone())).count();
    ImportScan { sources, new_count, auto_import: load_state(st).auto }
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
}

/// Ausgewählte Skins übernehmen (`keys = None` -> alle neuen). Duplikate (SHA-1) werden übersprungen.
pub async fn import(st: &AppState, keys: Option<Vec<String>>) -> AppResult<ImportResult> {
    let scan = scan(st).await;
    let wanted: Option<HashSet<String>> = keys.map(|k| k.into_iter().collect());
    let mut have = library_hashes(st);
    let mut res = ImportResult { imported: 0, skipped: 0 };
    let mut state = load_state(st);
    for f in scan.sources.iter().flat_map(|s| s.skins.iter()) {
        if wanted.as_ref().is_some_and(|w| !w.contains(&f.key)) {
            continue;
        }
        if !state.seen.contains(&f.key) {
            state.seen.push(f.key.clone());
        }
        if have.contains(&f.sha1) {
            res.skipped += 1;
            continue;
        }
        let b64 = f.data_url.split_once(',').map(|x| x.1).unwrap_or_default();
        let png = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| AppError::msg(e.to_string()))?;
        st.auth.skins.add_with(&png, &f.name, f.variant, Some(format!("import:{}", f.source.as_str())), f.cape_id.clone())?;
        have.insert(f.sha1.clone());
        res.imported += 1;
    }
    save_state(st, &state)?;
    Ok(res)
}

/// Beim Start: wenn eingeschaltet, nur noch nie gesehene Skins übernehmen.
pub async fn auto_import(st: &AppState) -> AppResult<usize> {
    let state = load_state(st);
    if !state.auto {
        return Ok(0);
    }
    let scan = scan(st).await;
    let fresh: Vec<String> = scan.sources.iter().flat_map(|s| s.skins.iter()).filter(|f| !state.seen.contains(&f.key)).map(|f| f.key.clone()).collect();
    if fresh.is_empty() {
        return Ok(0);
    }
    Ok(import(st, Some(fresh)).await?.imported)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageEncoder;

    fn fixtures() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src").join("auth").join("testdata").join("skin-import")
    }

    fn roots(base: &Path) -> Roots {
        Roots { data: Some(base.join("data")), home: Some(base.join("home")), modrinth_override: None }
    }

    fn norisk_dir(base: &Path) -> PathBuf {
        let d = base.join("data");
        if cfg!(windows) {
            d.join("norisk").join("NoRiskClientV3")
        } else if cfg!(target_os = "macos") {
            d.join("gg.norisk.NoRiskClientV3")
        } else {
            d.join("noriskclientv3")
        }
    }

    #[test]
    fn norisk_fixture() {
        let b = std::fs::read(fixtures().join("norisk-minecraft_skins.json")).unwrap();
        let v = parse_norisk(&b).unwrap();
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].name.as_deref(), Some("Henny Slim"));
        assert_eq!(v[0].variant, SkinVariant::Slim);
        assert_eq!(v[1].variant, SkinVariant::Classic);
        assert_eq!(skins::png_dimensions(v[0].png.as_ref().unwrap()), Some((64, 64)));
        // data:-Präfix wird toleriert
        assert!(v[1].png.as_ref().unwrap().starts_with(b"\x89PNG"));
    }

    #[test]
    fn lunar_fixture() {
        let b = std::fs::read(fixtures().join("lunar-saved_skins.json")).unwrap();
        let v = parse_lunar(&b).unwrap();
        // Steve/Alex und fremde Hosts fallen weg
        assert_eq!(v.len(), 2);
        let slim = v.iter().find(|r| r.name.as_deref() == Some("Mein Slim")).unwrap();
        assert_eq!(slim.variant, SkinVariant::Slim);
        assert!(slim.url.as_deref().unwrap().starts_with("http://textures.minecraft.net/texture/"));
        assert!(slim.png.is_none());
        assert!(v.iter().any(|r| r.name.is_none() && r.variant == SkinVariant::Classic));
    }

    /// Modrinth-Datenbank wie in der App (Migrationen skin-selector + add-saved-skin-order) nachbauen.
    fn make_modrinth_db(path: &Path, pngs: &[(&str, &str, Option<&str>, Vec<u8>)]) {
        let c = rusqlite::Connection::open(path).unwrap();
        c.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE minecraft_users (uuid TEXT NOT NULL, active INTEGER NOT NULL DEFAULT FALSE, username TEXT NOT NULL,
                access_token TEXT NOT NULL, refresh_token TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY (uuid));
             CREATE TABLE custom_minecraft_skin_textures (texture_key TEXT NOT NULL, texture PNG BLOB NOT NULL, PRIMARY KEY (texture_key));
             CREATE TABLE custom_minecraft_skins (minecraft_user_uuid TEXT NOT NULL, texture_key TEXT NOT NULL,
                variant TEXT NOT NULL CHECK (variant IN ('CLASSIC', 'SLIM', 'UNKNOWN')), cape_id TEXT, display_order INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (minecraft_user_uuid, texture_key, variant, cape_id),
                FOREIGN KEY (texture_key) REFERENCES custom_minecraft_skin_textures(texture_key) ON DELETE CASCADE ON UPDATE CASCADE);
             INSERT INTO minecraft_users VALUES ('u-1', 1, 'Henny', 'SECRET', 'SECRET', 0);",
        )
        .unwrap();
        for (i, (key, variant, cape, png)) in pngs.iter().enumerate() {
            c.execute("INSERT OR IGNORE INTO custom_minecraft_skin_textures VALUES (?1, ?2)", rusqlite::params![key, png]).unwrap();
            c.execute(
                "INSERT INTO custom_minecraft_skins VALUES ('u-1', ?1, ?2, ?3, ?4)",
                rusqlite::params![key, variant, cape, (pngs.len() - i) as i64],
            )
            .unwrap();
        }
        // Verbindung offen lassen wäre WAL-Fall; hier schließen (Checkpoint passiert nicht zwingend)
    }

    fn png_fixture(name: &str) -> Vec<u8> {
        std::fs::read(fixtures().join(name)).unwrap()
    }

    #[test]
    fn modrinth_db_read_only_copy() {
        let base = std::env::temp_dir().join(format!("vibe-skinimp-{}", uuid::Uuid::new_v4().simple()));
        let mr_dir = base.join("data").join("ModrinthApp");
        std::fs::create_dir_all(&mr_dir).unwrap();
        let db = mr_dir.join("app.db");
        make_modrinth_db(
            &db,
            &[
                ("local-aaa", "SLIM", Some("30743269-ab43-46e6-b25d-3b50b0f1ed41"), png_fixture("slim.png")),
                ("bbb", "CLASSIC", None, png_fixture("classic.png")),
            ],
        );
        let before = std::fs::read(&db).unwrap();
        let before_mtime = std::fs::metadata(&db).unwrap().modified().unwrap();
        let tmp = base.join("tmp");
        let (path, res) = read_source(ImportSource::Modrinth, &roots(&base), &tmp).unwrap();
        assert_eq!(path, db);
        let v = res.unwrap();
        assert_eq!(v.len(), 2);
        // display_order: zweiter Eintrag hat die kleinere Ordnung -> zuerst
        assert_eq!(v[0].variant, SkinVariant::Classic);
        assert_eq!(v[1].variant, SkinVariant::Slim);
        assert_eq!(v[1].cape_id.as_deref(), Some("30743269-ab43-46e6-b25d-3b50b0f1ed41"));
        assert_eq!(v[0].name.as_deref(), Some("Henny (1)"));
        // Original unverändert, Kopie aufgeräumt
        assert_eq!(std::fs::read(&db).unwrap(), before);
        assert_eq!(std::fs::metadata(&db).unwrap().modified().unwrap(), before_mtime);
        assert_eq!(std::fs::read_dir(&tmp).map(|r| r.count()).unwrap_or(0), 0);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn sources_missing_are_hidden() {
        let base = std::env::temp_dir().join(format!("vibe-skinimp-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&base).unwrap();
        for s in ImportSource::ALL {
            assert!(read_source(s, &roots(&base), &base.join("tmp")).is_none());
        }
        // NoRisk + Lunar per Fixture an den echten relativen Pfaden
        let nd = norisk_dir(&base);
        std::fs::create_dir_all(&nd).unwrap();
        std::fs::copy(fixtures().join("norisk-minecraft_skins.json"), nd.join("minecraft_skins.json")).unwrap();
        let ld = base.join("home").join(".lunarclient").join("settings").join("game");
        std::fs::create_dir_all(&ld).unwrap();
        std::fs::copy(fixtures().join("lunar-saved_skins.json"), ld.join("saved_skins.json")).unwrap();
        assert_eq!(read_source(ImportSource::Norisk, &roots(&base), &base).unwrap().1.unwrap().len(), 2);
        assert_eq!(read_source(ImportSource::Lunar, &roots(&base), &base).unwrap().1.unwrap().len(), 2);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn found_and_duplicates() {
        let png = png_fixture("slim.png");
        let sha = content_hash(&png);
        let raw = RawFound { name: None, variant: SkinVariant::Slim, cape_id: None, png: None, url: None };
        let f = found_from(ImportSource::Norisk, raw.clone(), png.clone(), &HashSet::new(), 3).unwrap();
        assert_eq!(f.key, format!("norisk:{sha}"));
        assert_eq!(f.name, "NoRisk Client 3");
        assert!(!f.in_library);
        let have: HashSet<String> = [sha.clone()].into_iter().collect();
        assert!(found_from(ImportSource::Norisk, raw.clone(), png, &have, 1).unwrap().in_library);
        // Ungültige Bilder (falsche Größe) werden verworfen
        assert!(found_from(ImportSource::Norisk, raw, skins_test_png(128, 128), &HashSet::new(), 1).is_none());
    }

    #[test]
    fn same_pixels_same_hash() {
        let png = png_fixture("slim.png");
        let img = image::load_from_memory(&png).unwrap();
        let mut other = Vec::new();
        image::codecs::png::PngEncoder::new_with_quality(&mut other, image::codecs::png::CompressionType::Fast, image::codecs::png::FilterType::NoFilter)
            .write_image(img.as_bytes(), img.width(), img.height(), image::ExtendedColorType::Rgba8)
            .unwrap();
        assert_ne!(png, other);
        assert_eq!(content_hash(&png), content_hash(&other));
        assert_ne!(content_hash(&png), content_hash(&png_fixture("classic.png")));
    }

    fn skins_test_png(w: u32, h: u32) -> Vec<u8> {
        let mut b = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];
        b.extend_from_slice(b"IHDR");
        b.extend_from_slice(&w.to_be_bytes());
        b.extend_from_slice(&h.to_be_bytes());
        b.extend_from_slice(&[8, 6, 0, 0, 0, 1, 2, 3, 4]);
        b
    }
}
