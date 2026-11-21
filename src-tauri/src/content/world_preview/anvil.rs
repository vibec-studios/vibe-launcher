mod chunk;

use super::info::{read_position, Center, Position};
use super::{contained, open_file, outside_worlds, read_limited};
use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose::STANDARD, Engine};
use flate2::read::{GzDecoder, ZlibDecoder};
use image::{ImageEncoder, Rgba, RgbaImage};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use tokio_util::sync::CancellationToken;

const RADIUS: i32 = 128;
pub const SIDE: u32 = (RADIUS * 2 + 1) as u32;
pub const MAX_PNG: usize = 512 * 1024;
const MAX_CHUNK: usize = 8 * 1024 * 1024;
const SECTOR: u64 = 4096;

#[derive(Serialize)]
pub struct MapPreview {
    pub png: String,
    position: Position,
    radius: i32,
}

pub fn render(
    world: &Path,
    cache: &Path,
    center: Center,
    dimension: Option<&str>,
    cancel: &CancellationToken,
) -> AppResult<Option<MapPreview>> {
    check(cancel)?;
    let Some(mut position) = read_position(world, center)? else {
        return Ok(None);
    };
    let mut label = center.name().to_string();
    if let Some(dimension) = dimension {
        let Some(moved) = position.in_dimension(dimension) else {
            return Err(AppError::Invalid("Dimension".into()));
        };
        position = moved;
        label = format!("{label}-{}", dimension.rsplit(':').next().unwrap_or("dim"));
    }
    let Some(dir) = position.region(world) else {
        return Ok(None);
    };
    let left = position.x - RADIUS;
    let top = position.z - RADIUS;
    let chunks = || {
        let min_x = left.div_euclid(16);
        let max_x = (position.x + RADIUS).div_euclid(16);
        (top.div_euclid(16)..=(position.z + RADIUS).div_euclid(16))
            .flat_map(move |z| (min_x..=max_x).map(move |x| (x, z)))
    };
    let mut regions = BTreeMap::new();
    let mut revision = Sha256::new();
    revision.update(b"world-preview-v1");
    revision.update(position.dimension.as_bytes());
    revision.update(position.x.to_be_bytes());
    revision.update(position.z.to_be_bytes());
    for (x, z) in chunks() {
        check(cancel)?;
        let coord = (x.div_euclid(32), z.div_euclid(32));
        let region = regions.entry(coord).or_insert_with(|| {
            let path = dir.join(format!("r.{}.{}.mca", coord.0, coord.1));
            let region = Region::open(world, &path).ok()?;
            stamp(&mut revision, &region.file.metadata().ok()?);
            Some(region)
        });
        let Some(region) = region else { continue };
        let slot = Region::slot(x, z);
        let location = region.location(x, z);
        revision.update(&region.header[slot + 4096..slot + 4100]);
        revision.update(location);
        if location[3] == 1 {
            let meta = contained(world, &external(&dir, x, z)).and_then(fs::metadata);
            revision.update([u8::from(meta.is_ok())]);
            if let Ok(meta) = meta {
                stamp(&mut revision, &meta);
            }
        }
    }
    let key = hex::encode(revision.finalize());
    let world_key = hex::encode(Sha256::digest(world.as_os_str().as_encoded_bytes()));
    let cache_file = cache_path(cache, &world_key, &label, &key).ok();
    if let Some(bytes) = cache_file.as_ref().and_then(|p| read_cache(p).ok()) {
        check(cancel)?;
        return Ok(Some(preview(bytes, position)));
    }

    let mut image = RgbaImage::new(SIDE, SIDE);
    let mut heights = vec![None; SIDE as usize * SIDE as usize];
    let mut painted = false;
    for (x, z) in chunks() {
        check(cancel)?;
        let coord = (x.div_euclid(32), z.div_euclid(32));
        let Some(Some(region)) = regions.get_mut(&coord) else {
            continue;
        };
        let Ok(bytes) = region.chunk(world, &dir, x, z) else {
            continue;
        };
        let Some(chunk) = chunk::read(&bytes, &position.dimension) else {
            continue;
        };
        for dz in 0..16 {
            for dx in 0..16 {
                let px = (x * 16 + dx - left) as u32;
                let pz = (z * 16 + dz - top) as u32;
                if px >= SIDE || pz >= SIDE {
                    continue;
                }
                if let Some((y, [r, g, b])) = chunk.surface(dx as usize, dz as usize) {
                    image.put_pixel(px, pz, Rgba([r, g, b, 255]));
                    heights[(pz * SIDE + px) as usize] = Some(y);
                    painted = true;
                }
            }
        }
    }
    check(cancel)?;
    if !painted {
        return Ok(None);
    }
    shade(&mut image, &heights);
    let mut bytes = Vec::new();
    image::codecs::png::PngEncoder::new(&mut bytes)
        .write_image(image.as_raw(), SIDE, SIDE, image::ExtendedColorType::Rgba8)
        .map_err(|e| AppError::msg(e.to_string()))?;
    check(cancel)?;
    if let Some(path) = cache_file {
        let _ = save_cache(&path, &bytes, &label);
    }
    Ok(Some(preview(bytes, position)))
}

fn check(cancel: &CancellationToken) -> AppResult<()> {
    if cancel.is_cancelled() {
        Err(AppError::Cancelled)
    } else {
        Ok(())
    }
}

fn preview(bytes: Vec<u8>, position: Position) -> MapPreview {
    MapPreview {
        png: STANDARD.encode(bytes),
        position,
        radius: RADIUS,
    }
}

fn shade(image: &mut RgbaImage, heights: &[Option<i32>]) {
    for (x, z, pixel) in image.enumerate_pixels_mut() {
        let index = |x, z| (z * SIDE + x) as usize;
        let Some(y) = heights[index(x, z)] else {
            continue;
        };
        let north = heights[index(x, z.saturating_sub(1))].unwrap_or(y);
        let west = heights[index(x.saturating_sub(1), z)].unwrap_or(y);
        let light = 100 + (y - north).clamp(-5, 5) * 4 + (y - west).clamp(-5, 5) * 2;
        for channel in &mut pixel.0[..3] {
            *channel = (i32::from(*channel) * light / 100).min(255) as u8;
        }
    }
}

fn stamp(hash: &mut Sha256, meta: &Metadata) {
    hash.update(meta.len().to_be_bytes());
    if let Ok(time) = meta.modified() {
        hash.update(format!("{time:?}").as_bytes());
    }
}

fn cache_path(root: &Path, world: &str, label: &str, key: &str) -> io::Result<PathBuf> {
    let root = root.canonicalize()?;
    let mut dir = root.clone();
    for name in ["world-preview", world] {
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
    if !outside_worlds(&dir) {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    Ok(dir.join(format!("{label}--{key}.png")))
}

fn read_cache(path: &Path) -> io::Result<Vec<u8>> {
    if !fs::symlink_metadata(path)?.file_type().is_file() {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let bytes = read_limited(File::open(path)?, MAX_PNG)?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(io::ErrorKind::InvalidData.into());
    }
    Ok(bytes)
}

fn save_cache(path: &Path, bytes: &[u8], label: &str) -> io::Result<()> {
    let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
    let result = file.write_all(bytes);
    drop(file);
    if let Err(error) = result.and_then(|()| fs::rename(&tmp, path)) {
        let _ = fs::remove_file(&tmp);
        return Err(error);
    }
    let prefix = format!("{label}--");
    if let Some(parent) = path.parent() {
        for old in fs::read_dir(parent)?.flatten() {
            if old.path() != path
                && old
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.starts_with(&prefix) && name.ends_with(".png"))
            {
                let _ = fs::remove_file(old.path());
            }
        }
    }
    Ok(())
}

fn external(dir: &Path, x: i32, z: i32) -> PathBuf {
    dir.join(format!("c.{x}.{z}.mcc"))
}

struct Region {
    file: File,
    len: u64,
    header: [u8; 8192],
}

impl Region {
    fn open(world: &Path, path: &Path) -> io::Result<Self> {
        let mut file = open_file(world, path)?;
        let len = file.metadata()?.len();
        let mut header = [0; 8192];
        file.read_exact(&mut header)?;
        Ok(Self { file, len, header })
    }

    fn slot(x: i32, z: i32) -> usize {
        (x.rem_euclid(32) as usize + z.rem_euclid(32) as usize * 32) * 4
    }

    fn location(&self, x: i32, z: i32) -> &[u8] {
        let slot = Self::slot(x, z);
        &self.header[slot..slot + 4]
    }

    fn chunk(&mut self, world: &Path, dir: &Path, x: i32, z: i32) -> io::Result<Vec<u8>> {
        let invalid = || io::Error::from(io::ErrorKind::InvalidData);
        let loc = self.location(x, z);
        let offset = u64::from(u32::from_be_bytes([0, loc[0], loc[1], loc[2]])) * SECTOR;
        let capacity = u64::from(loc[3]) * SECTOR;
        if offset < 2 * SECTOR || capacity == 0 || offset + 5 > self.len {
            return Err(invalid());
        }
        self.file.seek(SeekFrom::Start(offset))?;
        let mut header = [0; 5];
        self.file.read_exact(&mut header)?;
        let size = u64::from(u32::from_be_bytes(header[..4].try_into().unwrap()));
        if size == 0 || size + 4 > capacity || offset + 4 + size > self.len {
            return Err(invalid());
        }
        let codec = header[4] & 0x7f;
        if header[4] & 0x80 != 0 {
            return decode(
                codec,
                open_file(world, &external(dir, x, z))?.take(MAX_CHUNK as u64 + 1),
            );
        }
        decode(codec, (&mut self.file).take(size - 1))
    }
}

fn decode(codec: u8, reader: impl Read) -> io::Result<Vec<u8>> {
    match codec {
        1 => read_limited(GzDecoder::new(reader), MAX_CHUNK),
        2 => read_limited(ZlibDecoder::new(reader), MAX_CHUNK),
        3 => read_limited(reader, MAX_CHUNK),
        _ => Err(io::ErrorKind::Unsupported.into()),
    }
}
