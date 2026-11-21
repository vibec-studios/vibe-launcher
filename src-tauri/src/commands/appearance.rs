//! Theme-Dateien (Einstellungen → Darstellung → Eigene Themes): exportieren und importieren.
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

const MAX_BYTES: u64 = 64 * 1024;
const EXTENSIONS: &[&str] = &["vibetheme", "json"];

fn checked_path(path: &str) -> AppResult<PathBuf> {
    let p = PathBuf::from(path);
    let ext = p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    if !EXTENSIONS.contains(&ext.as_str()) {
        return Err(AppError::Invalid(format!("Dateityp .{ext} wird nicht unterstützt (.vibetheme)")));
    }
    Ok(p)
}

fn write_theme(path: &Path, content: &str) -> AppResult<()> {
    if content.len() as u64 > MAX_BYTES {
        return Err(AppError::Invalid("Theme ist zu groß".into()));
    }
    std::fs::write(path, content)?;
    Ok(())
}

fn read_theme(path: &Path) -> AppResult<String> {
    let meta = std::fs::metadata(path)?;
    if !meta.is_file() {
        return Err(AppError::Invalid("Keine Datei".into()));
    }
    if meta.len() > MAX_BYTES {
        return Err(AppError::Invalid("Datei ist zu groß für ein Theme (max. 64 KB)".into()));
    }
    String::from_utf8(std::fs::read(path)?).map_err(|_| AppError::Invalid("Datei ist kein Text (UTF-8)".into()))
}

/// Theme-Datei schreiben (Inhalt kommt validiert aus dem Frontend, hier nur Größe und Dateityp).
#[tauri::command]
pub async fn appearance_theme_write(path: String, content: String) -> AppResult<()> {
    let p = checked_path(&path)?;
    tokio::task::spawn_blocking(move || write_theme(&p, &content)).await?
}

/// Theme-Datei lesen; das Frontend prüft Format und Werte.
#[tauri::command]
pub async fn appearance_theme_read(path: String) -> AppResult<String> {
    let p = checked_path(&path)?;
    tokio::task::spawn_blocking(move || read_theme(&p)).await?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn theme_files_roundtrip_and_limits() {
        let dir = std::env::temp_dir().join(format!("vl-theme-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("Mein Theme.vibetheme");
        write_theme(&file, "{\"format\":\"vibe-launcher-theme\"}").unwrap();
        assert_eq!(read_theme(&file).unwrap(), "{\"format\":\"vibe-launcher-theme\"}");
        assert!(write_theme(&file, &"x".repeat(70 * 1024)).is_err());
        std::fs::write(&file, vec![b'x'; 70 * 1024]).unwrap();
        assert!(read_theme(&file).is_err());
        assert!(checked_path("C:/x/theme.exe").is_err());
        assert!(checked_path("C:/x/theme.JSON").is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
