//! Kleine Helfer.
pub mod diskspace;
pub mod spacecheck;
#[cfg(test)]
pub mod testdir;
use crate::error::AppResult;
pub use vibe_server_core::util::{copy_dir_all, now_ms, safe_join, write_json_atomic};
use std::path::Path;




/// Ordner/Datei im Datei-Explorer öffnen.
pub fn open_in_explorer(path: &Path) -> AppResult<()> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer").arg(path).spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(path).spawn()?;
    }
    Ok(())
}

