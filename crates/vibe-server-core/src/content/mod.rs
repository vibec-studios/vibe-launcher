//! Gemeinsame Inhaltstypen, Modrinth-Rohdaten, lokale Mod-Metadaten und API-Cache.
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};

pub mod http;
pub mod index;
pub mod meta;
pub mod modrinth;
pub mod murmur;

/// Herkunft: Modrinth, CurseForge oder ein eigener Store (serialisiert als `"store:<id>"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Source {
    Modrinth,
    Curseforge,
    Store(StoreKey),
}

/// Internierte Store-ID (hält `Source` klein und `Copy`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct StoreKey(u32);

static STORE_IDS: std::sync::OnceLock<parking_lot::RwLock<Vec<String>>> = std::sync::OnceLock::new();

impl StoreKey {
    pub fn intern(id: &str) -> StoreKey {
        let reg = STORE_IDS.get_or_init(Default::default);
        if let Some(i) = reg.read().iter().position(|s| s == id) {
            return StoreKey(i as u32);
        }
        let mut w = reg.write();
        if let Some(i) = w.iter().position(|s| s == id) {
            return StoreKey(i as u32);
        }
        w.push(id.to_string());
        StoreKey((w.len() - 1) as u32)
    }
    pub fn id(&self) -> String {
        STORE_IDS.get_or_init(Default::default).read().get(self.0 as usize).cloned().unwrap_or_default()
    }
}

impl Source {
    pub fn store(id: &str) -> Source {
        Source::Store(StoreKey::intern(id))
    }
    pub fn as_string(&self) -> String {
        match self {
            Source::Modrinth => "modrinth".into(),
            Source::Curseforge => "curseforge".into(),
            Source::Store(k) => format!("store:{}", k.id()),
        }
    }
    pub fn parse(s: &str) -> Option<Source> {
        match s {
            "modrinth" => Some(Source::Modrinth),
            "curseforge" => Some(Source::Curseforge),
            _ => s.strip_prefix("store:").filter(|id| !id.is_empty()).map(Source::store),
        }
    }
}

impl Serialize for Source {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.as_string())
    }
}

impl<'de> Deserialize<'de> for Source {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Source::parse(&s).ok_or_else(|| serde::de::Error::custom(format!("unbekannte Quelle: {s}")))
    }
}

/// Ordner-Art in der Instanz.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ContentKind {
    /// mods/
    Mod,
    /// resourcepacks/
    Resourcepack,
    /// shaderpacks/
    Shader,
    /// datapacks/ im Spielordner (siehe docs/CONTRACT.md: global, nicht je Welt)
    Datapack,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GalleryImage {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub featured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectLinks {
    pub website: Option<String>,
    pub source: Option<String>,
    pub issues: Option<String>,
    pub wiki: Option<String>,
    pub discord: Option<String>,
}

/// Wo ein Inhalt gebraucht wird.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    /// nur Client (z. B. Shader, Minimap)
    Client,
    /// Client und Server
    Both,
    /// nur Server
    Server,
    /// unbekannt
    Unknown,
}

impl ContentKind {
    pub const ALL: [ContentKind; 4] = [ContentKind::Mod, ContentKind::Resourcepack, ContentKind::Shader, ContentKind::Datapack];

    /// Ordner im Spielordner.
    pub fn folder(&self) -> &'static str {
        match self {
            ContentKind::Mod => "mods",
            ContentKind::Resourcepack => "resourcepacks",
            ContentKind::Shader => "shaderpacks",
            ContentKind::Datapack => "datapacks",
        }
    }

    pub fn from_folder(folder: &str) -> Option<ContentKind> {
        ContentKind::ALL.into_iter().find(|k| k.folder() == folder)
    }
}

const CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const CACHE_MAX: usize = 600;

#[derive(Default)]
pub struct HttpCache {
    map: Mutex<HashMap<String, (Instant, bytes::Bytes)>>,
}

impl HttpCache {
    pub fn get(&self, key: &str) -> Option<bytes::Bytes> {
        let map = self.map.lock();
        map.get(key).filter(|(t, _)| t.elapsed() < CACHE_TTL).map(|(_, b)| b.clone())
    }

    pub fn put(&self, key: String, value: bytes::Bytes) {
        let mut map = self.map.lock();
        if map.len() >= CACHE_MAX {
            map.retain(|_, (t, _)| t.elapsed() < CACHE_TTL);
            if map.len() >= CACHE_MAX {
                let mut v: Vec<(String, Instant)> = map.iter().map(|(k, (t, _))| (k.clone(), *t)).collect();
                v.sort_by_key(|(_, t)| *t);
                for (k, _) in v.into_iter().take(CACHE_MAX / 2) {
                    map.remove(&k);
                }
            }
        }
        map.insert(key, (Instant::now(), value));
    }

    pub fn clear(&self) {
        self.map.lock().clear();
    }
}
