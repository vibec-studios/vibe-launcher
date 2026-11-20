use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::Path;

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
    p.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip"))
}

fn valid_name(n: &str) -> bool {
    !n.is_empty() && n != "." && n != ".." && !n.contains(['/', '\\', ':'])
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
    let mut copied = 0;
    for w in worlds {
        if !valid_name(w) || !game_dir.join("saves").join(w).join("level.dat").is_file() {
            return Err(AppError::Invalid(format!("Welt „{w}“ nicht gefunden")));
        }
        let dest_dir = game_dir.join("saves").join(w).join("datapacks");
        std::fs::create_dir_all(&dest_dir)?;
        for f in files {
            if !valid_name(f) {
                return Err(AppError::Invalid(format!("Ungültiger Dateiname: {f}")));
            }
            let src = game_dir.join("datapacks").join(f);
            if !is_pack(&src) {
                return Err(AppError::NotFound(format!("Datapack {f}")));
            }
            let dest = dest_dir.join(f);
            if dest.exists() {
                continue;
            }
            if src.is_dir() {
                crate::util::copy_dir_all(&src, &dest)?;
            } else {
                std::fs::copy(&src, &dest)?;
            }
            copied += 1;
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
}
