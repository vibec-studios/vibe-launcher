use super::{sync_root, ConflictNote, InstanceState};
use crate::error::{AppError, AppResult};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};

pub const AREAS: [&str; 2] = ["hotbars", "command_history"];
const MAX_BYTES: u64 = 8 * 1024 * 1024;

fn paths(root: &Path, game: &Path, area: &str, mc: &str) -> (PathBuf, PathBuf) {
    let shared = sync_root(root).join("personal");
    if area == "hotbars" {
        let version = format!("{:x}", Sha256::digest(mc.as_bytes()));
        (game.join("hotbar.nbt"), shared.join("hotbars").join(version).join("hotbar.nbt"))
    } else {
        (game.join("command_history.txt"), shared.join("command_history.txt"))
    }
}

fn read(path: &Path) -> AppResult<Option<Vec<u8>>> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if !metadata.file_type().is_file() {
        return Err(AppError::Invalid("Keine reguläre Datei".into()));
    }
    let mut bytes = Vec::new();
    File::open(path)?.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(AppError::Invalid("Datei ist größer als 8 MB".into()));
    }
    Ok(Some(bytes))
}

fn write(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err(AppError::Invalid("Datei ist größer als 8 MB".into()));
    }
    let folder = path.parent().ok_or_else(|| AppError::Invalid("Ungültiger Dateipfad".into()))?;
    fs::create_dir_all(folder)?;
    let tmp = folder.join(format!(".sync-{}.tmp", uuid::Uuid::new_v4()));
    let result = fs::write(&tmp, bytes).and_then(|()| fs::rename(&tmp, path));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    Ok(result?)
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn capture(root: &Path, game: &Path, area: &str, mc: &str) -> AppResult<usize> {
    let (local, shared) = paths(root, game, area, mc);
    let Some(bytes) = read(&local)? else { return Ok(0) };
    let bytes = if area == "command_history" { merge_history(&[], &bytes, &[]) } else { bytes };
    write(&shared, &bytes)?;
    Ok(1)
}

fn merge_history(shared: &[u8], local: &[u8], baseline: &[String]) -> Vec<u8> {
    let shared = String::from_utf8_lossy(shared);
    let local = String::from_utf8_lossy(local);
    let recent: Vec<_> = local.lines().filter(|line| line.starts_with('/')).collect();
    let hashes: Vec<_> = recent.iter().take(baseline.len()).map(|line| digest(line.as_bytes())).collect();
    let unchanged = (0..=hashes.len()).rev().find(|&n| baseline.ends_with(&hashes[..n])).unwrap_or(0);
    let mut lines = Vec::new();
    for line in shared.lines().filter(|line| line.starts_with('/')).chain(recent.into_iter().skip(unchanged)) {
        if let Some(index) = lines.iter().position(|&other| other == line) {
            lines.remove(index);
        }
        lines.push(line);
        if lines.len() > 50 {
            lines.remove(0);
        }
    }
    if lines.is_empty() {
        Vec::new()
    } else {
        (lines.join("\n") + "\n").into_bytes()
    }
}

pub fn sync(
    root: &Path,
    game: &Path,
    area: &str,
    mc: &str,
    state: &mut InstanceState,
) -> AppResult<(usize, Option<ConflictNote>)> {
    let (local_path, shared_path) = paths(root, game, area, mc);
    let local = read(&local_path)?;
    let shared = read(&shared_path)?;
    let base = state.personal.get(area);
    let mut conflict = None;
    let merged = match (local.as_deref(), shared.as_deref()) {
        (None, None) => return Ok((0, None)),
        (local, shared) if area == "command_history" => {
            merge_history(shared.unwrap_or(&[]), local.unwrap_or(&[]), &state.command_history_base)
        }
        (Some(local), None) => local.to_vec(),
        (None, Some(shared)) => shared.to_vec(),
        (Some(local), Some(shared)) if local == shared => shared.to_vec(),
        (Some(local), Some(shared)) if base.is_some_and(|base| base == &digest(local)) => shared.to_vec(),
        (Some(local), Some(shared)) if base.is_some_and(|base| base == &digest(shared)) => local.to_vec(),
        (Some(local), Some(shared)) => {
            let renamed = format!("hotbar-backup-{}.nbt", digest(local));
            let backup = game.join(&renamed);
            if !backup.exists() {
                write(&backup, local)?;
            }
            conflict = Some(ConflictNote {
                at: crate::util::now_ms(),
                area: area.into(),
                name: "hotbar.nbt".into(),
                renamed,
            });
            shared.to_vec()
        }
    };
    let to_shared = shared.as_deref() != Some(&merged);
    let to_local = local.as_deref() != Some(&merged);
    if to_shared {
        write(&shared_path, &merged)?;
    }
    if to_local {
        write(&local_path, &merged)?;
    }
    state.personal.insert(area.into(), digest(&merged));
    if area == "command_history" {
        state.command_history_base = String::from_utf8_lossy(&merged).lines().map(|line| digest(line.as_bytes())).collect();
    }
    Ok((usize::from(to_shared) + usize::from(to_local), conflict))
}
