use super::*;

pub(super) fn dir_size(p: &Path) -> u64 {
    walkdir::WalkDir::new(p).into_iter().flatten().filter(|e| e.file_type().is_file()).filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum()
}

pub async fn entries(state: &AppState, instance_id: &str) -> AppResult<Vec<ExportEntry>> {
    state.instances.get(instance_id)?;
    let game = state.paths.game_dir(instance_id);
    tokio::task::spawn_blocking(move || {
        let Ok(rd) = std::fs::read_dir(&game) else { return Ok(vec![]) };
        let mut v: Vec<ExportEntry> = rd
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                let m = e.metadata().ok()?;
                let is_dir = m.is_dir();
                Some(ExportEntry {
                    size: if is_dir { dir_size(&e.path()) } else { m.len() },
                    default_selected: DEFAULT_ON.contains(&name.as_str()),
                    path: name,
                    is_dir,
                })
            })
            .collect();
        v.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.path.to_lowercase().cmp(&b.path.to_lowercase())));
        Ok(v)
    })
    .await?
}

/// Datei im Export.
pub(super) struct Src {
    pub(super) rel: String,
    pub(super) abs: PathBuf,
    pub(super) size: u64,
}

pub(super) fn collect(game: &Path, include: &[String]) -> AppResult<Vec<Src>> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for inc in include {
        let base = safe_join(game, inc).ok_or_else(|| AppError::Invalid(format!("Ungültiger Pfad: {inc}")))?;
        if !base.exists() {
            continue;
        }
        for e in walkdir::WalkDir::new(&base).into_iter().flatten() {
            if !e.file_type().is_file() {
                continue;
            }
            let Ok(rel) = e.path().strip_prefix(game) else { continue };
            let rel = rel.to_string_lossy().replace('\\', "/");
            if rel.ends_with(".part") || !seen.insert(rel.clone()) {
                continue;
            }
            out.push(Src { size: e.metadata().map(|m| m.len()).unwrap_or(0), rel, abs: e.path().to_path_buf() });
        }
    }
    Ok(out)
}

/// Index-Eintrag zu einer aktivierten Datei in einem Inhaltsordner, wenn der Hash noch passt.
pub(super) fn known<'a>(idx: &'a ContentIndex, rel: &str) -> Option<&'a IndexEntry> {
    let (folder, file) = rel.split_once('/')?;
    if file.contains('/') || file.ends_with(".disabled") || ContentKind::from_folder(folder).is_none() {
        return None;
    }
    let key = index::key(folder, file);
    let e = idx.files.get(&key)?;
    let local = idx.local.get(&key)?.sha1.as_ref()?;
    match &e.sha1 {
        Some(s) if !s.eq_ignore_ascii_case(local) => None,
        _ => Some(e),
    }
}

pub(super) fn compression(rel: &str) -> zip::CompressionMethod {
    let l = rel.to_ascii_lowercase();
    if [".jar", ".zip", ".png", ".jpg", ".ogg", ".gz", ".mrpack"].iter().any(|e| l.ends_with(e)) {
        zip::CompressionMethod::Stored
    } else {
        zip::CompressionMethod::Deflated
    }
}

pub(super) fn side(v: Option<&str>) -> &'static str {
    match v {
        Some("unsupported") => "unsupported",
        Some("optional") => "optional",
        _ => "required",
    }
}

pub(super) fn require_loader_version(inst: &crate::instance::Instance) -> AppResult<Option<String>> {
    if inst.loader.kind == LoaderKind::Vanilla {
        return Ok(None);
    }
    inst.loader
        .version
        .clone()
        .filter(|v| !v.is_empty())
        .map(Some)
        .ok_or_else(|| AppError::Invalid("Die Loader-Version der Instanz ist nicht festgelegt – bitte in den Instanz-Einstellungen wählen".into()))
}
