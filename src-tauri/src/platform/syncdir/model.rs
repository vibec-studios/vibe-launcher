use super::*;

/// Dateien ab dieser Größe werden per Hardlink abgelegt, kleinere (Einstellungen) kopiert.
pub(super) const LINK_MIN: u64 = 256 * 1024;
/// Papierkorb-Einträge älter als das werden entfernt.
pub(super) const TRASH_DAYS: i64 = 30;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct Stamp {
    pub size: u64,
    pub mtime: i64,
    pub files: u32,
    /// Prüfsumme über die (sortierten) Dateinamen bei Ordnern
    pub names: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct BaseEntry {
    pub inst: Option<Stamp>,
    pub shared: Option<Stamp>,
}

pub type Base = BTreeMap<String, BaseEntry>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Conflict {
    pub name: String,
    /// Neuer Name der Fassung aus der Instanz
    pub renamed: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct DirReport {
    pub to_shared: Vec<String>,
    pub to_instance: Vec<String>,
    pub removed_shared: Vec<String>,
    pub removed_instance: Vec<String>,
    pub conflicts: Vec<Conflict>,
    pub errors: Vec<String>,
}

impl DirReport {
    pub fn changes(&self) -> usize {
        self.to_shared.len() + self.to_instance.len() + self.removed_shared.len() + self.removed_instance.len() + self.conflicts.len()
    }
}
