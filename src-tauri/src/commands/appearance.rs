//! Theme-Dateien (Einstellungen → Darstellung → Eigene Themes): exportieren und importieren.
use crate::error::{AppError, AppResult};
use crate::settings::theme::valid_id;
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::State;

const MAX_BYTES: u64 = 1_600 * 1024;
const EXTENSIONS: &[&str] = &["vibetheme", "json"];
const STORE_DIR: &str = "themes";
const STORE_EXT: &str = "vibetheme";

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
        return Err(AppError::Invalid("Datei ist zu groß für ein Theme (max. 1,6 MB)".into()));
    }
    String::from_utf8(std::fs::read(path)?).map_err(|_| AppError::Invalid("Datei ist kein Text (UTF-8)".into()))
}

fn store_file(dir: &Path, id: &str) -> AppResult<PathBuf> {
    if !valid_id(id) {
        return Err(AppError::Invalid("Ungültige Theme-Id".into()));
    }
    Ok(dir.join(format!("{id}.{STORE_EXT}")))
}

fn store_save(dir: &Path, id: &str, content: &str) -> AppResult<()> {
    let file = store_file(dir, id)?;
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{id}.tmp"));
    write_theme(&tmp, content)?;
    std::fs::rename(&tmp, &file)?;
    Ok(())
}

fn store_load(dir: &Path, id: &str) -> AppResult<Option<String>> {
    let file = store_file(dir, id)?;
    if !file.is_file() {
        return Ok(None);
    }
    read_theme(&file).map(Some)
}

fn store_delete(dir: &Path, id: &str) -> AppResult<()> {
    let file = store_file(dir, id)?;
    if file.is_file() {
        std::fs::remove_file(file)?;
    }
    Ok(())
}

fn store_prune(dir: &Path, keep: &[String]) -> AppResult<u32> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Ok(0) };
    let mut removed = 0;
    for e in rd.flatten() {
        let path = e.path();
        let ext = path.extension().and_then(|x| x.to_str()).unwrap_or_default();
        let stem = path.file_stem().and_then(|x| x.to_str()).unwrap_or_default();
        let stale = (ext == STORE_EXT && !keep.iter().any(|k| k == stem)) || ext == "tmp";
        if stale && path.is_file() && std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
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

#[tauri::command]
pub async fn appearance_theme_ext_save(state: State<'_, AppState>, id: String, content: String) -> AppResult<()> {
    let dir = state.paths.root.join(STORE_DIR);
    tokio::task::spawn_blocking(move || store_save(&dir, &id, &content)).await?
}

#[tauri::command]
pub async fn appearance_theme_ext_load(state: State<'_, AppState>, id: String) -> AppResult<Option<String>> {
    let dir = state.paths.root.join(STORE_DIR);
    tokio::task::spawn_blocking(move || store_load(&dir, &id)).await?
}

#[tauri::command]
pub async fn appearance_theme_ext_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let dir = state.paths.root.join(STORE_DIR);
    tokio::task::spawn_blocking(move || store_delete(&dir, &id)).await?
}

#[tauri::command]
pub async fn appearance_theme_ext_prune(state: State<'_, AppState>, keep: Vec<String>) -> AppResult<u32> {
    let dir = state.paths.root.join(STORE_DIR);
    tokio::task::spawn_blocking(move || store_prune(&dir, &keep)).await?
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
        assert!(write_theme(&file, &"x".repeat(1_000 * 1024)).is_ok());
        assert!(write_theme(&file, &"x".repeat(1_700 * 1024)).is_err());
        std::fs::write(&file, vec![b'x'; 1_700 * 1024]).unwrap();
        assert!(read_theme(&file).is_err());
        assert!(checked_path("C:/x/theme.exe").is_err());
        assert!(checked_path("C:/x/theme.JSON").is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn theme_store_ids_and_prune() {
        let dir = std::env::temp_dir().join(format!("vl-theme-store-{}", std::process::id()));
        assert_eq!(store_load(&dir, "t1").unwrap(), None);
        store_save(&dir, "t1", "{\"a\":1}").unwrap();
        store_save(&dir, "t2", "{\"b\":2}").unwrap();
        assert_eq!(store_load(&dir, "t1").unwrap().as_deref(), Some("{\"a\":1}"));
        assert!(store_save(&dir, "../t3", "x").is_err());
        assert!(store_load(&dir, "a/b").is_err());
        assert!(store_delete(&dir, "..").is_err());
        std::fs::write(dir.join("t9.tmp"), "x").unwrap();
        std::fs::write(dir.join("notes.txt"), "x").unwrap();
        assert_eq!(store_prune(&dir, &["t2".into()]).unwrap(), 2);
        assert_eq!(store_load(&dir, "t1").unwrap(), None);
        assert!(store_load(&dir, "t2").unwrap().is_some());
        assert!(dir.join("notes.txt").is_file());
        store_delete(&dir, "t2").unwrap();
        assert_eq!(store_load(&dir, "t2").unwrap(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
