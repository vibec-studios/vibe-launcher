use serde::de::DeserializeOwned;
use serde::Serialize;
use std::path::Path;
use vibe_server_core::error::AppResult;

pub fn read<T: DeserializeOwned + Default>(path: &Path) -> T {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn write<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    vibe_server_core::util::write_json_atomic(path, value)?;
    restrict(path);
    Ok(())
}

#[cfg(unix)]
pub fn restrict(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    fix_owner(path);
}

#[cfg(unix)]
pub fn fix_owner(path: &Path) {
    use std::os::unix::fs::MetadataExt;
    let Some(parent) = path.parent() else { return };
    let (Ok(pm), Ok(fm)) = (std::fs::metadata(parent), std::fs::metadata(path)) else { return };
    if pm.uid() != fm.uid() || pm.gid() != fm.gid() {
        let _ = std::os::unix::fs::chown(path, Some(pm.uid()), Some(pm.gid()));
    }
}

#[cfg(not(unix))]
pub fn fix_owner(_path: &Path) {}

#[cfg(unix)]
pub fn fix_owner_tree(root: &Path) {
    use std::os::unix::fs::MetadataExt;
    let Ok(rm) = std::fs::metadata(root) else { return };
    for e in walkdir::WalkDir::new(root).min_depth(1).max_depth(3).into_iter().flatten() {
        if let Ok(m) = e.metadata() {
            if m.uid() != rm.uid() || m.gid() != rm.gid() {
                let _ = std::os::unix::fs::lchown(e.path(), Some(rm.uid()), Some(rm.gid()));
            }
        }
    }
}

#[cfg(not(unix))]
pub fn fix_owner_tree(_root: &Path) {}

#[cfg(not(unix))]
pub fn restrict(_path: &Path) {}
