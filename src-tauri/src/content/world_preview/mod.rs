mod anvil;
mod colors;
mod info;
pub mod mods;

use crate::error::{AppError, AppResult};
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

pub use anvil::{render, MapPreview, MAX_PNG, SIDE};
pub use info::{read_info, Center, WorldInfo};

#[cfg(test)]
mod tests;

pub fn world_dir(saves: &Path, folder: &str) -> AppResult<PathBuf> {
    let mut components = Path::new(folder).components();
    if folder.contains(['/', '\\', ':'])
        || !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
    {
        return Err(AppError::Invalid("Weltordner".into()));
    }
    let saves = saves.canonicalize()?;
    let world = contained(&saves, &saves.join(folder))?;
    if !world.is_dir() {
        return Err(AppError::NotFound("Weltordner".into()));
    }
    Ok(world)
}

fn contained(root: &Path, path: &Path) -> io::Result<PathBuf> {
    let path = path.canonicalize()?;
    if path.starts_with(root) {
        Ok(path)
    } else {
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Pfad außerhalb des Weltordners",
        ))
    }
}

fn read_limited(reader: impl Read, limit: usize) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "Datei zu groß"));
    }
    Ok(bytes)
}

fn open_file(root: &Path, path: &Path) -> io::Result<File> {
    let path = contained(root, path)?;
    if !fs::metadata(&path)?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Keine reguläre Datei",
        ));
    }
    File::open(path)
}

pub fn outside_worlds(path: &Path) -> bool {
    path.ancestors().all(|dir| {
        !dir.file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("saves"))
            && !dir.join("level.dat").exists()
            && !dir.join("level.dat_old").exists()
    })
}
