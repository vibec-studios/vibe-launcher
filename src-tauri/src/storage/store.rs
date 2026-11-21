use super::links;
use crate::net::DownloadItem;
use std::io;
use std::path::{Path, PathBuf};

pub const MIN_SIZE: u64 = 64 * 1024;
const MAX_LINKS: u32 = 1000;
const SHAREABLE: &[&str] = &["jar", "zip", "litemod", "mrpack", "exe", "dll", "so", "dylib", "disabled"];

pub fn root(data: &Path) -> PathBuf {
    data.join("store")
}

pub fn object(data: &Path, sha1: &str) -> Option<PathBuf> {
    let sha1 = sha1.to_ascii_lowercase();
    if sha1.len() != 40 || !sha1.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    Some(root(data).join(&sha1[..2]).join(sha1))
}

pub fn shareable(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| SHAREABLE.iter().any(|x| x.eq_ignore_ascii_case(e)))
}

#[derive(Debug, PartialEq, Eq)]
pub enum Adopted {
    Linked(u64),
    Stored,
    Skipped,
}

pub fn adopt(data: &Path, file: &Path, sha1: Option<&str>) -> io::Result<Adopted> {
    let meta = std::fs::symlink_metadata(file)?;
    if !meta.is_file() || meta.len() < MIN_SIZE {
        return Ok(Adopted::Skipped);
    }
    let hash = match sha1 {
        Some(h) => h.to_ascii_lowercase(),
        None => crate::net::sha1_file(file)?,
    };
    let Some(obj) = object(data, &hash) else { return Ok(Adopted::Skipped) };
    let mine = links::info(file)?;
    match links::info(&obj) {
        Ok(o) if o.id == mine.id => Ok(Adopted::Skipped),
        Ok(o) if o.size == mine.size && o.links < MAX_LINKS => {
            links::replace_with_link(&obj, file)?;
            Ok(if mine.links <= 1 { Adopted::Linked(mine.size) } else { Adopted::Linked(0) })
        }
        Ok(_) => Ok(Adopted::Skipped),
        Err(_) => {
            if let Some(parent) = obj.parent() {
                std::fs::create_dir_all(parent)?;
            }
            if sha1.is_some() && crate::net::sha1_file(file)? != hash {
                return Ok(Adopted::Skipped);
            }
            std::fs::hard_link(file, &obj)?;
            Ok(Adopted::Stored)
        }
    }
}

fn link_known(data: &Path, item: &DownloadItem, sha1: &str) -> bool {
    if item.path.exists() {
        return false;
    }
    let Some(obj) = object(data, sha1) else { return false };
    let Ok(o) = links::info(&obj) else { return false };
    if o.links >= MAX_LINKS || item.size.is_some_and(|s| s != o.size) {
        return false;
    }
    item.path.parent().is_some_and(|p| std::fs::create_dir_all(p).is_ok()) && links::replace_with_link(&obj, &item.path).is_ok()
}

pub fn prelink(data: &Path, items: Vec<DownloadItem>) -> (Vec<DownloadItem>, Vec<(PathBuf, String)>) {
    let mut rest = Vec::new();
    let mut known = Vec::new();
    for item in items {
        if let Some(sha1) = item.sha1.clone().filter(|_| shareable(&item.path)) {
            if link_known(data, &item, &sha1) {
                continue;
            }
            known.push((item.path.clone(), sha1));
        }
        rest.push(item);
    }
    (rest, known)
}

pub fn adopt_all(data: &Path, files: &[(PathBuf, String)]) -> u64 {
    let mut saved = 0;
    for (path, sha1) in files {
        if let Ok(Adopted::Linked(n)) = adopt(data, path, Some(sha1)) {
            saved += n;
        }
    }
    saved
}

pub async fn download_all(state: &crate::state::AppState, items: Vec<DownloadItem>, progress: Option<&crate::tasks::SubProgress>) -> crate::error::AppResult<()> {
    let data = state.paths.root.clone();
    let (rest, known) = {
        let data = data.clone();
        tokio::task::spawn_blocking(move || prelink(&data, items)).await?
    };
    state.net.download_all(rest, progress).await?;
    tokio::task::spawn_blocking(move || adopt_all(&data, &known)).await?;
    Ok(())
}

pub fn gc(data: &Path) -> (usize, u64) {
    let mut removed = 0;
    let mut bytes = 0;
    for e in walkdir::WalkDir::new(root(data)).min_depth(2).max_depth(2).into_iter().flatten() {
        if !e.file_type().is_file() {
            continue;
        }
        if let Ok(i) = links::info(e.path()) {
            if i.links <= 1 && std::fs::remove_file(e.path()).is_ok() {
                removed += 1;
                bytes += i.size;
            }
        }
    }
    if let Ok(rd) = std::fs::read_dir(root(data)) {
        for e in rd.flatten() {
            let _ = std::fs::remove_dir(e.path());
        }
    }
    (removed, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blob(tag: u8) -> Vec<u8> {
        vec![tag; MIN_SIZE as usize + 10]
    }

    #[test]
    fn duplicates_share_one_file_and_survive_removal() {
        let data = super::super::test_dir("store");
        let a = data.join("instances/a/minecraft/mods/x.jar");
        let b = data.join("instances/b/minecraft/mods/x.jar");
        for p in [&a, &b] {
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, blob(7)).unwrap();
        }
        assert_eq!(adopt(&data, &a, None).unwrap(), Adopted::Stored);
        assert_eq!(adopt(&data, &b, None).unwrap(), Adopted::Linked(MIN_SIZE + 10));
        assert_eq!(adopt(&data, &b, None).unwrap(), Adopted::Skipped);
        assert_eq!(links::info(&a).unwrap().id, links::info(&b).unwrap().id);
        std::fs::remove_file(&a).unwrap();
        assert_eq!(std::fs::read(&b).unwrap(), blob(7));
        assert_eq!(gc(&data).0, 0);
        std::fs::remove_file(&b).unwrap();
        assert_eq!(gc(&data).0, 1);
    }

    #[test]
    fn wrong_hash_is_never_linked() {
        let data = super::super::test_dir("store-hash");
        let a = data.join("a.jar");
        let b = data.join("b.jar");
        std::fs::write(&a, blob(1)).unwrap();
        std::fs::write(&b, blob(2)).unwrap();
        let h = crate::net::sha1_file(&b).unwrap();
        assert_eq!(adopt(&data, &a, Some(&h)).unwrap(), Adopted::Skipped);
        assert!(!object(&data, &h).unwrap().exists());
        assert_eq!(adopt(&data, &b, Some(&h)).unwrap(), Adopted::Stored);
    }

    #[test]
    fn prelink_skips_download_of_known_files() {
        let data = super::super::test_dir("store-pre");
        let a = data.join("a/mods/x.jar");
        std::fs::create_dir_all(a.parent().unwrap()).unwrap();
        std::fs::write(&a, blob(3)).unwrap();
        let h = crate::net::sha1_file(&a).unwrap();
        adopt(&data, &a, Some(&h)).unwrap();
        let target = data.join("b/mods/x.jar");
        let other = data.join("b/mods/y.jar");
        let items = vec![
            DownloadItem::new("https://example.invalid/x.jar", target.clone()).sha1(Some(h.clone())),
            DownloadItem::new("https://example.invalid/y.jar", other.clone()).sha1(Some("0".repeat(40))),
        ];
        let (rest, known) = prelink(&data, items);
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0].path, other);
        assert_eq!(known, vec![(other, "0".repeat(40))]);
        assert_eq!(std::fs::read(&target).unwrap(), blob(3));
    }
}
