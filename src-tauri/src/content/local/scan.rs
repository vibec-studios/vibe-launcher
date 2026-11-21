use super::*;

#[derive(Debug, Clone)]
pub struct Scanned {
    pub file_name: String,
    pub key: String,
    pub enabled: bool,
    pub path: PathBuf,
    pub meta: LocalMeta,
    pub modified: i64,
    pub size: u64,
}

pub(super) struct RawEntry {
    pub(super) file_name: String,
    pub(super) path: PathBuf,
    pub(super) is_dir: bool,
    pub(super) size: u64,
    pub(super) mtime: i64,
}

pub(super) fn accepts(kind: ContentKind, name: &str, is_dir: bool) -> bool {
    if name.starts_with('.') || name.ends_with(".part") || name.ends_with(".tmp") {
        return false;
    }
    let base = index::strip_disabled(name).to_ascii_lowercase();
    match kind {
        ContentKind::Mod => !is_dir && (base.ends_with(".jar") || base.ends_with(".zip") || base.ends_with(".litemod")),
        _ => is_dir || base.ends_with(".zip"),
    }
}

pub(super) fn mtime_ms(m: &std::fs::Metadata) -> i64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(super) fn dir_size(p: &Path) -> u64 {
    walkdir::WalkDir::new(p).into_iter().flatten().filter(|e| e.file_type().is_file()).filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum()
}

pub(super) fn list_raw(dir: &Path, kind: ContentKind) -> Vec<RawEntry> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut out = Vec::new();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Ok(m) = e.metadata() else { continue };
        if !accepts(kind, &name, m.is_dir()) {
            continue;
        }
        out.push(RawEntry { file_name: name, path: e.path(), is_dir: m.is_dir(), size: if m.is_dir() { 0 } else { m.len() }, mtime: mtime_ms(&m) });
    }
    out
}

pub(super) fn meta_valid(m: &LocalMeta, r: &RawEntry) -> bool {
    m.meta_version == crate::content::index::META_VERSION && m.is_dir == r.is_dir && m.mtime == r.mtime && (r.is_dir || m.size == r.size)
}

pub fn icons_dir(state: &AppState) -> PathBuf {
    state.paths.cache().join("icons")
}

/// Ordner einer Art scannen; Metadaten werden bei Bedarf (parallel) gelesen und im Index gecacht.
pub async fn scan(state: &AppState, instance_id: &str, kind: ContentKind) -> AppResult<(Vec<Scanned>, ContentIndex)> {
    state.instances.get(instance_id)?;
    let dir = state.paths.game_dir(instance_id).join(kind.folder());
    let paths = state.paths.clone();
    let id = instance_id.to_string();
    let (raw, idx) = tokio::task::spawn_blocking(move || (list_raw(&dir, kind), ContentIndex::load(&paths, &id))).await?;

    let folder = kind.folder();
    let todo: Vec<(String, PathBuf, bool, u64, i64)> = raw
        .iter()
        .filter(|r| idx.local.get(&index::key(folder, &r.file_name)).map_or(true, |m| !meta_valid(m, r)))
        .map(|r| (index::key(folder, &r.file_name), r.path.clone(), r.is_dir, r.size, r.mtime))
        .collect();

    let icons = icons_dir(state);
    let computed: Vec<(String, LocalMeta)> = futures::stream::iter(todo.into_iter().map(|(key, path, is_dir, size, mtime)| {
        let icons = icons.clone();
        async move {
            let m = tokio::task::spawn_blocking(move || {
                let mut m = crate::content::meta::read_entry(&path, kind, &icons);
                m.mtime = mtime;
                m.size = if is_dir { dir_size(&path) } else { size };
                m
            })
            .await
            .unwrap_or_default();
            (key, m)
        }
    }))
    .buffer_unordered(std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 12))
    .collect()
    .await;

    // Aufräumen: verschwundene Dateien, ersetzte Dateien (SHA-1 passt nicht mehr zum Index)
    let present: HashSet<String> = raw.iter().map(|r| index::key(folder, &r.file_name)).collect();
    let prefix = format!("{folder}/");
    let mut probe = idx.clone();
    for (k, m) in &computed {
        probe.local.insert(k.clone(), m.clone());
    }
    let stale_local: Vec<String> = probe.local.keys().filter(|k| k.starts_with(&prefix) && !present.contains(*k)).cloned().collect();
    let stale_files: Vec<String> = probe
        .files
        .iter()
        .filter(|(k, e)| {
            k.starts_with(&prefix)
                && (!present.contains(*k)
                    || match (&e.sha1, probe.local.get(*k).and_then(|m| m.sha1.as_ref())) {
                        (Some(a), Some(b)) => !a.eq_ignore_ascii_case(b),
                        _ => false,
                    })
        })
        .map(|(k, _)| k.clone())
        .collect();

    let idx = if computed.is_empty() && stale_local.is_empty() && stale_files.is_empty() {
        idx
    } else {
        let lock = state.content.lock(instance_id);
        let _g = lock.lock().await;
        let mut idx = ContentIndex::load(&state.paths, instance_id);
        for (k, m) in computed {
            idx.local.insert(k, m);
        }
        for k in &stale_local {
            idx.local.remove(k);
        }
        for k in &stale_files {
            idx.files.remove(k);
        }
        idx.save(&state.paths, instance_id)?;
        idx
    };

    let mut out: Vec<Scanned> = raw
        .into_iter()
        .map(|r| {
            let key = index::key(folder, &r.file_name);
            let meta = idx.local.get(&key).cloned().unwrap_or_default();
            Scanned {
                enabled: !r.file_name.ends_with(".disabled"),
                size: if r.is_dir { meta.size } else { r.size },
                modified: r.mtime,
                file_name: r.file_name,
                key,
                path: r.path,
                meta,
            }
        })
        .collect();
    out.sort_by_key(|s| s.file_name.to_lowercase());
    Ok((out, idx))
}

pub(super) fn display_stem(file_name: &str) -> String {
    let base = index::strip_disabled(file_name);
    for ext in [".jar", ".zip", ".litemod"] {
        if base.to_ascii_lowercase().ends_with(ext) {
            return base[..base.len() - ext.len()].to_string();
        }
    }
    base.to_string()
}

pub fn to_item(s: &Scanned, idx: &ContentIndex, kind: ContentKind, icons: &Path) -> ContentItem {
    let entry = idx.files.get(&s.key);
    let icon = entry
        .and_then(|e| e.icon_url.clone())
        .or_else(|| s.meta.icon.as_deref().and_then(|i| crate::content::meta::icon_data_url(icons, i)));
    ContentItem {
        file_name: s.file_name.clone(),
        kind,
        enabled: s.enabled,
        name: s.meta.name.clone().or_else(|| entry.and_then(|e| e.title.clone())).unwrap_or_else(|| display_stem(&s.file_name)),
        version: s.meta.version.clone().filter(|v| !v.starts_with("${")).or_else(|| entry.and_then(|e| e.version_number.clone())),
        description: s.meta.description.clone(),
        authors: s.meta.authors.clone(),
        icon,
        source: entry.map(|e| e.source),
        project_id: entry.map(|e| e.project_id.clone()),
        version_id: entry.map(|e| e.version_id.clone()),
        size: s.size,
        modified: s.modified,
        side: crate::content::sides::item_side(kind, entry, &s.meta),
        pinned: idx.pinned.contains(&s.key),
    }
}

pub async fn items(state: &AppState, scanned: &[Scanned], idx: &ContentIndex, kind: ContentKind) -> AppResult<Vec<ContentItem>> {
    let icons = icons_dir(state);
    let scanned = scanned.to_vec();
    let idx = idx.clone();
    let mut v = tokio::task::spawn_blocking(move || scanned.iter().map(|s| to_item(s, &idx, kind, &icons)).collect::<Vec<_>>()).await?;
    v.sort_by_key(|i| i.name.to_lowercase());
    Ok(v)
}
