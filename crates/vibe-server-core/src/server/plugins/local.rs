use super::*;

// ------------------------------------------------------------------ Lokale Dateien

#[derive(Debug, Clone, Serialize)]
pub struct Addon {
    pub file_name: String,
    pub enabled: bool,
    pub size: u64,
    pub modified: i64,
    pub sha1: Option<String>,
    pub name: Option<String>,
    pub version: Option<String>,
    pub authors: Vec<String>,
    pub description: Option<String>,
    /// data:-URL (aus der JAR) oder Projekt-Icon-URL
    pub icon: Option<String>,
    pub source: Option<AddonSource>,
    pub project_id: Option<String>,
    pub slug: Option<String>,
    pub version_id: Option<String>,
    pub title: Option<String>,
    pub page_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AddonList {
    pub target: AddonTarget,
    pub items: Vec<Addon>,
}

pub(super) fn mtime_ms(m: &std::fs::Metadata) -> i64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}



/// JAR-Dateien im Ordner (aktiv und `.disabled`), ohne Metadaten-Ordner der Plugins.
pub(super) fn list_files(dir: &Path) -> Vec<(String, PathBuf, std::fs::Metadata)> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut out: Vec<_> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let m = e.metadata().ok()?;
            (m.is_file() && base_name(&name).to_ascii_lowercase().ends_with(".jar") && !name.starts_with('.')).then(|| (name, e.path(), m))
        })
        .collect();
    out.sort_by_key(|(n, _, _)| base_name(n).to_ascii_lowercase());
    out
}



/// Metadaten-Cache je (Pfad, Größe, Zeit), damit die Liste nicht jedes Mal alle JARs liest.
pub(super) type MetaKey = (PathBuf, u64, i64);

pub(super) fn meta_cache() -> &'static parking_lot::Mutex<HashMap<MetaKey, Addon>> {
    static C: std::sync::OnceLock<parking_lot::Mutex<HashMap<MetaKey, Addon>>> = std::sync::OnceLock::new();
    C.get_or_init(Default::default)
}



pub(super) fn read_local(path: &Path, name: &str, m: &std::fs::Metadata, plugins: bool, icons: &Path) -> Addon {
    let key = (path.to_path_buf(), m.len(), mtime_ms(m));
    if let Some(a) = meta_cache().lock().get(&key) {
        return Addon { file_name: name.to_string(), enabled: !name.ends_with(".disabled"), ..a.clone() };
    }
    let lm = meta::read_entry(path, ContentKind::Mod, icons);
    let mut a = Addon {
        file_name: name.to_string(),
        enabled: !name.ends_with(".disabled"),
        size: m.len(),
        modified: mtime_ms(m),
        sha1: lm.sha1.clone(),
        name: lm.name.clone(),
        version: lm.version.clone(),
        authors: lm.authors.clone(),
        description: lm.description.clone(),
        icon: lm.icon.as_deref().and_then(|i| meta::icon_data_url(icons, i)),
        source: None,
        project_id: None,
        slug: None,
        version_id: None,
        title: None,
        page_url: None,
    };
    if plugins || a.name.is_none() {
        if let Some(y) = read_plugin_meta(path) {
            a.name = y.name;
            a.version = y.version.or(a.version);
            a.description = y.description.or(a.description);
            if !y.authors.is_empty() {
                a.authors = y.authors;
            }
        }
    }
    meta_cache().lock().insert(key, a.clone());
    a
}



pub(super) fn modrinth_page(slug: &str, plugins: bool) -> String {
    format!("https://modrinth.com/{}/{slug}", if plugins { "plugin" } else { "mod" })
}



pub(super) fn hangar_page(slug: &str) -> String {
    format!("https://hangar.papermc.io/{slug}")
}



/// Installierte Erweiterungen mit Herkunft (Index + Modrinth-Hash-Abfrage; Netzfehler werden ignoriert).
pub async fn list(state: &Core, s: &Server) -> AppResult<AddonList> {
    let t = target(s).ok_or_else(|| AppError::Invalid("Vanilla-Server haben keine Plugins oder Mods.".into()))?;
    let sdir = server_dir(&state.paths, &s.id);
    let dir = sdir.join(t.folder);
    let icons = state.paths.cache().join("icons");
    let plugins = t.plugins;
    let d2 = dir.clone();
    let mut items: Vec<Addon> = tokio::task::spawn_blocking(move || {
        list_files(&d2).into_iter().map(|(n, p, m)| read_local(&p, &n, &m, plugins, &icons)).collect::<Vec<_>>()
    })
    .await?;
    let mut index = load_index(&sdir);
    // Unbekannte Dateien bei Modrinth nachschlagen
    let unknown: Vec<String> = items
        .iter()
        .filter(|a| index.get(base_name(&a.file_name)).and_then(|e| e.project_id.as_ref()).is_none())
        .filter_map(|a| a.sha1.clone())
        .collect();
    if !unknown.is_empty() {
        if let Ok(found) = mr::versions_by_hash(state, &unknown).await {
            let pids: Vec<String> = found.values().map(|v| v.project_id.clone()).collect::<HashSet<_>>().into_iter().collect();
            let projects = mr::raw_projects(state, &pids).await.unwrap_or_default();
            let mut changed = false;
            for a in &items {
                let Some(v) = a.sha1.as_ref().and_then(|h| found.get(&h.to_ascii_lowercase())) else { continue };
                let p = projects.iter().find(|p| p.id == v.project_id);
                index.insert(
                    base_name(&a.file_name).to_string(),
                    IndexEntry {
                        source: Some(AddonSource::Modrinth),
                        project_id: Some(v.project_id.clone()),
                        slug: p.map(|p| p.slug.clone()),
                        version_id: Some(v.id.clone()),
                        version_name: Some(v.version_number.clone()),
                        title: p.map(|p| p.title.clone()),
                        icon_url: p.and_then(|p| p.icon_url.clone()).filter(|u| !u.is_empty()),
                    },
                );
                changed = true;
            }
            if changed {
                let _ = save_index(&sdir, &index);
            }
        }
    }
    for a in items.iter_mut() {
        if let Some(e) = index.get(base_name(&a.file_name)) {
            a.source = e.source;
            a.project_id = e.project_id.clone();
            a.slug = e.slug.clone();
            a.version_id = e.version_id.clone();
            a.title = e.title.clone();
            if a.icon.is_none() {
                a.icon = e.icon_url.clone();
            }
            a.page_url = match (e.source, e.slug.as_deref()) {
                (Some(AddonSource::Modrinth), Some(slug)) => Some(modrinth_page(slug, plugins)),
                (Some(AddonSource::Hangar), Some(slug)) => Some(hangar_page(slug)),
                _ => None,
            };
        }
    }
    Ok(AddonList { target: t, items })
}



pub fn set_enabled(state: &Core, s: &Server, file: &str, enabled: bool) -> AppResult<String> {
    let t = target(s).ok_or_else(|| AppError::Invalid("Kein Plugin-/Mod-Ordner".into()))?;
    let dir = server_dir(&state.paths, &s.id).join(t.folder);
    let from = crate::util::safe_join(&dir, file).filter(|p| p.is_file()).ok_or_else(|| AppError::NotFound(file.to_string()))?;
    let base = base_name(file).to_string();
    let to_name = if enabled { base.clone() } else { format!("{base}.disabled") };
    if to_name != file {
        std::fs::rename(&from, dir.join(&to_name))?;
    }
    Ok(to_name)
}



pub fn remove(state: &Core, s: &Server, file: &str) -> AppResult<()> {
    let t = target(s).ok_or_else(|| AppError::Invalid("Kein Plugin-/Mod-Ordner".into()))?;
    let sdir = server_dir(&state.paths, &s.id);
    let p = crate::util::safe_join(&sdir.join(t.folder), file).filter(|p| p.is_file()).ok_or_else(|| AppError::NotFound(file.to_string()))?;
    if trash::delete(&p).is_err() {
        std::fs::remove_file(&p)?;
    }
    let mut idx = load_index(&sdir);
    if idx.remove(base_name(file)).is_some() {
        save_index(&sdir, &idx)?;
    }
    Ok(())
}
