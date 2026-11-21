use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissingEntry {
    #[serde(flatten)]
    pub info: MissingDownload,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub file_id: Option<String>,
    /// Größe in Bytes (Vorfilter, bevor gehasht wird)
    #[serde(default)]
    pub size: Option<u64>,
    /// CurseForge-Fingerprint (MurmurHash2), falls kein SHA-1 bekannt ist
    #[serde(default)]
    pub fingerprint: Option<u32>,
    /// Index-Eintrag, der beim Eintreffen der Datei geschrieben wird (Herkunft, Version, Icon …)
    #[serde(default)]
    pub index: Option<IndexEntry>,
    /// Ältere Dateien desselben Projekts (Index-Schlüssel), die beim Eintreffen ersetzt werden
    #[serde(default)]
    pub replaces: Vec<String>,
}

impl MissingEntry {
    pub fn new(info: MissingDownload) -> Self {
        MissingEntry { info, sha1: None, project_id: None, file_id: None, size: None, fingerprint: None, index: None, replaces: vec![] }
    }
    pub(super) fn expected(&self) -> Expected<'_> {
        Expected { file_name: &self.info.file_name, size: self.size.filter(|s| *s > 0), sha1: self.sha1.as_deref(), fingerprint: self.fingerprint }
    }
}

pub(super) fn path(paths: &Paths, instance_id: &str) -> PathBuf {
    paths.instance_dir(instance_id).join("missing.json")
}

pub fn load(paths: &Paths, instance_id: &str) -> Vec<MissingEntry> {
    std::fs::read(path(paths, instance_id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub(super) fn save(paths: &Paths, instance_id: &str, list: &[MissingEntry]) -> AppResult<()> {
    let p = path(paths, instance_id);
    if list.is_empty() {
        if p.exists() {
            std::fs::remove_file(p)?;
        }
        return Ok(());
    }
    crate::util::write_json_atomic(&p, &list)
}

pub(crate) fn replace_pending_mods(paths: &Paths, instance_id: &str, mods: Vec<MissingEntry>) -> AppResult<()> {
    let mut list = load(paths, instance_id);
    if mods.is_empty() && !list.iter().any(|e| e.info.kind == ContentKind::Mod) {
        return Ok(());
    }
    list.retain(|e| e.info.kind != ContentKind::Mod);
    list.extend(mods);
    save(paths, instance_id, &list)
}

pub(crate) fn pending_mods(paths: &Paths, instance_id: &str) -> Vec<MissingEntry> {
    load(paths, instance_id).into_iter().filter(|e| e.info.kind == ContentKind::Mod).collect()
}

/// Einträge hinzufügen (gleiche Datei im gleichen Ordner bzw. gleiches Projekt wird ersetzt).
pub fn add(paths: &Paths, instance_id: &str, entries: Vec<MissingEntry>) -> AppResult<()> {
    if entries.is_empty() {
        return Ok(());
    }
    let mut list = load(paths, instance_id);
    for e in entries {
        let same_project = |x: &MissingEntry| e.project_id.is_some() && x.project_id == e.project_id && x.info.kind == e.info.kind;
        list.retain(|x| !(same_project(x) || (x.info.file_name == e.info.file_name && x.info.kind == e.info.kind)));
        list.push(e);
    }
    save(paths, instance_id, &list)
}

/// Erwartete Dateien (nach Dateiname) wieder austragen, z. B. beim Rückgängigmachen von „Probleme beheben“.
pub fn forget(paths: &Paths, instance_id: &str, file_names: &[String]) -> AppResult<()> {
    let mut list = load(paths, instance_id);
    let n = list.len();
    list.retain(|x| !file_names.contains(&x.info.file_name));
    if list.len() == n {
        return Ok(());
    }
    save(paths, instance_id, &list)
}

pub fn dismiss(paths: &Paths, instance_id: &str) -> AppResult<()> {
    save(paths, instance_id, &[])
}

pub(super) fn target(game_dir: &Path, kind: ContentKind, file_name: &str) -> PathBuf {
    game_dir.join(kind.folder()).join(file_name)
}

pub(super) fn with_disabled(p: &Path) -> PathBuf {
    p.with_file_name(format!("{}.disabled", p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()))
}

/// Download-Ordner des Systems. In Debug-Builds per `VIBE_DOWNLOAD_DIR` überschreibbar (Tests mit eigenem Datenordner).
pub fn downloads_dir() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        if let Some(d) = std::env::var_os("VIBE_DOWNLOAD_DIR").filter(|d| !d.is_empty()) {
            return Some(PathBuf::from(d));
        }
    }
    dirs::download_dir()
}
