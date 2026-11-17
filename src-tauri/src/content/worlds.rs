//! Welten (`saves/*/level.dat`).
use super::{nbt, World};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use std::path::Path;

fn game_mode(data: &nbt::Tag) -> Option<String> {
    if data.get("hardcore").and_then(|v| v.as_i64()) == Some(1) {
        return Some("hardcore".into());
    }
    let gt = data.get("GameType").and_then(|v| v.as_i64())?;
    Some(
        match gt {
            0 => "survival",
            1 => "creative",
            2 => "adventure",
            3 => "spectator",
            _ => return None,
        }
        .into(),
    )
}

/// Eine Welt lesen (blockierend). `None`, wenn der Ordner keine Welt ist.
pub fn read_world(dir: &Path) -> Option<World> {
    let folder = dir.file_name()?.to_string_lossy().to_string();
    let level = dir.join("level.dat");
    let bytes = std::fs::read(&level).or_else(|_| std::fs::read(dir.join("level.dat_old"))).ok()?;
    let (name, last_played, mode) = match nbt::parse_maybe_gzip(&bytes) {
        Ok(root) => {
            let data = root.get("Data").cloned().unwrap_or(root);
            (
                data.get("LevelName").and_then(|v| v.as_str()).map(str::to_string).filter(|s| !s.trim().is_empty()),
                data.get("LastPlayed").and_then(|v| v.as_i64()).filter(|v| *v > 0),
                game_mode(&data),
            )
        }
        Err(e) => {
            tracing::warn!("level.dat in {folder} unlesbar: {e}");
            (None, None, None)
        }
    };
    let last_played = last_played.or_else(|| {
        std::fs::metadata(&level).ok()?.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
    });
    let icon = std::fs::read(dir.join("icon.png")).ok().filter(|b| b.len() <= 1024 * 1024).and_then(|b| super::meta::data_url(&b));
    let size = walkdir::WalkDir::new(dir).into_iter().flatten().filter(|e| e.file_type().is_file()).filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum();
    Some(World { name: name.unwrap_or_else(|| folder.clone()), folder, last_played, game_mode: mode, icon, size: Some(size) })
}

pub async fn list(state: &AppState, instance_id: &str) -> AppResult<Vec<World>> {
    state.instances.get(instance_id)?;
    let saves = state.paths.game_dir(instance_id).join("saves");
    tokio::task::spawn_blocking(move || {
        let Ok(rd) = std::fs::read_dir(&saves) else { return Ok(vec![]) };
        let dirs: Vec<_> = rd.flatten().filter(|e| e.path().is_dir()).map(|e| e.path()).collect();
        let mut worlds: Vec<World> = std::thread::scope(|s| {
            let handles: Vec<_> = dirs.chunks(dirs.len().div_ceil(8).max(1)).map(|c| s.spawn(move || c.iter().filter_map(|d| read_world(d)).collect::<Vec<_>>())).collect();
            handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
        });
        worlds.sort_by(|a, b| b.last_played.unwrap_or(0).cmp(&a.last_played.unwrap_or(0)).then(a.name.cmp(&b.name)));
        Ok(worlds)
    })
    .await?
}

pub async fn delete(state: &AppState, instance_id: &str, folder: &str) -> AppResult<()> {
    state.instances.get(instance_id)?;
    if folder.is_empty() || folder.contains(['/', '\\', ':']) || folder == "." || folder == ".." {
        return Err(AppError::Invalid(format!("Ungültiger Weltordner: {folder}")));
    }
    let dir = state.paths.game_dir(instance_id).join("saves").join(folder);
    if !dir.join("level.dat").exists() && !dir.is_dir() {
        return Err(AppError::NotFound(format!("Welt {folder}")));
    }
    tokio::fs::remove_dir_all(&dir).await.map_err(|e| AppError::msg(format!("Welt konnte nicht gelöscht werden (läuft das Spiel noch?): {e}")))?;
    state.content.emit_changed(instance_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::nbt::writer::W;
    use super::*;
    use std::io::Write;

    #[test]
    fn world_from_gzip_level_dat() {
        let dir = std::env::temp_dir().join(format!("vl-world-{}", uuid::Uuid::new_v4())).join("Neue Welt");
        std::fs::create_dir_all(&dir).unwrap();
        let mut w = W::new();
        w.begin("").begin("Data").string("LevelName", "Test").long("LastPlayed", 1234).int("GameType", 0).byte("hardcore", 1).end().end();
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gz.write_all(&w.0).unwrap();
        std::fs::write(dir.join("level.dat"), gz.finish().unwrap()).unwrap();
        let world = read_world(&dir).unwrap();
        assert_eq!(world.name, "Test");
        assert_eq!(world.folder, "Neue Welt");
        assert_eq!(world.last_played, Some(1234));
        assert_eq!(world.game_mode.as_deref(), Some("hardcore"));
        assert!(world.size.unwrap() > 0);
        std::fs::remove_dir_all(dir.parent().unwrap()).ok();
    }
}
