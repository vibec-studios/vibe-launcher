use super::super::{contained, outside_worlds, read_limited};
use super::sources::Kind;
use super::{journeymap, xaero, Canvas};
use crate::error::{AppError, AppResult};
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ImageEncoder, Rgba, RgbaImage};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use tokio_util::sync::CancellationToken;

pub const LODS: [u32; 4] = [1, 2, 4, 8];
const MAX_REGION_FILE: u64 = 96 * 1024 * 1024;
const MAX_STREAM: usize = 64 * 1024 * 1024;
const MAX_TILE_PNG: usize = 2 * 1024 * 1024;
const RENDER_VERSION: &[u8] = b"world-map-tiles-v1";

pub struct TileRequest<'a> {
    pub cache: &'a Path,
    pub layer: &'a Path,
    pub kind: Kind,
    pub x: i32,
    pub z: i32,
    pub lod: u32,
}

pub fn region_file(kind: Kind, layer: &Path, x: i32, z: i32) -> Option<PathBuf> {
    let names = match kind {
        Kind::Xaero => vec![format!("{x}_{z}.zip"), format!("{x}_{z}.xaero")],
        Kind::Journeymap => vec![format!("{x},{z}.png")],
    };
    names
        .into_iter()
        .map(|name| layer.join(name))
        .find(|path| path.is_file())
}

pub fn render(request: &TileRequest, cancel: &CancellationToken) -> AppResult<Option<Vec<u8>>> {
    if !LODS.contains(&request.lod) {
        return Err(AppError::Invalid("Zoomstufe".into()));
    }
    let Some(file) = region_file(request.kind, request.layer, request.x, request.z) else {
        return Ok(None);
    };
    let file = contained(request.layer, &file)?;
    let meta = fs::symlink_metadata(&file)?;
    if !meta.is_file() || meta.len() > MAX_REGION_FILE {
        return Ok(None);
    }
    let mut stamp = Sha256::new();
    stamp.update(RENDER_VERSION);
    stamp.update(meta.len().to_be_bytes());
    if let Ok(time) = meta.modified() {
        stamp.update(format!("{time:?}").as_bytes());
    }
    let stamp = hex::encode(&stamp.finalize()[..12]);
    let dir = cache_dir(request.cache, request.layer).ok();
    let base = format!("{}_{}", request.x, request.z);
    let name = |lod: u32| format!("{base}-{lod}.png");
    let stamp_file = format!("{base}.stamp");
    if let Some(bytes) = dir.as_ref().and_then(|dir| {
        let current = read_limited(File::open(dir.join(&stamp_file)).ok()?, 64).ok()?;
        (current == stamp.as_bytes()).then_some(())?;
        read_cache(&dir.join(name(request.lod))).ok()
    }) {
        return Ok(Some(bytes));
    }
    check(cancel)?;
    let mut canvas = Canvas::new();
    let painted = match request.kind {
        Kind::Xaero => {
            let stream = read_region(&file)?;
            check(cancel)?;
            match xaero::decode(&stream, &mut canvas, &|| cancel.is_cancelled()) {
                xaero::Decoded::Image => true,
                xaero::Decoded::Cancelled => return Err(AppError::Cancelled),
                xaero::Decoded::Empty | xaero::Decoded::Unsupported { .. } => false,
            }
        }
        Kind::Journeymap => {
            let bytes = read_limited(File::open(&file)?, MAX_STREAM)?;
            journeymap::decode(&bytes, &mut canvas).unwrap_or(false)
        }
    };
    check(cancel)?;
    if !painted {
        return Ok(None);
    }
    canvas.shade();
    let mut wanted = None;
    let mut saved = dir.is_some();
    for lod in LODS {
        check(cancel)?;
        let bytes = encode(&downscale(&canvas.image, lod))?;
        if let Some(dir) = &dir {
            saved &= save_cache(dir, &name(lod), &bytes).is_ok();
        }
        if lod == request.lod {
            wanted = Some(bytes);
        }
    }
    if let (Some(dir), true) = (&dir, saved) {
        let _ = save_cache(dir, &stamp_file, stamp.as_bytes());
    }
    Ok(wanted)
}

fn check(cancel: &CancellationToken) -> AppResult<()> {
    if cancel.is_cancelled() {
        Err(AppError::Cancelled)
    } else {
        Ok(())
    }
}

fn read_region(path: &Path) -> AppResult<Vec<u8>> {
    if path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("xaero"))
    {
        return Ok(read_limited(File::open(path)?, MAX_STREAM)?);
    }
    let invalid = |_| AppError::Invalid("Xaero-Region".into());
    let mut archive = zip::ZipArchive::new(File::open(path)?).map_err(invalid)?;
    let index = archive.index_for_name("region.xaero").unwrap_or(0);
    if archive.is_empty() {
        return Ok(Vec::new());
    }
    let entry = archive.by_index(index).map_err(invalid)?;
    if entry.size() > MAX_STREAM as u64 {
        return Err(AppError::Invalid("Xaero-Region".into()));
    }
    Ok(read_limited(entry.take(MAX_STREAM as u64 + 1), MAX_STREAM)?)
}

pub fn downscale(image: &RgbaImage, lod: u32) -> RgbaImage {
    if lod == 1 {
        return image.clone();
    }
    let side = image.width() / lod;
    RgbaImage::from_fn(side, side, |x, z| {
        let mut sum = [0u32; 3];
        let mut count = 0u32;
        for dz in 0..lod {
            for dx in 0..lod {
                let pixel = image.get_pixel(x * lod + dx, z * lod + dz).0;
                if pixel[3] > 0 {
                    for i in 0..3 {
                        sum[i] += u32::from(pixel[i]);
                    }
                    count += 1;
                }
            }
        }
        if count == 0 {
            return Rgba([0, 0, 0, 0]);
        }
        let alpha = (255 * count / (lod * lod)).max(96) as u8;
        Rgba([
            (sum[0] / count) as u8,
            (sum[1] / count) as u8,
            (sum[2] / count) as u8,
            alpha,
        ])
    })
}

fn encode(image: &RgbaImage) -> AppResult<Vec<u8>> {
    let mut bytes = Vec::new();
    PngEncoder::new_with_quality(&mut bytes, CompressionType::Fast, FilterType::Adaptive)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| AppError::msg(e.to_string()))?;
    Ok(bytes)
}

fn cache_dir(root: &Path, layer: &Path) -> io::Result<PathBuf> {
    let key = hex::encode(&Sha256::digest(layer.as_os_str().as_encoded_bytes())[..16]);
    fs::create_dir_all(root)?;
    let root = root.canonicalize()?;
    let mut dir = root.clone();
    for name in ["world-map", key.as_str()] {
        if !outside_worlds(&dir) {
            return Err(io::ErrorKind::PermissionDenied.into());
        }
        dir = dir.join(name);
        match fs::create_dir(&dir) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e),
        }
        dir = contained(&root, &dir)?;
    }
    Ok(dir)
}

fn read_cache(path: &Path) -> io::Result<Vec<u8>> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let bytes = read_limited(File::open(path)?, MAX_TILE_PNG)?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(io::ErrorKind::InvalidData.into());
    }
    Ok(bytes)
}

fn save_cache(dir: &Path, name: &str, bytes: &[u8]) -> io::Result<()> {
    let path = dir.join(name);
    let tmp = dir.join(format!("{name}.{}.tmp", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
    let result = file.write_all(bytes);
    drop(file);
    if let Err(error) = result.and_then(|()| fs::rename(&tmp, &path)) {
        let _ = fs::remove_file(&tmp);
        return Err(error);
    }
    Ok(())
}
