use crate::error::{AppError, AppResult};
use crate::paths::portable as marker;
use serde::Serialize;
use std::path::Path;

pub const MARKER_TEXT: &str = "Diese Datei schaltet den portablen Modus ein: Alle Daten liegen im Ordner VibeData neben dem Launcher.\r\nThis file enables portable mode: all data is stored in the VibeData folder next to the launcher.\r\n";

#[derive(Debug, Clone, Serialize)]
pub struct CopyResult {
    pub exe: String,
    pub dir: String,
    pub updated: bool,
}

fn same_dir(a: &Path, b: &Path) -> bool {
    matches!((std::fs::canonicalize(a), std::fs::canonicalize(b)), (Ok(x), Ok(y)) if x == y)
}

pub fn install_into(src_exe: &Path, target: &Path) -> AppResult<CopyResult> {
    if !target.is_absolute() || !target.is_dir() {
        return Err(AppError::Msg("Bitte einen vorhandenen Ordner auswählen, zum Beispiel auf deinem USB-Stick.".into()));
    }
    if src_exe.parent().is_some_and(|d| same_dir(d, target)) {
        return Err(AppError::Msg("Das ist der Ordner, aus dem dieser Launcher gerade läuft. Bitte einen anderen Ordner wählen.".into()));
    }
    let name = src_exe.file_name().ok_or_else(|| AppError::msg("Launcher-Datei nicht gefunden"))?;
    let dest = target.join(name);
    let updated = dest.exists();
    let tmp = target.join(format!("{}.new", name.to_string_lossy()));
    std::fs::copy(src_exe, &tmp).map_err(|e| AppError::Msg(format!("Kopieren fehlgeschlagen (ist genug Platz frei und der Ordner beschreibbar?): {e}")))?;
    if let Err(e) = std::fs::rename(&tmp, &dest) {
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::Msg(if updated {
            format!("Der portable Launcher in diesem Ordner läuft gerade. Bitte erst schließen und dann erneut versuchen. ({e})")
        } else {
            format!("Launcher konnte nicht abgelegt werden: {e}")
        }));
    }
    let m = target.join(marker::MARKER);
    if !m.is_file() {
        std::fs::write(&m, MARKER_TEXT)?;
    }
    Ok(CopyResult { exe: dest.to_string_lossy().to_string(), dir: target.to_string_lossy().to_string(), updated })
}

pub fn create(target: &str) -> AppResult<CopyResult> {
    let exe = std::env::current_exe().map_err(|e| AppError::Msg(format!("Launcher-Datei nicht gefunden: {e}")))?;
    install_into(&exe, Path::new(target.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::testdir::TestDir;
    use std::path::PathBuf;

    fn fake_exe(d: &TestDir) -> PathBuf {
        let src = d.path().join("app");
        std::fs::create_dir_all(&src).unwrap();
        let exe = src.join("vibe-launcher.exe");
        std::fs::write(&exe, b"v1").unwrap();
        exe
    }

    #[test]
    fn copies_exe_and_writes_marker() {
        let d = TestDir::new("portable-copy");
        let exe = fake_exe(&d);
        let stick = d.path().join("stick");
        std::fs::create_dir_all(&stick).unwrap();
        let r = install_into(&exe, &stick).unwrap();
        assert!(!r.updated);
        assert_eq!(std::fs::read(stick.join("vibe-launcher.exe")).unwrap(), b"v1");
        assert!(stick.join(marker::MARKER).is_file());
        assert!(!stick.join("vibe-launcher.exe.new").exists());
    }

    #[test]
    fn update_keeps_data_and_marker() {
        let d = TestDir::new("portable-copy");
        let exe = fake_exe(&d);
        let stick = d.path().join("stick");
        std::fs::create_dir_all(stick.join(marker::DATA_DIR)).unwrap();
        std::fs::write(stick.join(marker::DATA_DIR).join("settings.json"), "{}").unwrap();
        std::fs::write(stick.join(marker::MARKER), "eigen").unwrap();
        std::fs::write(stick.join("vibe-launcher.exe"), b"alt").unwrap();
        std::fs::write(&exe, b"v2").unwrap();
        let r = install_into(&exe, &stick).unwrap();
        assert!(r.updated);
        assert_eq!(std::fs::read(stick.join("vibe-launcher.exe")).unwrap(), b"v2");
        assert_eq!(std::fs::read_to_string(stick.join(marker::MARKER)).unwrap(), "eigen");
        assert!(stick.join(marker::DATA_DIR).join("settings.json").is_file());
    }

    #[test]
    fn rejects_own_folder_and_missing_target() {
        let d = TestDir::new("portable-copy");
        let exe = fake_exe(&d);
        assert!(install_into(&exe, exe.parent().unwrap()).is_err());
        assert!(install_into(&exe, &d.path().join("fehlt")).is_err());
    }
}
