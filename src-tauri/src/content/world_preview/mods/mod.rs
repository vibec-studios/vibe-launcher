mod journeymap;
mod names;
mod sources;
mod stream;
mod tiles;
mod tint;
mod waypoints;
mod xaero;

#[cfg(test)]
mod tests;

use super::colors::Color;
use super::{contained, read_limited};
use crate::error::{AppError, AppResult};
use image::{Rgba, RgbaImage};
use serde::Serialize;
use std::collections::HashSet;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tokio_util::sync::CancellationToken;

pub use sources::{list as list_sources, MapSource};
pub use tiles::LODS;
pub use waypoints::Waypoint;

pub const REGION: u32 = 512;
const MAX_REGIONS: usize = 40_000;
const MAX_WAYPOINT_FILE: usize = 2 * 1024 * 1024;
const MAX_WAYPOINT_FILES: usize = 32;

pub struct Canvas {
    image: RgbaImage,
    heights: Vec<Option<i32>>,
    painted: bool,
}

impl Canvas {
    fn new() -> Self {
        Self {
            image: RgbaImage::new(REGION, REGION),
            heights: Vec::new(),
            painted: false,
        }
    }

    fn put(&mut self, x: u32, z: u32, color: Color, height: i32) {
        if x >= REGION || z >= REGION {
            return;
        }
        if self.heights.is_empty() {
            self.heights = vec![None; (REGION * REGION) as usize];
        }
        self.image
            .put_pixel(x, z, Rgba([color[0], color[1], color[2], 255]));
        self.heights[(z * REGION + x) as usize] = Some(height);
        self.painted = true;
    }

    fn shade(&mut self) {
        if self.heights.is_empty() {
            return;
        }
        let heights = &self.heights;
        let index = |x: u32, z: u32| (z * REGION + x) as usize;
        for (x, z, pixel) in self.image.enumerate_pixels_mut() {
            let Some(y) = heights[index(x, z)] else {
                continue;
            };
            let north = heights[index(x, z.saturating_sub(1))].unwrap_or(y);
            let west = heights[index(x.saturating_sub(1), z)].unwrap_or(y);
            let light = 100 + (y - north).clamp(-5, 5) * 4 + (y - west).clamp(-5, 5) * 2;
            for channel in &mut pixel.0[..3] {
                *channel = (i32::from(*channel) * light / 100).clamp(0, 255) as u8;
            }
        }
    }
}

#[derive(Serialize)]
pub struct Overview {
    pub layer: String,
    pub cave: bool,
    pub regions: Vec<[i32; 2]>,
    pub truncated: bool,
    pub latest: Option<[i32; 2]>,
    pub waypoints: Vec<Waypoint>,
}

struct Scan {
    regions: Vec<[i32; 2]>,
    truncated: bool,
    latest: Option<(SystemTime, [i32; 2])>,
}

fn scan(kind: sources::Kind, dir: &Path) -> Scan {
    let mut out = Scan {
        regions: Vec::new(),
        truncated: false,
        latest: None,
    };
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let region = match kind {
            sources::Kind::Xaero => names::xaero_region(name),
            sources::Kind::Journeymap => names::journeymap_region(name),
        };
        let Some((x, z)) = region else { continue };
        if out.regions.len() >= MAX_REGIONS {
            out.truncated = true;
            break;
        }
        out.regions.push([x, z]);
        if let Ok(time) = entry.metadata().and_then(|meta| meta.modified()) {
            if out.latest.is_none_or(|(latest, _)| time > latest) {
                out.latest = Some((time, [x, z]));
            }
        }
    }
    out.regions.sort_unstable();
    out.regions.dedup();
    out
}

fn subdirs(dir: &Path) -> Vec<(String, PathBuf)> {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .take(512)
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|entry| Some((entry.file_name().to_str()?.to_string(), entry.path())))
        .filter(|(name, _)| sources::single(name))
        .collect()
}

fn best(candidates: Vec<(Vec<String>, Scan, i32)>) -> Option<(Vec<String>, Scan)> {
    candidates
        .into_iter()
        .filter(|(_, scan, _)| !scan.regions.is_empty())
        .max_by_key(|(_, scan, rank)| {
            (*rank, scan.latest.map(|(time, _)| time), scan.regions.len())
        })
        .map(|(path, scan, _)| (path, scan))
}

fn xaero_layer(dir: &Path, dimension: &str) -> Option<(Vec<String>, Scan, bool)> {
    let mut candidates = Vec::new();
    let mut caves = Vec::new();
    for folder in names::xaero_folders(dimension) {
        let dim_dir = dir.join(&folder);
        if !dim_dir.is_dir() {
            continue;
        }
        candidates.push((
            vec![folder.clone()],
            scan(sources::Kind::Xaero, &dim_dir),
            0,
        ));
        for (mw, mw_dir) in subdirs(&dim_dir) {
            if !names::is_multiworld(&mw) {
                continue;
            }
            let path = vec![folder.clone(), mw.clone()];
            candidates.push((path.clone(), scan(sources::Kind::Xaero, &mw_dir), 1));
            for (layer, layer_dir) in subdirs(&mw_dir.join("caves")) {
                if layer.parse::<i32>().is_err() {
                    continue;
                }
                let mut path = path.clone();
                path.extend(["caves".to_string(), layer]);
                caves.push((path, scan(sources::Kind::Xaero, &layer_dir), 0));
            }
        }
    }
    if let Some((path, scan)) = best(candidates) {
        return Some((path, scan, false));
    }
    let (path, scan) = caves
        .into_iter()
        .filter(|(_, scan, _)| !scan.regions.is_empty())
        .max_by_key(|(_, scan, _)| scan.regions.len())
        .map(|(path, scan, _)| (path, scan))?;
    Some((path, scan, true))
}

fn journeymap_layer(dir: &Path, dimension: &str) -> Option<(Vec<String>, Scan, bool)> {
    let mut candidates = Vec::new();
    for folder in names::journeymap_folders(dimension) {
        let dim_dir = dir.join(&folder);
        if !dim_dir.is_dir() {
            continue;
        }
        for (layer, layer_dir) in subdirs(&dim_dir) {
            let Some(rank) = names::layer_rank(&layer) else {
                continue;
            };
            let scan = scan(sources::Kind::Journeymap, &layer_dir);
            let rank = rank * 100_000
                + if rank == 0 {
                    scan.regions.len() as i32
                } else {
                    0
                };
            candidates.push((vec![folder.clone(), layer], scan, rank));
        }
    }
    let cave = candidates
        .iter()
        .filter(|(_, scan, _)| !scan.regions.is_empty())
        .max_by_key(|(_, _, rank)| *rank)
        .is_some_and(|(_, _, rank)| *rank < 100_000);
    let (path, scan) = best(candidates)?;
    Some((path, scan, cave))
}

pub fn overview(game: &Path, source: &str, dimension: &str) -> AppResult<Option<Overview>> {
    let location = sources::resolve(game, source)?;
    let layer = match location.kind {
        sources::Kind::Xaero => xaero_layer(&location.dir, dimension),
        sources::Kind::Journeymap => journeymap_layer(&location.dir, dimension),
    };
    let Some((path, scan, cave)) = layer else {
        return Ok(None);
    };
    let waypoints = if location.kind == sources::Kind::Xaero {
        let multiworld = path.get(1).filter(|name| names::is_multiworld(name));
        world_waypoints(
            game,
            &location.world,
            dimension,
            multiworld.map(String::as_str),
        )
    } else {
        Vec::new()
    };
    Ok(Some(Overview {
        layer: path.join("/"),
        cave,
        regions: scan.regions,
        truncated: scan.truncated,
        latest: scan.latest.map(|(_, region)| region),
        waypoints,
    }))
}

fn layer_dir(base: &Path, layer: &str) -> AppResult<PathBuf> {
    let parts: Vec<&str> = layer.split('/').collect();
    if parts.is_empty() || parts.len() > 6 || !parts.iter().all(|part| sources::single(part)) {
        return Err(AppError::Invalid("Kartenebene".into()));
    }
    let dir = contained(
        base,
        &parts
            .iter()
            .fold(base.to_path_buf(), |dir, part| dir.join(part)),
    )?;
    if !dir.is_dir() {
        return Err(AppError::NotFound("Kartenebene".into()));
    }
    Ok(dir)
}

pub struct TileQuery<'a> {
    pub game: &'a Path,
    pub cache: &'a Path,
    pub source: &'a str,
    pub layer: &'a str,
    pub x: i32,
    pub z: i32,
    pub lod: u32,
}

pub fn tile(query: &TileQuery, cancel: &CancellationToken) -> AppResult<Option<Vec<u8>>> {
    let location = sources::resolve(query.game, query.source)?;
    let layer = layer_dir(&location.dir, query.layer)?;
    tiles::render(
        &tiles::TileRequest {
            cache: query.cache,
            layer: &layer,
            kind: location.kind,
            x: query.x,
            z: query.z,
            lod: query.lod,
        },
        cancel,
    )
}

pub fn world_waypoints(
    game: &Path,
    world: &str,
    dimension: &str,
    multiworld: Option<&str>,
) -> Vec<Waypoint> {
    let Ok(game) = game.canonicalize() else {
        return Vec::new();
    };
    if !sources::single(world) {
        return Vec::new();
    }
    let mut files = Vec::new();
    for root in sources::MINIMAP_ROOTS {
        for folder in names::minimap_folders(dimension) {
            let Ok(dir) = contained(&game, &game.join(root).join(world).join(folder)) else {
                continue;
            };
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten().take(256) {
                if entry.file_type().is_ok_and(|t| t.is_file()) {
                    if let Some(name) = entry.file_name().to_str() {
                        files.push((name.to_string(), entry.path()));
                    }
                }
            }
        }
    }
    let preferred: Vec<&(String, PathBuf)> = files
        .iter()
        .filter(|(name, _)| waypoints::file_matches(name, multiworld))
        .collect();
    let chosen = if preferred.is_empty() {
        files
            .iter()
            .filter(|(name, _)| waypoints::file_matches(name, None))
            .collect()
    } else {
        preferred
    };
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for (_, path) in chosen.into_iter().take(MAX_WAYPOINT_FILES) {
        let Ok(path) = contained(&game, path) else {
            continue;
        };
        let Ok(bytes) = File::open(path).and_then(|file| read_limited(file, MAX_WAYPOINT_FILE))
        else {
            continue;
        };
        waypoints::parse(&String::from_utf8_lossy(&bytes), &mut out, &mut seen);
    }
    out
}
