//! Bedrock-Welten (`…/com.mojang/minecraftWorlds/<ordner>`): Liste, Export/Import `.mcworld`,
//! Sicherungen (`<daten>/backups/bedrock/<instanz>/<ordner>/<zeit>.mcworld` + `.json`).
use super::{packs, DataLoc};
use crate::content::worldbackup::WorldBackup;
use crate::error::{AppError, AppResult};
use crate::paths::Paths;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct BedrockWorld {
    /// Ordnername unter `minecraftWorlds`
    pub folder: String,
    pub name: String,
    pub icon: Option<String>,
    pub size: u64,
    /// Änderungszeit von `level.dat` (ms)
    pub last_played: Option<i64>,
    /// Spielerordner (GDK: ID unter `Users/`), mehrere Konten möglich
    pub user: String,
    /// Aktivierte Packs (UUIDs)
    pub resource_packs: Vec<String>,
    pub behavior_packs: Vec<String>,
}

fn mtime_ms(p: &Path) -> Option<i64> {
    std::fs::metadata(p).ok()?.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
}

fn user_of(slot: &str) -> String {
    slot.strip_prefix("Users/").and_then(|r| r.split('/').next()).unwrap_or("").to_string()
}

pub fn read_world(dir: &Path, user: &str, icons: bool) -> Option<BedrockWorld> {
    if !dir.join("level.dat").is_file() {
        return None;
    }
    let folder = dir.file_name()?.to_string_lossy().to_string();
    let name = std::fs::read_to_string(dir.join("levelname.txt"))
        .ok()
        .map(|s| super::manifest::strip_format(s.lines().next().unwrap_or("")))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| folder.clone());
    let icon = if icons { super::icon_data_url(&dir.join("world_icon.jpeg"), 160) } else { None };
    let ids = |k| packs::read_world_packs(dir, k).into_iter().map(|r| r.pack_id).collect();
    Some(BedrockWorld {
        name,
        icon,
        size: super::dir_size(dir),
        last_played: mtime_ms(&dir.join("level.dat")),
        user: user.to_string(),
        resource_packs: ids(super::manifest::PackKind::Resource),
        behavior_packs: ids(super::manifest::PackKind::Behavior),
        folder,
    })
}

pub fn list(loc: &DataLoc, icons: bool) -> Vec<BedrockWorld> {
    let mut out = Vec::new();
    for (slot, dir) in loc.world_dirs() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            if let Some(w) = read_world(&e.path(), &user_of(&slot), icons) {
                out.push(w);
            }
        }
    }
    out.sort_by(|a, b| b.last_played.cmp(&a.last_played).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    out
}

fn check_folder(folder: &str) -> AppResult<()> {
    if folder.is_empty() || folder.len() > 128 || folder.contains(['/', '\\', ':']) || folder == "." || folder == ".." || folder.starts_with(".vibe-") {
        return Err(AppError::Invalid(format!("Ungültiger Weltordner: {folder}")));
    }
    Ok(())
}

/// Ordner einer Welt finden.
pub fn find(loc: &DataLoc, folder: &str) -> AppResult<PathBuf> {
    check_folder(folder)?;
    for (_, dir) in loc.world_dirs() {
        let p = dir.join(folder);
        if p.join("level.dat").is_file() {
            return Ok(p);
        }
    }
    Err(AppError::NotFound(format!("Welt {folder}")))
}

/// Ziel für neue Welten: der zuletzt benutzte Spielerordner (`None`, wenn es noch keinen gibt).
pub fn import_dir(loc: &DataLoc) -> Option<PathBuf> {
    loc.layout
        .world_slots(&loc.base)
        .into_iter()
        .map(|s| super::slot_path(&loc.base, &s))
        .max_by_key(|p| mtime_ms(&p.join("minecraftWorlds")).or_else(|| mtime_ms(p)).unwrap_or(0))
        .map(|p| p.join("minecraftWorlds"))
}

// ------------------------------------------------------------------ Sicherungen

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Sidecar {
    world_name: String,
    created: i64,
    size: u64,
    #[serde(default)]
    auto: bool,
}

pub fn backups_root(paths: &Paths, instance_id: &str) -> PathBuf {
    paths.root.join("backups").join("bedrock").join(instance_id)
}

pub fn backup_create(paths: &Paths, instance_id: &str, world: &Path, auto: bool) -> AppResult<WorldBackup> {
    let w = read_world(world, "", false).ok_or_else(|| AppError::NotFound("Welt".into()))?;
    let dir = backups_root(paths, instance_id).join(&w.folder);
    std::fs::create_dir_all(&dir)?;
    let created = crate::util::now_ms();
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S-%3f").to_string();
    let file = dir.join(format!("{stamp}.mcworld"));
    packs::zip_dir(world, &file)?;
    let size = std::fs::metadata(&file)?.len();
    let sc = Sidecar { world_name: w.name.clone(), created, size, auto };
    crate::util::write_json_atomic(&dir.join(format!("{stamp}.json")), &sc)?;
    Ok(WorldBackup { id: format!("{}/{stamp}", w.folder), folder: w.folder, world_name: w.name, created, size, auto })
}

pub fn backups_list(paths: &Paths, instance_id: &str) -> Vec<WorldBackup> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(backups_root(paths, instance_id)) else { return out };
    for e in rd.flatten() {
        let folder = e.file_name().to_string_lossy().to_string();
        let Ok(files) = std::fs::read_dir(e.path()) else { continue };
        for f in files.flatten() {
            let p = f.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let stamp = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            if !p.with_extension("mcworld").is_file() {
                continue;
            }
            let Ok(sc) = std::fs::read(&p).map_err(AppError::from).and_then(|b| serde_json::from_slice::<Sidecar>(&b).map_err(AppError::from)) else { continue };
            out.push(WorldBackup { id: format!("{folder}/{stamp}"), folder: folder.clone(), world_name: sc.world_name, created: sc.created, size: sc.size, auto: sc.auto });
        }
    }
    out.sort_by_key(|b| std::cmp::Reverse(b.created));
    out
}

fn backup_file(paths: &Paths, instance_id: &str, id: &str) -> AppResult<(String, PathBuf)> {
    let (folder, stamp) = id.split_once('/').ok_or_else(|| AppError::Invalid("Ungültige Sicherung".into()))?;
    check_folder(folder)?;
    if stamp.is_empty() || stamp.contains(['/', '\\', ':', '.']) {
        return Err(AppError::Invalid("Ungültige Sicherung".into()));
    }
    let p = backups_root(paths, instance_id).join(folder).join(format!("{stamp}.mcworld"));
    if !p.is_file() {
        return Err(AppError::NotFound("Sicherung".into()));
    }
    Ok((folder.to_string(), p))
}

pub fn backup_delete(paths: &Paths, instance_id: &str, id: &str) -> AppResult<()> {
    let (_, p) = backup_file(paths, instance_id, id)?;
    std::fs::remove_file(&p)?;
    let _ = std::fs::remove_file(p.with_extension("json"));
    Ok(())
}

/// Sicherung zurückspielen. Die aktuelle Welt wird vorher automatisch gesichert und erst nach dem
/// erfolgreichen Entpacken ersetzt.
pub fn backup_restore(paths: &Paths, instance_id: &str, loc: &DataLoc, id: &str) -> AppResult<()> {
    let (folder, file) = backup_file(paths, instance_id, id)?;
    let entries = super::manifest::read_zip(&std::fs::read(&file)?)?;
    let root = super::manifest::analyze(&entries)?
        .into_iter()
        .find_map(|f| match f {
            super::manifest::Found::World { root, nested: None, .. } => Some(root),
            _ => None,
        })
        .ok_or_else(|| AppError::Invalid("Die Sicherung enthält keine Welt".into()))?;
    let files = super::manifest::files_of(&entries, &root);
    let (worlds_dir, existing) = match find(loc, &folder) {
        Ok(p) => (p.parent().map(Path::to_path_buf).unwrap_or_default(), Some(p)),
        Err(_) => (import_dir(loc).ok_or_else(|| AppError::Invalid("Die Instanz hat noch keinen Spielerordner – bitte einmal starten.".into()))?, None),
    };
    if let Some(cur) = &existing {
        backup_create(paths, instance_id, cur, true)?;
    }
    std::fs::create_dir_all(&worlds_dir)?;
    let tmp = worlds_dir.join(format!(".vibe-tmp-{}", uuid::Uuid::new_v4().simple()));
    for (rel, data) in &files {
        let p = crate::util::safe_join(&tmp, rel).ok_or_else(|| AppError::Invalid(format!("Unsicherer Pfad: {rel}")))?;
        if let Some(pp) = p.parent() {
            std::fs::create_dir_all(pp)?;
        }
        std::fs::write(&p, data)?;
    }
    let dest = worlds_dir.join(&folder);
    if dest.exists() {
        let aside = worlds_dir.join(format!(".vibe-old-{}", uuid::Uuid::new_v4().simple()));
        std::fs::rename(&dest, &aside)?;
        if let Err(e) = std::fs::rename(&tmp, &dest) {
            let _ = std::fs::rename(&aside, &dest);
            let _ = std::fs::remove_dir_all(&tmp);
            return Err(e.into());
        }
        let _ = std::fs::remove_dir_all(&aside);
    } else {
        std::fs::rename(&tmp, &dest)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_backup_restore() {
        let tmp = super::super::tempdir("worlds");
        let base = tmp.join("profile");
        let w = base.join("Users/42/games/com.mojang/minecraftWorlds/AbC123");
        std::fs::create_dir_all(w.join("db")).unwrap();
        std::fs::write(w.join("level.dat"), b"nbt").unwrap();
        std::fs::write(w.join("levelname.txt"), "§bMeine Insel\n").unwrap();
        std::fs::write(w.join("db/000001.ldb"), b"chunk-v1").unwrap();
        std::fs::create_dir_all(base.join("Users/Shared/games/com.mojang/resource_packs")).unwrap();
        let loc = DataLoc { base: base.clone(), layout: super::super::Layout::Gdk, live: false };
        let l = list(&loc, true);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].name, "Meine Insel");
        assert_eq!(l[0].user, "42");
        assert_eq!(import_dir(&loc).unwrap(), base.join("Users/42/games/com.mojang/minecraftWorlds"));
        assert!(find(&loc, "../x").is_err());

        let paths = Paths { root: tmp.join("launcher") };
        let b = backup_create(&paths, "inst", &w, false).unwrap();
        assert_eq!(backups_list(&paths, "inst").len(), 1);
        // Welt ändern, dann zurückspielen
        std::fs::write(w.join("db/000001.ldb"), b"chunk-v2").unwrap();
        backup_restore(&paths, "inst", &loc, &b.id).unwrap();
        assert_eq!(std::fs::read(w.join("db/000001.ldb")).unwrap(), b"chunk-v1");
        // Vor dem Zurückspielen wurde automatisch gesichert
        let all = backups_list(&paths, "inst");
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|x| x.auto));
        // Gelöschte Welt lässt sich ebenfalls zurückholen
        std::fs::remove_dir_all(&w).unwrap();
        backup_restore(&paths, "inst", &loc, &b.id).unwrap();
        assert!(w.join("level.dat").is_file());
        backup_delete(&paths, "inst", &b.id).unwrap();
        assert_eq!(backups_list(&paths, "inst").len(), 1);
        assert!(backup_delete(&paths, "inst", "AbC123/../../x").is_err());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
