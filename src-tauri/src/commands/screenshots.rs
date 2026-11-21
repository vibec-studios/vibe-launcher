//! OWNER: Frontend-Agent A. Screenshots aller Instanzen (`instances/<id>/minecraft/screenshots`):
//! Liste, gecachte Vorschaubilder (`cache/thumbs`), Löschen, in die Zwischenablage kopieren, im Ordner zeigen.
//! Alle Pfade aus dem Frontend werden gegen den Instanz-Ordner geprüft (kein Ausbruch aus dem Datenordner).
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::State;
use tokio::sync::Semaphore;

const THUMB_W: u32 = 480;
const THUMB_H: u32 = 360;

#[derive(Debug, Clone, Serialize)]
pub struct Screenshot {
    pub instance_id: String,
    pub file_name: String,
    /// Absoluter Pfad
    pub path: String,
    pub size: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Aufnahmezeit (ms seit 1970) – aus dem Dateinamen (`2024-05-01_12.34.56.png`), sonst Änderungszeit
    pub taken_at: i64,
}

fn is_image(p: &Path) -> bool {
    matches!(
        p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(),
        Some("png" | "jpg" | "jpeg")
    )
}

/// Zeit aus Minecrafts Dateinamen `YYYY-MM-DD_HH.MM.SS[_n].png` (lokale Zeit).
fn time_from_name(name: &str) -> Option<i64> {
    let stem = name.get(..19)?;
    let dt = chrono::NaiveDateTime::parse_from_str(stem, "%Y-%m-%d_%H.%M.%S").ok()?;
    let local = dt.and_local_timezone(chrono::Local).earliest()?;
    Some(local.timestamp_millis())
}

fn scan_dir(instance_id: &str, dir: &Path, out: &mut Vec<Screenshot>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if !is_image(&p) {
            continue;
        }
        let Ok(meta) = e.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let file_name = e.file_name().to_string_lossy().to_string();
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        // Nur der Kopf der Datei wird gelesen – schnell auch bei vielen Bildern
        let (width, height) = match image::image_dimensions(&p) {
            Ok((w, h)) => (Some(w), Some(h)),
            Err(_) => (None, None),
        };
        out.push(Screenshot {
            instance_id: instance_id.to_string(),
            taken_at: time_from_name(&file_name).unwrap_or(mtime),
            file_name,
            path: p.to_string_lossy().to_string(),
            size: meta.len(),
            width,
            height,
        });
    }
}

/// Pfad prüfen: muss eine Bilddatei in `instances/<id>/minecraft/screenshots/` sein.
pub(crate) fn checked(state: &AppState, path: &str) -> AppResult<PathBuf> {
    let p = PathBuf::from(path);
    let canon = p.canonicalize().map_err(|_| AppError::NotFound("Screenshot".into()))?;
    let root = state.paths.instances().canonicalize()?;
    let rel = canon.strip_prefix(&root).map_err(|_| AppError::Invalid("Pfad außerhalb des Datenordners".into()))?;
    let parts: Vec<_> = rel.components().collect();
    // <id>/minecraft/screenshots/<datei>
    let ok = parts.len() == 4
        && parts[1].as_os_str() == "minecraft"
        && parts[2].as_os_str() == "screenshots"
        && is_image(&canon);
    if !ok {
        return Err(AppError::Invalid("Kein Screenshot-Pfad".into()));
    }
    Ok(canon)
}

#[tauri::command]
pub async fn screenshots_list(state: State<'_, AppState>, instance_id: Option<String>) -> AppResult<Vec<Screenshot>> {
    let ids: Vec<String> = match instance_id {
        Some(id) => {
            state.instances.get(&id)?;
            vec![id]
        }
        None => state.instances.list().into_iter().map(|i| i.id).collect(),
    };
    let paths = state.paths.clone();
    tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        for id in ids {
            scan_dir(&id, &paths.game_dir(&id).join("screenshots"), &mut out);
        }
        out.sort_by(|a, b| b.taken_at.cmp(&a.taken_at).then_with(|| b.file_name.cmp(&a.file_name)));
        out
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))
}

fn thumb_limit() -> &'static Semaphore {
    static S: OnceLock<Semaphore> = OnceLock::new();
    S.get_or_init(|| Semaphore::new(4))
}

/// Vorschaubild (JPEG, max. 480×360) erzeugen bzw. aus dem Cache holen. Gibt den Dateipfad zurück.
#[tauri::command]
pub async fn screenshot_thumb(state: State<'_, AppState>, path: String) -> AppResult<String> {
    let src = checked(&state, &path)?;
    let meta = std::fs::metadata(&src)?;
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let mut h = Sha1::new();
    h.update(src.to_string_lossy().as_bytes());
    h.update(mtime.to_le_bytes());
    h.update(meta.len().to_le_bytes());
    let dir = state.paths.cache().join("thumbs");
    let out = dir.join(format!("{}.jpg", hex::encode(h.finalize())));
    if out.exists() {
        return Ok(out.to_string_lossy().to_string());
    }
    let _permit = thumb_limit().acquire().await.map_err(|e| AppError::msg(e.to_string()))?;
    if out.exists() {
        return Ok(out.to_string_lossy().to_string());
    }
    let out2 = out.clone();
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        std::fs::create_dir_all(&dir)?;
        let img = image::open(&src).map_err(|e| AppError::msg(format!("Bild nicht lesbar: {e}")))?;
        let thumb = img.thumbnail(THUMB_W, THUMB_H).to_rgb8();
        let tmp = out2.with_extension("tmp");
        {
            let f = std::fs::File::create(&tmp)?;
            let mut w = std::io::BufWriter::new(f);
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut w, 82)
                .encode_image(&thumb)
                .map_err(|e| AppError::msg(format!("Vorschau nicht speicherbar: {e}")))?;
        }
        std::fs::rename(&tmp, &out2)?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))??;
    Ok(out.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn screenshot_delete(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let p = checked(&state, &path)?;
    tokio::fs::remove_file(&p).await?;
    Ok(())
}

/// Bild in die Zwischenablage kopieren.
#[tauri::command]
pub async fn screenshot_copy(app: tauri::AppHandle, state: State<'_, AppState>, path: String) -> AppResult<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let p = checked(&state, &path)?;
    let (rgba, w, h) = tokio::task::spawn_blocking(move || -> AppResult<(Vec<u8>, u32, u32)> {
        let img = image::open(&p).map_err(|e| AppError::msg(format!("Bild nicht lesbar: {e}")))?.to_rgba8();
        let (w, h) = img.dimensions();
        Ok((img.into_raw(), w, h))
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))??;
    app.clipboard()
        .write_image(&tauri::image::Image::new_owned(rgba, w, h))
        .map_err(|e| AppError::msg(format!("Zwischenablage: {e}")))
}

/// Datei im Explorer markieren (Windows) bzw. den Ordner öffnen.
#[tauri::command]
pub async fn screenshot_open_folder(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let p = checked(&state, &path)?;
    #[cfg(windows)]
    {
        // Explorer versteht keine `\\?\`-Pfade
        let s = p.to_string_lossy();
        let s = s.strip_prefix(r"\\?\").unwrap_or(&s);
        let arg = format!("/select,{s}");
        std::process::Command::new("explorer").arg(arg).spawn()?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        crate::util::open_in_explorer(p.parent().unwrap_or(&p))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minecraft_names() {
        assert!(time_from_name("2024-05-01_12.34.56.png").is_some());
        assert!(time_from_name("2024-05-01_12.34.56_2.png").is_some());
        assert!(time_from_name("bild.png").is_none());
    }
}
