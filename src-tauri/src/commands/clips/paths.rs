use super::*;

pub(super) fn id_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_[a-z]+(_\d+)?$").unwrap())
}

pub fn valid_id(id: &str) -> bool {
    id_re().is_match(id)
}

/// Reiner Dateiname im selben Ordner: keine Pfadteile, keine Dotfiles, kein `..`, kein Laufwerk.
pub(crate) fn plain_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':', '\0'])
        && matches!(Path::new(name).components().collect::<Vec<_>>().as_slice(), [Component::Normal(_)])
}

/// Instanz-ID als einzelner, harmloser Ordnername.
pub(super) fn plain_instance_id(id: &str) -> bool {
    plain_name(id)
}

/// `<instances>/<instance_id>/minecraft/vibeyclient/clips` – ohne Dateisystemzugriff.
pub fn clips_dir_in(instances_root: &Path, instance_id: &str) -> AppResult<PathBuf> {
    if !plain_instance_id(instance_id) {
        return Err(AppError::Invalid("Instanz".into()));
    }
    Ok(instances_root.join(instance_id).join("minecraft").join("vibeyclient").join("clips"))
}

/// Datei im Clip-Ordner, nachdem Namen geprüft und Symlinks/Junctions aufgelöst sind: muss im Instanzordner bleiben.
pub(crate) fn checked_file(instances_root: &Path, dir: &Path, name: &str) -> AppResult<PathBuf> {
    if !plain_name(name) {
        return Err(AppError::Invalid("Kein Clip-Dateiname".into()));
    }
    let p = dir.join(name);
    let canon = p.canonicalize().map_err(|_| AppError::NotFound("Clip".into()))?;
    let root = instances_root.canonicalize()?;
    if !canon.starts_with(&root) {
        return Err(AppError::Invalid("Pfad außerhalb des Datenordners".into()));
    }
    Ok(canon)
}
