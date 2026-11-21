use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const MARKER: &str = "portable.txt";
pub const DATA_DIR: &str = "VibeData";

pub fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(Path::to_path_buf)
}

pub fn root_for(exe_dir: &Path) -> Option<PathBuf> {
    exe_dir.join(MARKER).is_file().then(|| exe_dir.join(DATA_DIR))
}

pub fn root() -> Option<PathBuf> {
    static ROOT: OnceLock<Option<PathBuf>> = OnceLock::new();
    ROOT.get_or_init(|| exe_dir().as_deref().and_then(root_for)).clone()
}

pub fn active() -> bool {
    std::env::var_os("VIBE_LAUNCHER_HOME").is_none() && root().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::testdir::TestDir;

    #[test]
    fn marker_enables_portable_root() {
        let d = TestDir::new("portable");
        assert_eq!(root_for(d.path()), None);
        std::fs::write(d.path().join(MARKER), "").unwrap();
        assert_eq!(root_for(d.path()), Some(d.path().join(DATA_DIR)));
    }

    #[test]
    fn marker_must_be_a_file() {
        let d = TestDir::new("portable");
        std::fs::create_dir_all(d.path().join(MARKER)).unwrap();
        assert_eq!(root_for(d.path()), None);
    }
}
