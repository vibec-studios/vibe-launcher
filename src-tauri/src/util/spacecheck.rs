use super::diskspace::{dir_size, ensure, GB, MB};
use crate::error::AppResult;
use crate::paths::Paths;
use std::path::{Path, PathBuf};

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> AppResult<T> {
    Ok(tokio::task::spawn_blocking(f).await?)
}

pub async fn for_launcher_import(paths: &Paths, source: &str) -> AppResult<()> {
    let dir = PathBuf::from(source.split('#').next().unwrap_or(source));
    if !dir.is_dir() {
        return Ok(());
    }
    let target = paths.instances();
    blocking(move || ensure(&target, dir_size(&dir) + 256 * MB, "die Übernahme")).await?
}

pub async fn for_pack_file(paths: &Paths, file: &Path) -> AppResult<()> {
    let size = std::fs::metadata(file).map(|m| m.len()).unwrap_or(0);
    let target = paths.instances();
    blocking(move || ensure(&target, size.saturating_mul(3) + 512 * MB, "den Import")).await?
}

pub async fn for_modpack(paths: &Paths) -> AppResult<()> {
    let target = paths.instances();
    blocking(move || ensure(&target, 2 * GB, "das Modpack")).await?
}

pub fn world_backup_needed(world: &Path) -> u64 {
    dir_size(world) + 64 * MB
}

pub async fn for_world_backup(paths: &Paths, world: PathBuf) -> AppResult<()> {
    let target = paths.root.clone();
    blocking(move || ensure(&target, world_backup_needed(&world), "das Welt-Backup")).await?
}
