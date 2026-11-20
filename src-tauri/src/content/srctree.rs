use super::gamedata::skip_inner;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Prefer {
    #[default]
    Overlay,
    Source,
    Newer,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Overlay {
    pub rel: PathBuf,
    pub path: PathBuf,
    pub prefer: Prefer,
}

#[derive(Debug, Clone)]
pub struct Entry {
    pub rel: PathBuf,
    pub abs: PathBuf,
    pub meta: std::fs::Metadata,
}

pub fn safe_rel(s: &str) -> Option<PathBuf> {
    let p = PathBuf::from(s.replace('\\', "/"));
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Normal(n) => out.push(n),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

fn key(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/").to_lowercase()
}

fn under(p: &Path, base: &Path) -> bool {
    let (p, b) = (key(p), key(base));
    b.is_empty() || p == b || p.starts_with(&format!("{b}/"))
}

pub fn walk(dir: &Path, budget: &mut usize) -> Vec<(PathBuf, PathBuf, std::fs::Metadata)> {
    let mut out = Vec::new();
    let it = walkdir::WalkDir::new(dir).follow_links(true).min_depth(1).into_iter().filter_entry(|e| !skip_inner(&e.file_name().to_string_lossy()));
    for e in it.flatten() {
        if *budget == 0 {
            break;
        }
        if !e.file_type().is_file() {
            continue;
        }
        let Ok(m) = e.metadata() else { continue };
        let Ok(rel) = e.path().strip_prefix(dir).map(Path::to_path_buf) else { continue };
        *budget -= 1;
        out.push((e.into_path(), rel, m));
    }
    out
}

fn newer(a: &std::fs::Metadata, b: &std::fs::Metadata) -> bool {
    match (a.modified(), b.modified()) {
        (Ok(x), Ok(y)) => x > y,
        _ => false,
    }
}

fn wins(o: &Overlay, overlay: &std::fs::Metadata, source: &std::fs::Metadata) -> bool {
    match o.prefer {
        Prefer::Overlay => true,
        Prefer::Source => false,
        Prefer::Newer => newer(overlay, source),
    }
}

fn one(abs: &Path, rel: &Path) -> Option<Entry> {
    let meta = std::fs::metadata(abs).ok().filter(|m| m.is_file())?;
    Some(Entry { rel: rel.to_path_buf(), abs: abs.to_path_buf(), meta })
}

fn add(list: Vec<Entry>, map: &mut HashMap<String, Entry>, from: Option<&Overlay>) {
    for e in list {
        let k = key(&e.rel);
        let keep = match (map.get(&k), from) {
            (None, _) => true,
            (Some(old), Some(o)) => wins(o, &e.meta, &old.meta),
            (Some(_), None) => false,
        };
        if keep {
            map.insert(k, e);
        }
    }
}

fn below(base: &Path, rel_base: &Path, budget: &mut usize) -> Vec<Entry> {
    if let Some(e) = one(base, rel_base) {
        *budget = budget.saturating_sub(1);
        return vec![e];
    }
    walk(base, budget).into_iter().map(|(abs, r, meta)| Entry { rel: rel_base.join(r), abs, meta }).collect()
}

pub fn files(src: &Path, rel: &Path, ov: &[Overlay], budget: &mut usize) -> Vec<Entry> {
    let mut map: HashMap<String, Entry> = HashMap::new();
    add(below(&src.join(rel), rel, budget), &mut map, None);
    for o in ov {
        if under(&o.rel, rel) {
            add(below(&o.path, &o.rel, budget), &mut map, Some(o));
        } else if under(rel, &o.rel) {
            let rest = rel.strip_prefix(&o.rel).map(Path::to_path_buf).unwrap_or_default();
            add(below(&o.path.join(&rest), rel, budget), &mut map, Some(o));
        }
    }
    let mut v: Vec<Entry> = map.into_values().collect();
    v.sort_by_key(|e| key(&e.rel));
    v
}

pub fn locate(src: &Path, rel: &Path, ov: &[Overlay]) -> Option<PathBuf> {
    let own = src.join(rel);
    let own_ok = std::fs::metadata(&own).is_ok();
    let mut best: Option<PathBuf> = own_ok.then(|| own.clone());
    for o in ov.iter().filter(|o| under(rel, &o.rel)) {
        let rest = rel.strip_prefix(&o.rel).map(Path::to_path_buf).unwrap_or_default();
        let p = if rest.as_os_str().is_empty() { o.path.clone() } else { o.path.join(rest) };
        let Ok(pm) = std::fs::metadata(&p) else { continue };
        let take = match (&best, std::fs::metadata(&own)) {
            (None, _) => true,
            (Some(_), Ok(om)) if own_ok => wins(o, &pm, &om),
            _ => true,
        };
        if take {
            best = Some(p);
        }
    }
    best
}

pub fn tops(src: &Path, ov: &[Overlay]) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(src).map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default();
    for o in ov.iter().filter(|o| o.path.exists()) {
        if let Some(Component::Normal(n)) = o.rel.components().next() {
            let n = n.to_string_lossy().to_string();
            if !v.iter().any(|x| x.eq_ignore_ascii_case(&n)) {
                v.push(n);
            }
        }
    }
    v.sort_by_key(|n| n.to_lowercase());
    v
}

fn dir_names(d: &Path, out: &mut Vec<String>) {
    for e in std::fs::read_dir(d).into_iter().flatten().flatten() {
        if e.path().is_dir() {
            out.push(e.file_name().to_string_lossy().to_string());
        }
    }
}

pub fn children(src: &Path, rel: &Path, ov: &[Overlay]) -> Vec<String> {
    let mut v: Vec<String> = Vec::new();
    dir_names(&src.join(rel), &mut v);
    for o in ov {
        if under(rel, &o.rel) {
            dir_names(&o.path.join(rel.strip_prefix(&o.rel).unwrap_or(Path::new(""))), &mut v);
        } else if o.rel.parent().is_some_and(|p| key(p) == key(rel)) && o.path.is_dir() {
            v.extend(o.rel.file_name().map(|n| n.to_string_lossy().to_string()));
        }
    }
    v.sort_by_key(|n| n.to_lowercase());
    v.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    v
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("vl-st-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn write(p: &Path, s: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, s).unwrap();
    }

    pub fn link_dir(target: &Path, link: &Path) -> bool {
        #[cfg(windows)]
        {
            let w = |p: &Path| p.to_string_lossy().replace('/', "\\");
            std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(w(link)).arg(w(target)).output().map(|o| o.status.success()).unwrap_or(false)
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link).is_ok()
        }
    }

    #[test]
    fn follows_links_with_cycle_guard() {
        let root = tmp();
        let src = root.join("src");
        let shared = root.join("shared");
        write(&src.join("config/a.txt"), "a");
        write(&shared.join("pack/b.txt"), "b");
        assert!(link_dir(&shared, &src.join("config/linked")));
        assert!(link_dir(&src.join("config"), &src.join("config/loop")));
        let mut budget = 1000;
        let f = files(&src, Path::new("config"), &[], &mut budget);
        let rels: Vec<String> = f.iter().map(|e| key(&e.rel)).collect();
        assert!(rels.contains(&"config/a.txt".to_string()), "{rels:?}");
        assert!(rels.contains(&"config/linked/pack/b.txt".to_string()), "{rels:?}");
        assert!(!rels.iter().any(|r| r.contains("loop/loop")), "{rels:?}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn overlays_fill_and_win() {
        let root = tmp();
        let src = root.join("src");
        let master = root.join("master");
        write(&src.join("resourcepacks/own.zip"), "own");
        write(&src.join("resourcepacks/both.zip"), "local");
        write(&master.join("both.zip"), "master");
        write(&master.join("new.zip"), "new");
        write(&root.join("merged.txt"), "fov:1");
        let ov = vec![
            Overlay { rel: PathBuf::from("resourcepacks"), path: master.clone(), prefer: Prefer::Overlay },
            Overlay { rel: PathBuf::from("shaderpacks"), path: root.join("nope"), prefer: Prefer::Overlay },
            Overlay { rel: PathBuf::from("options.txt"), path: root.join("merged.txt"), prefer: Prefer::Overlay },
        ];
        let mut budget = 100;
        let f = files(&src, Path::new("resourcepacks"), &ov, &mut budget);
        let get = |n: &str| f.iter().find(|e| key(&e.rel) == n).map(|e| std::fs::read_to_string(&e.abs).unwrap());
        assert_eq!(get("resourcepacks/own.zip").as_deref(), Some("own"));
        assert_eq!(get("resourcepacks/both.zip").as_deref(), Some("master"));
        assert_eq!(get("resourcepacks/new.zip").as_deref(), Some("new"));
        let mut ov2 = ov.clone();
        ov2[0].prefer = Prefer::Source;
        let f2 = files(&src, Path::new("resourcepacks"), &ov2, &mut budget);
        assert_eq!(std::fs::read_to_string(&f2.iter().find(|e| key(&e.rel) == "resourcepacks/both.zip").unwrap().abs).unwrap(), "local");
        assert_eq!(tops(&src, &ov), vec!["options.txt".to_string(), "resourcepacks".to_string()]);
        assert_eq!(locate(&src, Path::new("options.txt"), &ov), Some(root.join("merged.txt")));
        let o = files(&src, Path::new("options.txt"), &ov, &mut budget);
        assert_eq!(o.len(), 1);
        assert_eq!(key(&o[0].rel), "options.txt");
        assert_eq!(safe_rel("../x"), None);
        assert_eq!(safe_rel("config/xaero"), Some(PathBuf::from("config").join("xaero")));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn children_from_overlay() {
        let root = tmp();
        let src = root.join("src");
        write(&src.join("saves/A/level.dat"), "a");
        write(&root.join("m/B/level.dat"), "b");
        let ov = vec![Overlay { rel: PathBuf::from("saves"), path: root.join("m"), prefer: Prefer::Overlay }];
        assert_eq!(children(&src, Path::new("saves"), &ov), vec!["A".to_string(), "B".to_string()]);
        assert_eq!(locate(&src, Path::new("saves/B"), &ov), Some(root.join("m").join("B")));
        std::fs::remove_dir_all(&root).ok();
    }
}
