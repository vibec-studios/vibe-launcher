use super::*;

// ------------------------------------------------------------------ Format

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default)]
pub struct StoreFile {
    pub format: String,
    pub version: u32,
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub homepage: Option<String>,
    pub description: Option<String>,
    pub projects: Vec<StoreProject>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default)]
pub struct StoreGallery {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default)]
pub struct StoreLinks {
    pub website: Option<String>,
    pub source: Option<String>,
    pub issues: Option<String>,
    pub wiki: Option<String>,
    pub discord: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default)]
pub struct StoreProject {
    pub id: String,
    pub slug: Option<String>,
    pub title: String,
    pub description: String,
    pub author: Option<String>,
    pub icon: Option<String>,
    pub project_type: Option<String>,
    pub categories: Vec<String>,
    pub body: Option<String>,
    pub gallery: Vec<StoreGallery>,
    pub links: StoreLinks,
    pub license: Option<String>,
    pub downloads: Option<u64>,
    pub published: Option<String>,
    pub updated: Option<String>,
    /// "required" | "optional" | "unsupported" (wie Modrinth)
    pub client_side: Option<String>,
    pub server_side: Option<String>,
    pub versions: Vec<StoreVersion>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default)]
pub struct StoreFileEntry {
    pub url: String,
    pub filename: String,
    pub size: u64,
    pub sha1: Option<String>,
    pub sha256: Option<String>,
    pub sha512: Option<String>,
    pub primary: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default)]
pub struct StoreDep {
    pub source: Option<String>,
    pub project_id: String,
    pub version_id: Option<String>,
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default)]
pub struct StoreVersion {
    pub id: String,
    pub version_number: String,
    pub name: Option<String>,
    pub release_type: Option<String>,
    pub date: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub changelog: Option<String>,
    pub files: Vec<StoreFileEntry>,
    pub dependencies: Vec<StoreDep>,
    pub downloads: Option<u64>,
}

/// Format prüfen (Pflichtfelder, Version).
pub fn validate(f: &StoreFile) -> AppResult<()> {
    if f.format != "vibe-store" {
        return Err(AppError::Invalid("Keine Vibe-Store-Datei (\"format\": \"vibe-store\" fehlt)".into()));
    }
    if f.version == 0 || f.version > 1 {
        return Err(AppError::Invalid(format!("Store-Format Version {} wird nicht unterstützt – bitte Launcher aktualisieren", f.version)));
    }
    if f.id.trim().is_empty() || !f.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(AppError::Invalid("Store-ID fehlt oder enthält ungültige Zeichen (erlaubt: a-z, 0-9, -)".into()));
    }
    if f.name.trim().is_empty() {
        return Err(AppError::Invalid("Store-Name fehlt".into()));
    }
    Ok(())
}
