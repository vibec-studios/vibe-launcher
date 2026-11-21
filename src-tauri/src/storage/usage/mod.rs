use super::links::{self, FileId};
use super::store::MIN_SIZE;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FolderKind {
    Worlds,
    Mods,
    Config,
    Packs,
    Screenshots,
    Logs,
    Cache,
    Binaries,
    Rebuild,
    Map,
    ModData,
    Launcher,
    Other,
}

impl FolderKind {
    pub fn of(name: &str) -> FolderKind {
        match name.to_ascii_lowercase().as_str() {
            "saves" => FolderKind::Worlds,
            "mods" => FolderKind::Mods,
            "config" | "defaultconfigs" | "kubejs" | "options.txt" => FolderKind::Config,
            "resourcepacks" | "shaderpacks" | "datapacks" | "texturepacks" => FolderKind::Packs,
            "screenshots" | "replay_recordings" | "replay_videos" => FolderKind::Screenshots,
            "logs" | "crash-reports" => FolderKind::Logs,
            ".fabric" | ".mixin.out" | ".cache" | "natives" => FolderKind::Cache,
            "vista_ffmpeg_bin" => FolderKind::Binaries,
            ".bobby" | "distant_horizons_server_data" => FolderKind::Rebuild,
            "xaero" | "journeymap" | "xaeroworldmap" | "xaerominimap" => FolderKind::Map,
            "essential" | "rocketload" | "schematics" | "voxelmap" => FolderKind::ModData,
            ".vibe" => FolderKind::Launcher,
            _ => FolderKind::Other,
        }
    }

    pub fn clearable(self) -> bool {
        matches!(self, FolderKind::Cache | FolderKind::Binaries | FolderKind::Rebuild)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Folder {
    pub name: String,
    pub bytes: u64,
    pub kind: FolderKind,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstanceUsage {
    pub id: String,
    pub name: String,
    pub bytes: u64,
    pub shared: u64,
    #[serde(skip)]
    pub counted: u64,
    pub running: bool,
    pub folders: Vec<Folder>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Category {
    pub id: &'static str,
    pub bytes: u64,
    pub cleanable: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Usage {
    pub root: String,
    pub total: u64,
    pub shared_saved: u64,
    pub free: Option<u64>,
    pub categories: Vec<Category>,
    pub instances: Vec<InstanceUsage>,
}

#[derive(Default)]
pub struct Counter {
    seen: HashSet<FileId>,
    pub saved: u64,
}

pub struct Sizes {
    pub raw: u64,
    pub counted: u64,
    pub shared: u64,
}

impl Counter {
    pub fn file(&mut self, path: &Path, len: u64) -> Sizes {
        if len < MIN_SIZE {
            return Sizes { raw: len, counted: len, shared: 0 };
        }
        match links::info(path) {
            Ok(i) if i.links > 1 => {
                let first = self.seen.insert(i.id);
                if !first {
                    self.saved += len;
                }
                Sizes { raw: len, counted: if first { len } else { 0 }, shared: len }
            }
            _ => Sizes { raw: len, counted: len, shared: 0 },
        }
    }

    pub fn dir(&mut self, dir: &Path) -> u64 {
        self.sizes(dir).counted
    }

    pub fn sizes(&mut self, dir: &Path) -> Sizes {
        let mut out = Sizes { raw: 0, counted: 0, shared: 0 };
        for e in walkdir::WalkDir::new(dir).follow_links(false).into_iter().flatten() {
            if e.file_type().is_file() {
                let len = e.metadata().map(|m| m.len()).unwrap_or(0);
                let s = self.file(e.path(), len);
                out.raw += s.raw;
                out.counted += s.counted;
                out.shared += s.shared;
            }
        }
        out
    }
}

pub fn instance_ids(data: &Path) -> HashSet<String> {
    std::fs::read_dir(data.join("instances"))
        .map(|rd| rd.flatten().filter(|e| e.path().join("instance.json").is_file()).map(|e| e.file_name().to_string_lossy().to_string()).collect())
        .unwrap_or_default()
}

fn folders(game: &Path, counter: &mut Counter) -> (Vec<Folder>, Sizes) {
    let mut out: Vec<Folder> = Vec::new();
    let mut sum = Sizes { raw: 0, counted: 0, shared: 0 };
    let Ok(rd) = std::fs::read_dir(game) else { return (out, sum) };
    let mut loose = 0;
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Ok(ft) = e.file_type() else { continue };
        let s = if ft.is_dir() {
            counter.sizes(&e.path())
        } else if ft.is_file() {
            counter.file(&e.path(), e.metadata().map(|m| m.len()).unwrap_or(0))
        } else {
            continue;
        };
        sum.raw += s.raw;
        sum.counted += s.counted;
        sum.shared += s.shared;
        if ft.is_dir() {
            out.push(Folder { kind: FolderKind::of(&name), name, bytes: s.raw });
        } else {
            loose += s.raw;
        }
    }
    if loose > 0 {
        out.push(Folder { name: String::new(), bytes: loose, kind: FolderKind::Other });
    }
    out.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    (out, sum)
}

pub struct InstanceMeta {
    pub name: String,
    pub running: bool,
}

pub fn instance(data: &Path, id: &str, meta: &InstanceMeta, counter: &mut Counter) -> InstanceUsage {
    let dir = data.join("instances").join(id);
    let (mut list, sum) = folders(&dir.join("minecraft"), counter);
    let mut launcher = 0;
    let mut counted = sum.counted;
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten().filter(|e| e.file_name() != "minecraft") {
            let p = e.path();
            let s = if p.is_dir() { counter.sizes(&p) } else { counter.file(&p, e.metadata().map(|m| m.len()).unwrap_or(0)) };
            launcher += s.raw;
            counted += s.counted;
        }
    }
    if launcher > 0 {
        list.push(Folder { name: ".vibe-launcher".into(), bytes: launcher, kind: FolderKind::Launcher });
    }
    let bytes = list.iter().map(|f| f.bytes).sum();
    InstanceUsage { id: id.to_string(), name: meta.name.clone(), bytes, shared: sum.shared, counted, running: meta.running, folders: list }
}

fn sum_kind(list: &[InstanceUsage], pred: impl Fn(&Folder) -> bool, stopped_only: bool) -> u64 {
    list.iter().filter(|i| !(stopped_only && i.running)).flat_map(|i| i.folders.iter()).filter(|f| pred(f)).map(|f| f.bytes).sum()
}

fn orphan_snapshots(data: &Path, live: &HashSet<String>) -> u64 {
    let root = data.join("backups");
    let Ok(rd) = std::fs::read_dir(root.join("snapshots")) else { return 0 };
    let mut keep: HashSet<String> = HashSet::new();
    let mut drop: HashMap<String, u64> = HashMap::new();
    for e in rd.flatten().filter(|e| e.path().is_dir()) {
        let id = e.file_name().to_string_lossy().to_string();
        let refs = crate::content::snapshots::referenced(&root, &id);
        if live.contains(&id) {
            keep.extend(refs.into_iter().map(|(h, _)| h));
        } else {
            drop.extend(refs);
        }
    }
    drop.into_iter().filter(|(h, _)| !keep.contains(h)).map(|(_, s)| s).sum()
}

pub fn orphan_dirs(parent: &Path, live: &HashSet<String>) -> Vec<PathBuf> {
    std::fs::read_dir(parent)
        .map(|rd| rd.flatten().filter(|e| e.path().is_dir() && !live.contains(&e.file_name().to_string_lossy().to_string())).map(|e| e.path()).collect())
        .unwrap_or_default()
}

pub fn reclaimable_logs(dir: &Path) -> u64 {
    super::cleanup::old_launcher_logs(dir).iter().filter_map(|p| p.metadata().ok()).map(|m| m.len()).sum()
}

pub fn scan(data: &Path, metas: &HashMap<String, InstanceMeta>, extra: &[(&'static str, PathBuf)]) -> Usage {
    let mut c = Counter::default();
    let mut ids: Vec<&String> = metas.keys().collect();
    ids.sort();
    let mut instances: Vec<InstanceUsage> = ids.into_iter().map(|id| instance(data, id, &metas[id], &mut c)).collect();
    instances.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    let live: HashSet<String> = metas.keys().cloned().collect();
    let inst_total: u64 = instances.iter().map(|i| i.counted).sum();
    let mod_caches = sum_kind(&instances, |f| f.name == ".fabric" || f.name == ".mixin.out", true);
    let inst_logs: u64 = instances.iter().filter(|i| !i.running).map(|i| super::cleanup::old_instance_logs(&data.join("instances").join(&i.id).join("minecraft")).1).sum();
    let mut cats = vec![
        Category { id: "instances", bytes: inst_total, cleanable: 0 },
        Category { id: "mod_caches", bytes: sum_kind(&instances, |f| f.kind == FolderKind::Cache, false), cleanable: mod_caches },
        Category { id: "instance_logs", bytes: sum_kind(&instances, |f| f.kind == FolderKind::Logs, false), cleanable: inst_logs },
    ];
    let backups = data.join("backups");
    let orphan_worlds: u64 = orphan_dirs(&backups.join("worlds"), &live).iter().map(|d| Counter::default().dir(d)).sum();
    let worlds = c.dir(&backups.join("worlds"));
    cats.push(Category { id: "world_backups", bytes: worlds, cleanable: 0 });
    cats.push(Category { id: "orphan_world_backups", bytes: orphan_worlds, cleanable: orphan_worlds });
    let orphan_snap = orphan_snapshots(data, &live);
    let snaps = c.dir(&backups.join("snapshots")) + c.dir(&backups.join("objects"));
    cats.push(Category { id: "snapshots", bytes: snaps, cleanable: orphan_snap });
    for (id, sub) in [("game_files", "meta"), ("java", "java"), ("servers", "servers"), ("store", "store")] {
        cats.push(Category { id, bytes: c.dir(&data.join(sub)), cleanable: 0 });
    }
    let cache = c.dir(&data.join("cache"));
    cats.push(Category { id: "cache", bytes: cache, cleanable: super::cleanup::cache_reclaimable(data) });
    let logs_dir = data.join("logs");
    cats.push(Category { id: "launcher_logs", bytes: c.dir(&logs_dir), cleanable: reclaimable_logs(&logs_dir) });
    let vibey_dir = c.dir(&super::vibey::data_dir(data));
    let vibey = super::vibey::bytes(data);
    cats.push(Category { id: "vibey", bytes: vibey, cleanable: vibey });
    let busy: HashSet<String> = metas.iter().filter(|(_, m)| m.running).map(|(id, _)| id.clone()).collect();
    cats.push(Category { id: "fast_cache", bytes: super::fastcache::bytes(data, &HashSet::new()), cleanable: super::fastcache::bytes(data, &busy) });
    let known = ["instances", "backups", "meta", "java", "servers", "store", "cache", "logs", "vibey"];
    let mut other = 0;
    if let Ok(rd) = std::fs::read_dir(data) {
        for e in rd.flatten().filter(|e| !known.contains(&e.file_name().to_string_lossy().as_ref())) {
            let p = e.path();
            other += if p.is_dir() { c.dir(&p) } else { c.file(&p, e.metadata().map(|m| m.len()).unwrap_or(0)).counted };
        }
    }
    cats.push(Category { id: "other", bytes: other, cleanable: 0 });
    for (id, p) in extra {
        cats.push(Category { id, bytes: c.dir(p), cleanable: 0 });
    }
    let total = vibey_dir + cats.iter().filter(|x| !matches!(x.id, "mod_caches" | "instance_logs" | "orphan_world_backups" | "vibey" | "fast_cache")).map(|x| x.bytes).sum::<u64>();
    Usage {
        root: data.to_string_lossy().to_string(),
        total,
        shared_saved: c.saved,
        free: crate::util::diskspace::free_bytes(data).map(|(_, f)| f),
        categories: cats,
        instances,
    }
}

#[cfg(test)]
mod tests;
