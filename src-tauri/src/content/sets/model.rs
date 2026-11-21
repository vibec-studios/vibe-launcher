use super::*;

/// Maximale Anzahl Projekte je Set (schützt vor versehentlich riesigen Listen).
pub const MAX_ENTRIES: usize = 500;
/// Präfix des Teilen-Codes.
pub const CODE_PREFIX: &str = "VIBESET1.";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SetEntry {
    pub source: Source,
    /// Kanonische Projekt-ID (Modrinth-ID bzw. CurseForge-Zahl)
    pub project_id: String,
    #[serde(default)]
    pub slug: Option<String>,
    pub title: String,
    #[serde(default)]
    pub icon_url: Option<String>,
    pub project_type: ProjectType,
    /// Hinzugefügt (ms seit Epoch)
    #[serde(default)]
    pub added: i64,
}

impl SetEntry {
    pub fn key(&self) -> String {
        entry_key(self.source, &self.project_id)
    }
}

pub fn entry_key(source: Source, project_id: &str) -> String {
    format!("{}:{project_id}", source.as_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModSet {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub created: i64,
    pub updated: i64,
    pub entries: Vec<SetEntry>,
    #[serde(default)]
    pub apply_on_create: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub(super) struct Store {
    pub(super) format: u32,
    pub(super) sets: Vec<ModSet>,
}

/// Set mit Nutzung (für die Übersicht).
#[derive(Debug, Clone, Serialize)]
pub struct ModSetInfo {
    #[serde(flatten)]
    pub set: ModSet,
    /// Instanzen, auf die das Set angewendet wurde
    pub used_by: Vec<String>,
}
