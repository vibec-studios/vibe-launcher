use super::*;

#[derive(Debug, Clone, Serialize)]
pub struct BedrockPack {
    /// `<ordner-art>/<ordnername>`, z. B. `resource_packs/Tolles Pack` – stabile ID innerhalb der Instanz
    pub id: String,
    pub kind: PackKind,
    pub name: String,
    pub description: String,
    pub uuid: String,
    pub version: Vec<u64>,
    pub min_engine: Option<String>,
    /// Aus einem `development_*`-Ordner (eigene Entwicklung)
    pub dev: bool,
    pub size: u64,
    /// Kleines Icon als data:-URL
    pub icon: Option<String>,
    pub modified: i64,
    /// Woher (CurseForge-Projekt), falls über den Launcher installiert
    pub source: Option<PackSource>,
}

/// Herkunft (in `.vibe-source.json` im Pack-Ordner).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PackSource {
    pub project_id: String,
    pub file_id: String,
    pub title: Option<String>,
}

pub(super) const SOURCE_FILE: &str = ".vibe-source.json";

pub(super) fn folders(kind: PackKind) -> [(&'static str, bool); 2] {
    match kind {
        PackKind::Resource => [("resource_packs", false), ("development_resource_packs", true)],
        PackKind::Behavior => [("behavior_packs", false), ("development_behavior_packs", true)],
        PackKind::Skin => [("skin_packs", false), ("development_skin_packs", true)],
        PackKind::WorldTemplate => [("world_templates", false), ("world_templates", false)],
    }
}

pub(super) fn mtime(p: &Path) -> i64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Pack-Ordner lesen (`None`, wenn kein gültiges Manifest).
pub fn read_pack_dir(dir: &Path) -> Option<Manifest> {
    let bytes = std::fs::read(dir.join("manifest.json")).ok()?;
    let lang = std::fs::read_to_string(dir.join("texts").join("en_US.lang")).ok();
    manifest::parse(&bytes, lang.as_deref()).ok()
}

/// Alle Packs unter `packs_dir` (= Slot mit Packs).
pub fn list(packs_dir: &Path, with_icons: bool) -> Vec<BedrockPack> {
    let mut out = Vec::new();
    for kind in PackKind::all() {
        let mut seen = std::collections::HashSet::new();
        for (folder, dev) in folders(kind) {
            if !seen.insert(folder) {
                continue;
            }
            let Ok(rd) = std::fs::read_dir(packs_dir.join(folder)) else { continue };
            for e in rd.flatten() {
                let dir = e.path();
                if !dir.is_dir() {
                    continue;
                }
                let Some(m) = read_pack_dir(&dir) else { continue };
                let name = e.file_name().to_string_lossy().to_string();
                let icon = if with_icons { super::super::icon_data_url(&dir.join("pack_icon.png"), 96) } else { None };
                let source = std::fs::read(dir.join(SOURCE_FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok());
                out.push(BedrockPack {
                    id: format!("{folder}/{name}"),
                    kind: m.kind,
                    name: m.name,
                    description: m.description,
                    uuid: m.uuid,
                    version: m.version,
                    min_engine: m.min_engine,
                    dev,
                    size: super::super::dir_size(&dir),
                    icon,
                    modified: mtime(&dir),
                    source,
                });
            }
        }
    }
    out.sort_by_key(|p| p.name.to_lowercase());
    out
}

/// Pack-ID (`resource_packs/<ordner>`) prüfen und auflösen.
pub fn resolve(packs_dir: &Path, id: &str) -> AppResult<PathBuf> {
    let (folder, name) = id.split_once('/').ok_or_else(|| AppError::Invalid("Ungültige Pack-ID".into()))?;
    let ok_folder = PackKind::all().iter().flat_map(|k| folders(*k)).any(|(f, _)| f == folder);
    if !ok_folder || name.is_empty() || name.contains(['/', '\\', ':']) || name == "." || name == ".." {
        return Err(AppError::Invalid("Ungültige Pack-ID".into()));
    }
    let p = packs_dir.join(folder).join(name);
    if !p.join("manifest.json").is_file() {
        return Err(AppError::NotFound(format!("Pack {id}")));
    }
    Ok(p)
}
