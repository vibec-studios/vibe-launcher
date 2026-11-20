use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const POINTER_FILE: &str = "location.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct Pointer {
    pub root: Option<PathBuf>,
    pub cleanup_from: Option<PathBuf>,
}

pub fn default_root() -> PathBuf {
    dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")).join("VibeLauncher")
}

pub fn pointer_file(default_root: &Path) -> PathBuf {
    default_root.join(POINTER_FILE)
}

pub fn read(default_root: &Path) -> Pointer {
    std::fs::read(pointer_file(default_root)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn write(default_root: &Path, p: &Pointer) -> crate::error::AppResult<()> {
    std::fs::create_dir_all(default_root)?;
    crate::util::write_json_atomic(&pointer_file(default_root), p)
}

pub fn resolve(env: Option<PathBuf>, default_root: &Path) -> PathBuf {
    if let Some(e) = env {
        return e;
    }
    match read(default_root).root {
        Some(r) if r.is_absolute() && r.is_dir() => r,
        _ => default_root.to_path_buf(),
    }
}

pub fn env_override() -> Option<PathBuf> {
    std::env::var_os("VIBE_LAUNCHER_HOME").map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::testdir::TestDir;

    #[test]
    fn env_wins() {
        let d = TestDir::new("loc");
        let custom = d.path().join("custom");
        std::fs::create_dir_all(&custom).unwrap();
        write(d.path(), &Pointer { root: Some(custom.clone()), cleanup_from: None }).unwrap();
        assert_eq!(resolve(Some(PathBuf::from("/x")), d.path()), PathBuf::from("/x"));
        assert_eq!(resolve(None, d.path()), custom);
    }

    #[test]
    fn missing_or_bad_pointer_falls_back() {
        let d = TestDir::new("loc");
        assert_eq!(resolve(None, d.path()), d.path());
        write(d.path(), &Pointer { root: Some(d.path().join("gone")), cleanup_from: None }).unwrap();
        assert_eq!(resolve(None, d.path()), d.path());
        std::fs::write(pointer_file(d.path()), "kaputt").unwrap();
        assert_eq!(resolve(None, d.path()), d.path());
    }
}
