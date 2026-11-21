use super::*;

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotInfo {
    pub id: String,
    pub name: String,
    pub created: i64,
    pub auto: bool,
    pub file_count: u32,
    pub size: u64,
    /// Enthaltene Bereiche bei Teil-Snapshots (`None` = vollständig)
    pub scopes: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileEntry {
    pub rel_path: String,
    pub sha1: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Manifest {
    #[serde(default = "one")]
    pub version: u32,
    pub id: String,
    pub name: String,
    pub created: i64,
    #[serde(default)]
    pub auto: bool,
    /// Relativ zum Spielordner
    #[serde(default)]
    pub files: Vec<FileEntry>,
    /// Ordner (auch leere), relativ zum Spielordner
    #[serde(default)]
    pub dirs: Vec<String>,
    /// Relativ zum Instanzordner
    #[serde(default)]
    pub meta: Vec<FileEntry>,
    /// Enthaltene Bereiche (Teil-Snapshot); fehlt = vollständig
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scopes: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) migration: Option<MigrationState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct MigrationState {
    pub(super) version: GameVersion,
    pub(super) pending_mods: Vec<missing::MissingEntry>,
}

pub(super) fn one() -> u32 {
    1
}

impl Manifest {
    pub fn info(&self) -> SnapshotInfo {
        SnapshotInfo {
            id: self.id.clone(),
            name: self.name.clone(),
            created: self.created,
            auto: self.auto,
            file_count: (self.files.len() + self.meta.len()) as u32,
            size: self.files.iter().chain(&self.meta).map(|f| f.size).sum(),
            scopes: self.scopes.clone(),
        }
    }
    pub fn sel(&self) -> Sel {
        Sel::from_manifest(&self.scopes)
    }
}
