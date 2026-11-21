use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LoosePack {
    pub file_name: String,
    pub in_worlds: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorldRef {
    pub folder: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Overview {
    pub packs: Vec<LoosePack>,
    pub worlds: Vec<WorldRef>,
}

fn is_pack(p: &Path) -> bool {
    if p.is_dir() {
        return p.join("pack.mcmeta").is_file();
    }
    p.is_file() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip"))
}

fn valid_name(n: &str) -> bool {
    !n.is_empty() && !n.ends_with(['.', ' ']) && !n.contains(['/', '\\', ':', '\0'])
}

fn real_dir(path: &Path) -> AppResult<PathBuf> {
    let actual = path.canonicalize()?;
    let name = path.file_name().ok_or_else(|| AppError::Invalid("Ungültiger Ordner".into()))?;
    let parent = path.parent().ok_or_else(|| AppError::Invalid("Ungültiger Ordner".into()))?.canonicalize()?;
    if actual != parent.join(name) || !actual.is_dir() {
        return Err(AppError::Invalid("Verknüpfte Datapack- oder Weltordner werden nicht unterstützt".into()));
    }
    Ok(actual)
}

fn world_dir(game_dir: &Path, world: &str) -> AppResult<PathBuf> {
    if !valid_name(world) || !game_dir.join("saves").join(world).join("level.dat").is_file() {
        return Err(AppError::NotFound(format!("Welt {world}")));
    }
    let saves = real_dir(&game_dir.join("saves"))?;
    let world = real_dir(&saves.join(world))?;
    let dir = world.join("datapacks");
    match dir.symlink_metadata() {
        Ok(_) => real_dir(&dir),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(dir),
        Err(e) => Err(e.into()),
    }
}

fn actual_pack(dir: &Path, name: &str) -> AppResult<PathBuf> {
    if !valid_name(name) {
        return Err(AppError::Invalid("Ungültiger Datapack-Dateiname".into()));
    }
    let path = dir.join(name);
    if !is_pack(&path) || path.canonicalize()? != dir.canonicalize()?.join(name) {
        return Err(AppError::NotFound(format!("Datapack {name}")));
    }
    Ok(path)
}

fn pack_names(dir: &Path) -> AppResult<Vec<String>> {
    let entries = match dir.read_dir() {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };
    let mut names: Vec<_> = entries
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| actual_pack(dir, n).is_ok())
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    Ok(names)
}

#[derive(Serialize)]
pub struct WorldPacks {
    pub installed: Vec<String>,
    pub available: Vec<String>,
}

pub fn list_world(game_dir: &Path, world: &str) -> AppResult<WorldPacks> {
    let dest = world_dir(game_dir, world)?;
    let installed = pack_names(&dest)?;
    let available = pack_names(&game_dir.join("datapacks"))?
        .into_iter()
        .filter(|name| dest.join(name).symlink_metadata().is_err())
        .collect();
    Ok(WorldPacks { installed, available })
}

pub fn add_world_zip(game_dir: &Path, world: &str, path: &Path) -> AppResult<()> {
    use std::fs::File;
    let dest = world_dir(game_dir, world)?;
    let name = path.file_name().and_then(|n| n.to_str()).filter(|n| valid_name(n)).ok_or_else(|| AppError::Invalid("Ungültiger Datapack-Dateiname".into()))?;
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip")) {
        return Err(AppError::Invalid("Bitte eine Datapack-ZIP-Datei auswählen".into()));
    }
    let mut zip = zip::ZipArchive::new(File::open(path)?).map_err(|_| AppError::Invalid("Datapack-ZIP kann nicht geöffnet werden".into()))?;
    if !zip.by_name("pack.mcmeta").is_ok_and(|meta| meta.is_file()) {
        return Err(AppError::Invalid("In der ZIP-Datei fehlt pack.mcmeta auf der obersten Ebene".into()));
    }
    drop(zip);
    std::fs::create_dir_all(&dest)?;
    if !copy_pack(path, &dest.join(name))? {
        return Err(AppError::Invalid(format!("Datapack {name} ist bereits in der Welt")));
    }
    Ok(())
}

pub fn remove_world_pack(game_dir: &Path, world: &str, file: &str) -> AppResult<()> {
    let pack = actual_pack(&world_dir(game_dir, world)?, file)?;
    if pack.is_dir() {
        std::fs::remove_dir_all(pack)?;
    } else {
        std::fs::remove_file(pack)?;
    }
    Ok(())
}

fn copy_pack(src: &Path, dest: &Path) -> AppResult<bool> {
    use std::fs::{self, File};
    if src.is_dir() {
        match fs::create_dir(dest) {
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => return Ok(false),
            result => result?,
        }
        if let Err(e) = crate::util::copy_dir_all(src, dest) {
            let _ = fs::remove_dir_all(dest);
            return Err(e.into());
        }
    } else {
        let mut source = File::open(src)?;
        let mut output = match File::create_new(dest) {
            Ok(output) => output,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => return Ok(false),
            Err(e) => return Err(e.into()),
        };
        if let Err(e) = std::io::copy(&mut source, &mut output).and_then(|_| output.sync_all()) {
            drop(output);
            let _ = fs::remove_file(dest);
            return Err(e.into());
        }
    }
    Ok(true)
}

pub fn worlds(game_dir: &Path) -> Vec<WorldRef> {
    let Ok(rd) = std::fs::read_dir(game_dir.join("saves")) else { return vec![] };
    let mut v: Vec<WorldRef> = rd
        .flatten()
        .filter(|e| e.path().join("level.dat").is_file())
        .map(|e| {
            let folder = e.file_name().to_string_lossy().to_string();
            WorldRef { name: folder.clone(), folder }
        })
        .collect();
    v.sort_by_key(|w| w.folder.to_lowercase());
    v
}

pub fn overview(game_dir: &Path) -> Overview {
    let worlds = worlds(game_dir);
    let mut packs: Vec<LoosePack> = std::fs::read_dir(game_dir.join("datapacks"))
        .map(|rd| {
            rd.flatten()
                .filter(|e| is_pack(&e.path()))
                .map(|e| {
                    let file_name = e.file_name().to_string_lossy().to_string();
                    let in_worlds = worlds.iter().filter(|w| game_dir.join("saves").join(&w.folder).join("datapacks").join(&file_name).exists()).map(|w| w.folder.clone()).collect();
                    LoosePack { file_name, in_worlds }
                })
                .collect()
        })
        .unwrap_or_default();
    packs.sort_by_key(|p| p.file_name.to_lowercase());
    Overview { packs, worlds }
}

pub fn copy_to_worlds(game_dir: &Path, files: &[String], worlds: &[String]) -> AppResult<usize> {
    let sources = files.iter().map(|f| actual_pack(&game_dir.join("datapacks"), f)).collect::<AppResult<Vec<_>>>()?;
    let destinations = worlds.iter().map(|w| world_dir(game_dir, w)).collect::<AppResult<Vec<_>>>()?;
    let mut copied = 0;
    for dest_dir in destinations {
        std::fs::create_dir_all(&dest_dir)?;
        for (src, file) in sources.iter().zip(files) {
            copied += usize::from(copy_pack(src, &dest_dir.join(file))?);
        }
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> crate::util::testdir::TestDir {
        let d = crate::util::testdir::TestDir::new("datapacks");
        let g = d.path();
        std::fs::create_dir_all(g.join("datapacks/folderpack")).unwrap();
        std::fs::write(g.join("datapacks/folderpack/pack.mcmeta"), "{}").unwrap();
        std::fs::write(g.join("datapacks/a.zip"), "zip").unwrap();
        std::fs::write(g.join("datapacks/readme.txt"), "x").unwrap();
        for w in ["Welt 1", "Welt 2"] {
            std::fs::create_dir_all(g.join("saves").join(w)).unwrap();
            std::fs::write(g.join("saves").join(w).join("level.dat"), "x").unwrap();
        }
        std::fs::create_dir_all(g.join("saves/kaputt")).unwrap();
        d
    }

    #[test]
    fn lists_packs_and_worlds() {
        let d = setup();
        let o = overview(d.path());
        assert_eq!(o.packs.iter().map(|p| p.file_name.as_str()).collect::<Vec<_>>(), vec!["a.zip", "folderpack"]);
        assert_eq!(o.worlds.len(), 2);
    }

    #[test]
    fn copies_and_skips_existing() {
        let d = setup();
        let files = vec!["a.zip".to_string(), "folderpack".to_string()];
        let n = copy_to_worlds(d.path(), &files, &["Welt 1".to_string()]).unwrap();
        assert_eq!(n, 2);
        assert!(d.path().join("saves/Welt 1/datapacks/folderpack/pack.mcmeta").is_file());
        assert_eq!(copy_to_worlds(d.path(), &files, &["Welt 1".to_string()]).unwrap(), 0);
        let o = overview(d.path());
        assert_eq!(o.packs[0].in_worlds, vec!["Welt 1".to_string()]);
    }

    #[test]
    fn rejects_bad_names() {
        let d = setup();
        assert!(copy_to_worlds(d.path(), &["../x.zip".to_string()], &["Welt 1".to_string()]).is_err());
        assert!(copy_to_worlds(d.path(), &["a.zip".to_string()], &["kaputt".to_string()]).is_err());
    }

    #[test]
    fn wave3_world_datapacks_stay_in_the_selected_world() {
        use std::io::Write;
        let d = setup();
        let game = d.path();
        let source = game.join("my-pack.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&source).unwrap());
        zip.start_file("pack.mcmeta", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(br#"{"pack":{"pack_format":48,"description":"Test"}}"#).unwrap();
        zip.finish().unwrap();

        add_world_zip(game, "Welt 1", &source).unwrap();
        assert!(add_world_zip(game, "Welt 1", &source).is_err());
        assert!(add_world_zip(game, ".. ", &source).is_err());
        assert!(add_world_zip(game, "Welt 1", &game.join("datapacks/a.zip")).is_err());
        assert_eq!(copy_to_worlds(game, &["folderpack".into()], &["Welt 1".into()]).unwrap(), 1);
        let list = list_world(game, "Welt 1").unwrap();
        assert_eq!(list.installed, ["folderpack", "my-pack.zip"]);
        assert_eq!(list.available, ["a.zip"]);
        assert!(list_world(game, "Welt 2").unwrap().installed.is_empty());
        assert!(remove_world_pack(game, "Welt 1", "../level.dat").is_err());
        remove_world_pack(game, "Welt 1", "folderpack").unwrap();
        remove_world_pack(game, "Welt 1", "my-pack.zip").unwrap();
        assert!(list_world(game, "Welt 1").unwrap().installed.is_empty());
        assert!(game.join("datapacks/folderpack/pack.mcmeta").is_file());
        assert!(source.is_file());
    }
}
