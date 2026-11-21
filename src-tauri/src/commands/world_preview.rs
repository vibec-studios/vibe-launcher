use crate::content::world_preview::{self, Center, MapPreview, WorldInfo, MAX_PNG, SIDE};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageDecoder};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

static RENDER_LIMIT: Semaphore = Semaphore::const_new(1);
static RENDERS: LazyLock<Mutex<HashMap<Uuid, CancellationToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

struct RenderJob(Uuid);

impl Drop for RenderJob {
    fn drop(&mut self) {
        if let Some(token) = RENDERS.lock().remove(&self.0) {
            token.cancel();
        }
    }
}

fn saves(state: &AppState, instance_id: &str) -> AppResult<PathBuf> {
    state.instances.get(instance_id)?;
    Ok(state.paths.game_dir(instance_id).join("saves"))
}

#[tauri::command]
pub async fn world_preview_info(
    state: State<'_, AppState>,
    instance_id: String,
    folder: String,
) -> AppResult<WorldInfo> {
    let saves = saves(&state, &instance_id)?;
    tokio::task::spawn_blocking(move || {
        world_preview::read_info(&world_preview::world_dir(&saves, &folder)?)
    })
    .await?
}

#[tauri::command]
pub async fn world_preview_render(
    state: State<'_, AppState>,
    instance_id: String,
    folder: String,
    center: Center,
    dimension: Option<String>,
    ready: Channel<String>,
) -> AppResult<Option<MapPreview>> {
    let saves = saves(&state, &instance_id)?;
    let cache = state.paths.cache();
    let job = RenderJob(Uuid::new_v4());
    let token = CancellationToken::new();
    RENDERS.lock().insert(job.0, token.clone());
    ready.send(job.0.to_string())?;
    let permit = tokio::select! {
        _ = token.cancelled() => return Err(AppError::Cancelled),
        result = RENDER_LIMIT.acquire() => result.map_err(|_| AppError::Cancelled)?,
    };
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        world_preview::render(
            &world_preview::world_dir(&saves, &folder)?,
            &cache,
            center,
            dimension.as_deref(),
            &token,
        )
    })
    .await?
}

#[tauri::command]
pub fn world_preview_cancel(id: Uuid) {
    if let Some(token) = RENDERS.lock().get(&id) {
        token.cancel();
    }
}

fn png_bytes(png: &str) -> AppResult<Vec<u8>> {
    let invalid = || AppError::Invalid("Kartenbild".into());
    if png.len() > MAX_PNG.div_ceil(3) * 4 {
        return Err(invalid());
    }
    let bytes = STANDARD.decode(png).map_err(|_| invalid())?;
    if bytes.len() > MAX_PNG {
        return Err(invalid());
    }
    Ok(bytes)
}

fn png_image(bytes: &[u8]) -> AppResult<DynamicImage> {
    let invalid = || AppError::Invalid("Kartenbild".into());
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(SIDE);
    limits.max_image_height = Some(SIDE);
    limits.max_alloc = Some(4 * 1024 * 1024);
    let decoder = image::codecs::png::PngDecoder::with_limits(Cursor::new(bytes), limits)
        .map_err(|_| invalid())?;
    if decoder.dimensions() != (SIDE, SIDE) {
        return Err(invalid());
    }
    DynamicImage::from_decoder(decoder).map_err(|_| invalid())
}

#[tauri::command]
pub async fn world_preview_copy(app: AppHandle, png: String) -> AppResult<()> {
    let rgba = tokio::task::spawn_blocking(move || {
        Ok::<_, AppError>(png_image(&png_bytes(&png)?)?.into_rgba8())
    })
    .await??;
    app.clipboard()
        .write_image(&tauri::image::Image::new_owned(rgba.into_raw(), SIDE, SIDE))
        .map_err(|e| AppError::msg(e.to_string()))
}

#[tauri::command]
pub async fn world_preview_export(path: PathBuf, png: String) -> AppResult<()> {
    tokio::task::spawn_blocking(move || export(&path, &png)).await?
}

fn export(path: &Path, png: &str) -> AppResult<()> {
    let invalid = || AppError::Invalid("PNG-Pfad außerhalb eines Weltordners".into());
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(invalid)?;
    if !path.is_absolute()
        || name.contains(':')
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("png"))
    {
        return Err(invalid());
    }
    let parent = path.parent().ok_or_else(invalid)?.canonicalize()?;
    if !world_preview::outside_worlds(&parent) {
        return Err(invalid());
    }
    let path = parent.join(name);
    let bytes = png_bytes(png)?;
    png_image(&bytes)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)?;
    if let Err(error) = file.write_all(&bytes) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageEncoder;

    #[test]
    fn world_preview_export_writes_png_outside_world_without_replacing_files() {
        let temp =
            std::env::temp_dir().join(format!("vibe-world-preview-export-{}", Uuid::new_v4()));
        let source = temp.join("fixture");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("level.dat"), [1, 2, 3]).unwrap();
        let world = temp.join("copy");
        fs::create_dir(&world).unwrap();
        fs::copy(source.join("level.dat"), world.join("level.dat")).unwrap();
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new(&mut bytes)
            .write_image(
                image::RgbaImage::new(SIDE, SIDE).as_raw(),
                SIDE,
                SIDE,
                image::ExtendedColorType::Rgba8,
            )
            .unwrap();
        let png = STANDARD.encode(&bytes);
        assert!(export(&world.join("map.png"), &png).is_err());
        assert!(!world.join("map.png").exists());
        let destination = temp.join("map.png");
        export(&destination, &png).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), bytes);
        assert!(export(&destination, &png).is_err());
        assert_eq!(fs::read(&destination).unwrap(), bytes);
        assert_eq!(fs::read(world.join("level.dat")).unwrap(), [1, 2, 3]);
        let _ = fs::remove_dir_all(temp);
    }
}
