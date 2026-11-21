use super::links::{self, FileId};
use super::store::{self, Adopted, MIN_SIZE};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

pub const SHARED_DIRS: &[&str] = &["mods", "resourcepacks", "shaderpacks"];
pub const BINARY_DIRS: &[&str] = &["vista_ffmpeg_bin"];

#[derive(Debug, Default, Clone, Serialize)]
pub struct DedupReport {
    pub files: usize,
    pub linked: usize,
    pub before: u64,
    pub after: u64,
}

pub struct Candidate {
    path: PathBuf,
    id: FileId,
    size: u64,
    hash: Option<String>,
}

impl Candidate {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

fn push(out: &mut Vec<Candidate>, path: PathBuf, hash: Option<String>) {
    if let Ok(i) = links::info(&path) {
        if i.size >= MIN_SIZE {
            out.push(Candidate { path, id: i.id, size: i.size, hash });
        }
    }
}

fn walk_files(dir: &Path, all: bool, out: &mut Vec<Candidate>) {
    for e in walkdir::WalkDir::new(dir).follow_links(false).into_iter().flatten() {
        if e.file_type().is_file() && (all || store::shareable(e.path())) && !e.file_name().to_string_lossy().ends_with(".vlink") {
            push(out, e.path().to_path_buf(), None);
        }
    }
}

pub fn instance_files(game: &Path, out: &mut Vec<Candidate>) {
    for d in SHARED_DIRS {
        walk_files(&game.join(d), false, out);
    }
    for d in BINARY_DIRS {
        walk_files(&game.join(d), true, out);
    }
}

fn known_objects(dir: &Path, out: &mut Vec<Candidate>) {
    for e in walkdir::WalkDir::new(dir).min_depth(2).max_depth(2).into_iter().flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if e.file_type().is_file() && name.len() == 40 && name.bytes().all(|b| b.is_ascii_hexdigit()) {
            push(out, e.path().to_path_buf(), Some(name));
        }
    }
}

fn unique_bytes(files: &[Candidate]) -> u64 {
    let mut seen = HashSet::new();
    files.iter().filter_map(|c| links::info(&c.path).ok()).filter(|i| seen.insert(i.id)).map(|i| i.size).sum()
}

pub fn collect(data: &Path, skip: &HashSet<String>) -> Vec<Candidate> {
    let mut out = Vec::new();
    known_objects(&store::root(data), &mut out);
    known_objects(&data.join("backups").join("objects"), &mut out);
    if let Ok(rd) = std::fs::read_dir(data.join("instances")) {
        for e in rd.flatten() {
            let id = e.file_name().to_string_lossy().to_string();
            if !skip.contains(&id) && e.path().is_dir() {
                instance_files(&e.path().join("minecraft"), &mut out);
            }
        }
    }
    out
}

pub fn run(data: &Path, skip: &HashSet<String>, progress: &dyn Fn(f64) -> bool) -> DedupReport {
    let mut files = collect(data, skip);
    let before = unique_bytes(&files);
    let mut by_size: HashMap<u64, HashSet<FileId>> = HashMap::new();
    for c in &files {
        by_size.entry(c.size).or_default().insert(c.id);
    }
    files.retain(|c| by_size.get(&c.size).is_some_and(|ids| ids.len() > 1));
    let total: u64 = files.iter().map(|c| c.size).sum::<u64>().max(1);
    let mut done = 0u64;
    let mut hashed: HashMap<FileId, String> = HashMap::new();
    for c in files.iter_mut() {
        if c.hash.is_none() {
            c.hash = match hashed.get(&c.id) {
                Some(h) => Some(h.clone()),
                None => crate::net::sha1_file(&c.path).ok(),
            };
        }
        if let Some(h) = &c.hash {
            hashed.insert(c.id, h.clone());
        }
        done += c.size;
        if !progress(done as f64 / total as f64 * 0.9) {
            break;
        }
    }
    let mut groups: HashMap<String, Vec<&Candidate>> = HashMap::new();
    for c in files.iter().filter(|c| c.hash.is_some()) {
        groups.entry(c.hash.clone().unwrap_or_default()).or_default().push(c);
    }
    let mut linked = 0;
    let store_root = store::root(data);
    for (hash, mut group) in groups {
        if group.iter().map(|c| c.id).collect::<HashSet<_>>().len() < 2 {
            continue;
        }
        group.sort_by_key(|c| !c.path.starts_with(&store_root));
        for c in group {
            if c.path.starts_with(&store_root) {
                continue;
            }
            if let Ok(Adopted::Linked(_)) = store::adopt(data, &c.path, Some(&hash)) {
                linked += 1;
            }
        }
    }
    progress(1.0);
    let all = collect(data, skip);
    let after = unique_bytes(&all);
    DedupReport { files: all.len(), linked, before, after }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_mods_across_instances_are_linked_once() {
        let data = super::super::test_dir("dedup");
        let jar = vec![5u8; MIN_SIZE as usize * 2];
        let other = vec![6u8; MIN_SIZE as usize * 2];
        for id in ["a", "b", "c"] {
            let mods = data.join("instances").join(id).join("minecraft/mods");
            std::fs::create_dir_all(&mods).unwrap();
            std::fs::write(mods.join("same.jar"), &jar).unwrap();
            std::fs::write(mods.join("config.json"), &jar).unwrap();
        }
        std::fs::write(data.join("instances/c/minecraft/mods/diff.jar"), &other).unwrap();
        let report = run(&data, &HashSet::new(), &|_| true);
        assert_eq!(report.linked, 2);
        assert_eq!(report.before, jar.len() as u64 * 3 + other.len() as u64);
        assert_eq!(report.after, jar.len() as u64 + other.len() as u64);
        let a = links::info(&data.join("instances/a/minecraft/mods/same.jar")).unwrap();
        assert_eq!(a.links, 4);
        assert_eq!(links::info(&data.join("instances/a/minecraft/mods/config.json")).unwrap().links, 1);
        let skip: HashSet<String> = ["c".to_string()].into();
        std::fs::remove_file(data.join("instances/b/minecraft/mods/same.jar")).unwrap();
        std::fs::write(data.join("instances/b/minecraft/mods/same.jar"), &jar).unwrap();
        let again = run(&data, &skip, &|_| true);
        assert_eq!(again.linked, 1);
        assert_eq!(std::fs::read(data.join("instances/c/minecraft/mods/same.jar")).unwrap(), jar);
    }
}
