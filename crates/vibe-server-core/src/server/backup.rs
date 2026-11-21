//! Welten eines Servers und ZIP-Backups (`backups/`).
use super::server_dir;
use crate::error::{AppError, AppResult};
use crate::Core;
use crate::tasks::SubProgress;
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct ServerWorld {
    pub name: String,
    pub size: u64,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerBackup {
    pub name: String,
    pub world: String,
    pub size: u64,
    pub created: i64,
}

fn dir_size(p: &Path) -> u64 {
    walkdir::WalkDir::new(p).into_iter().flatten().filter_map(|e| e.metadata().ok()).filter(|m| m.is_file()).map(|m| m.len()).sum()
}

pub fn level_name(dir: &Path) -> String {
    super::props::get(&dir.join("server.properties"), "level-name").filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "world".into())
}

pub fn worlds(state: &Core, id: &str) -> Vec<ServerWorld> {
    let dir = server_dir(&state.paths, id);
    let active = level_name(&dir);
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() && p.join("level.dat").is_file() {
                let name = e.file_name().to_string_lossy().to_string();
                out.push(ServerWorld { size: dir_size(&p), active: name == active, name });
            }
        }
    }
    out.sort_by(|a, b| b.active.cmp(&a.active).then(a.name.cmp(&b.name)));
    out
}

pub fn backups_dir(state: &Core, id: &str) -> PathBuf {
    server_dir(&state.paths, id).join("backups")
}

pub fn list(state: &Core, id: &str) -> Vec<ServerBackup> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(backups_dir(state, id)) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.to_ascii_lowercase().ends_with(".zip") {
                continue;
            }
            let Ok(m) = e.metadata() else { continue };
            let created = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
            // "<welt>_2026-11-17_18-00-00.zip"
            let world = name.rsplitn(3, '_').nth(2).unwrap_or(&name).trim_end_matches(".zip").to_string();
            out.push(ServerBackup { name, world, size: m.len(), created });
        }
    }
    out.sort_by_key(|b| std::cmp::Reverse(b.created));
    out
}

fn zip_dir(src: &Path, dest: &Path, prefix: &str, sp: &SubProgress) -> AppResult<()> {
    let files: Vec<walkdir::DirEntry> = walkdir::WalkDir::new(src).into_iter().flatten().filter(|e| e.file_type().is_file()).collect();
    let total = files.len().max(1);
    let tmp = dest.with_extension("zip.part");
    let f = std::fs::File::create(&tmp)?;
    let mut z = zip::ZipWriter::new(std::io::BufWriter::new(f));
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
    for (i, e) in files.iter().enumerate() {
        let rel = e.path().strip_prefix(src).map_err(|e| AppError::msg(e.to_string()))?;
        let name = format!("{prefix}/{}", rel.to_string_lossy().replace('\\', "/"));
        if name.ends_with("session.lock") {
            continue;
        }
        z.start_file(name, opts)?;
        let mut r = match std::fs::File::open(e.path()) {
            Ok(r) => r,
            Err(err) => {
                tracing::warn!("Backup: {} übersprungen: {err}", e.path().display());
                continue;
            }
        };
        std::io::copy(&mut r, &mut z)?;
        if i % 50 == 0 {
            sp.progress(i as f64 / total as f64);
            if sp.task.is_cancelled() {
                drop(z);
                let _ = std::fs::remove_file(&tmp);
                return Err(AppError::Cancelled);
            }
        }
    }
    z.finish()?.flush()?;
    std::fs::rename(&tmp, dest)?;
    Ok(())
}

pub async fn create(state: &Core, id: &str, world: Option<String>, sp: &SubProgress) -> AppResult<()> {
    let dir = server_dir(&state.paths, id);
    let world = world.filter(|w| !w.trim().is_empty()).unwrap_or_else(|| level_name(&dir));
    let src = crate::util::safe_join(&dir, &world).ok_or_else(|| AppError::Invalid("Ungültiger Weltname".into()))?;
    if !src.is_dir() {
        return Err(AppError::Invalid(format!("Die Welt „{world}“ gibt es noch nicht (Server einmal starten).")));
    }
    let running = state.server_mgr.status(id).is_some_and(|s| s.state == super::run::RunState::Running && !s.detached);
    if running {
        sp.message("Welt wird gespeichert …");
        let _ = state.server_mgr.command(id, "save-off");
        let _ = state.server_mgr.command(id, "save-all flush");
        tokio::time::sleep(Duration::from_secs(4)).await;
    }
    sp.message(format!("Backup von „{world}“ wird erstellt …"));
    let bdir = backups_dir(state, id);
    std::fs::create_dir_all(&bdir)?;
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let dest = bdir.join(format!("{}_{stamp}.zip", crate::paths::sanitize_file_name(&world)));
    let sp2 = sp.clone();
    let w2 = world.clone();
    let res = tokio::task::spawn_blocking(move || zip_dir(&src, &dest, &w2, &sp2)).await;
    if running {
        let _ = state.server_mgr.command(id, "save-on");
    }
    res??;
    Ok(())
}

pub fn delete(state: &Core, id: &str, name: &str) -> AppResult<()> {
    let p = crate::util::safe_join(&backups_dir(state, id), name).ok_or_else(|| AppError::Invalid("Ungültiger Name".into()))?;
    std::fs::remove_file(p)?;
    Ok(())
}

pub async fn restore(state: &Core, id: &str, name: &str, sp: &SubProgress) -> AppResult<()> {
    if state.server_mgr.is_active(id) {
        return Err(AppError::Invalid("Bitte den Server vor dem Wiederherstellen stoppen.".into()));
    }
    let dir = server_dir(&state.paths, id);
    let zip_path = crate::util::safe_join(&backups_dir(state, id), name).ok_or_else(|| AppError::Invalid("Ungültiger Name".into()))?;
    let dir2 = dir.clone();
    let sp2 = sp.clone();
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        let f = std::fs::File::open(&zip_path)?;
        let mut z = zip::ZipArchive::new(f)?;
        // Oberster Ordner im ZIP = Weltname
        let world = z
            .file_names()
            .next()
            .and_then(|n| n.split('/').next())
            .map(str::to_string)
            .ok_or_else(|| AppError::msg("Backup ist leer"))?;
        let target = crate::util::safe_join(&dir2, &world).ok_or_else(|| AppError::msg("Ungültiges Backup"))?;
        if target.exists() {
            // aktuelle Welt sichern statt löschen
            let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
            let keep = dir2.join("backups").join("ersetzt").join(format!("{world}_{stamp}"));
            std::fs::create_dir_all(keep.parent().unwrap_or(&dir2))?;
            std::fs::rename(&target, &keep)?;
        }
        let n = z.len().max(1);
        for i in 0..z.len() {
            let mut e = z.by_index(i)?;
            let Some(out) = crate::util::safe_join(&dir2, e.name()) else { continue };
            if e.is_dir() {
                std::fs::create_dir_all(&out)?;
                continue;
            }
            if let Some(p) = out.parent() {
                std::fs::create_dir_all(p)?;
            }
            let mut w = std::fs::File::create(&out)?;
            std::io::copy(&mut e, &mut w)?;
            if i % 50 == 0 {
                sp2.progress(i as f64 / n as f64);
            }
        }
        Ok(())
    })
    .await??;
    Ok(())
}
