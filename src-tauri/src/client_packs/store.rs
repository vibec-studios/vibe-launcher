use super::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(default)]
pub struct InstalledPack {
    pub id: String,
    /// Version des Packs (NoRisk: aus dem Jar-Namen)
    pub version: Option<String>,
    /// Vom Pack angelegte Dateien in `mods/` (ohne `.disabled`)
    pub files: Vec<String>,
    /// Vom Pack installierte Modrinth-Projekte (nur diese werden beim Entfernen gelöscht)
    pub projects: Vec<String>,
    /// Für welche Instanz-Version installiert
    pub mc_version: String,
    pub loader: String,
    pub installed_at: i64,
    /// Offizieller Link, über den geladen wurde
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct PacksFile {
    pub packs: Vec<InstalledPack>,
}

impl PacksFile {
    pub fn get(&self, id: &str) -> Option<&InstalledPack> {
        self.packs.iter().find(|p| p.id == id)
    }
    pub fn upsert(&mut self, p: InstalledPack) {
        self.packs.retain(|x| x.id != p.id);
        self.packs.push(p);
    }
    pub fn remove(&mut self, id: &str) -> Option<InstalledPack> {
        let i = self.packs.iter().position(|p| p.id == id)?;
        Some(self.packs.remove(i))
    }
}

pub(super) fn state_path(state: &AppState, id: &str) -> PathBuf {
    state.paths.instance_dir(id).join("client-packs.json")
}

pub fn load(state: &AppState, id: &str) -> PacksFile {
    std::fs::read(state_path(state, id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub(super) fn save(state: &AppState, id: &str, f: &PacksFile) -> AppResult<()> {
    if !state.paths.instance_dir(id).exists() {
        return Ok(());
    }
    crate::util::write_json_atomic(&state_path(state, id), f)
}

pub(super) fn mods_dir(state: &AppState, id: &str) -> PathBuf {
    state.paths.game_dir(id).join("mods")
}

/// Liegt die Datei (aktiv oder deaktiviert) in `mods/`? -> (Pfad, aktiv)
pub(super) fn find_file(state: &AppState, id: &str, file: &str) -> Option<(PathBuf, bool)> {
    let p = mods_dir(state, id).join(file);
    if p.is_file() {
        return Some((p, true));
    }
    let d = mods_dir(state, id).join(format!("{file}.disabled"));
    d.is_file().then_some((d, false))
}

/// Ist ein gemerktes Pack noch da? (Dateien bzw. Modrinth-Projekte nicht alle von Hand gelöscht)
pub(super) fn present(state: &AppState, id: &str, p: &InstalledPack, idx: &ContentIndex) -> bool {
    if !p.files.is_empty() && p.files.iter().any(|f| find_file(state, id, f).is_some()) {
        return true;
    }
    if !p.projects.is_empty() {
        return p.projects.iter().any(|pid| idx.has_project(Source::Modrinth, pid));
    }
    p.files.is_empty() && p.projects.is_empty()
}

/// IDs der installierten Packs.
pub fn installed_ids(state: &AppState, id: &str) -> Vec<String> {
    let idx = ContentIndex::load(&state.paths, id);
    load(state, id).packs.iter().filter(|p| present(state, id, p, &idx)).map(|p| p.id.clone()).collect()
}
