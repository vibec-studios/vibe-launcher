use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

pub const MB: u64 = 1024 * 1024;
pub const GB: u64 = 1024 * MB;

fn norm(p: &str) -> String {
    let p = p.strip_prefix(r"\\?\").unwrap_or(p).replace('\\', "/");
    if cfg!(windows) { p.to_lowercase() } else { p }
}

pub fn pick_mount<'a>(path: &str, mounts: &'a [(String, u64)]) -> Option<&'a (String, u64)> {
    let p = norm(path);
    mounts.iter().filter(|(m, _)| {
        let m = norm(m);
        let m = m.trim_end_matches('/');
        m.is_empty() || p == m || p.starts_with(&format!("{m}/"))
    }).max_by_key(|(m, _)| norm(m).trim_end_matches('/').len())
}

fn existing_ancestor(p: &Path) -> PathBuf {
    let mut cur = p.to_path_buf();
    loop {
        if cur.exists() {
            return cur.canonicalize().unwrap_or(cur);
        }
        match cur.parent() {
            Some(par) if par != cur => cur = par.to_path_buf(),
            _ => return p.to_path_buf(),
        }
    }
}

fn mounts() -> Vec<(String, u64)> {
    sysinfo::Disks::new_with_refreshed_list().list().iter().map(|d| (d.mount_point().to_string_lossy().to_string(), d.available_space())).collect()
}

pub fn free_bytes(path: &Path) -> Option<(String, u64)> {
    let p = existing_ancestor(path);
    pick_mount(&p.to_string_lossy(), &mounts()).cloned()
}

pub fn dir_size(path: &Path) -> u64 {
    walkdir::WalkDir::new(path).into_iter().flatten().filter(|e| e.file_type().is_file()).filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum()
}

pub fn gb_text(b: u64) -> String {
    format!("{:.1} GB", b as f64 / GB as f64).replace('.', ",")
}

pub fn shortage(free: u64, needed: u64) -> Option<u64> {
    (free < needed).then(|| needed - free)
}

pub fn ensure(path: &Path, needed: u64, what: &str) -> AppResult<()> {
    let Some((mount, free)) = free_bytes(path) else { return Ok(()) };
    if shortage(free, needed).is_some() {
        return Err(AppError::Invalid(format!(
            "Nicht genug Speicherplatz für {what}: Auf {} sind nur noch {} frei, gebraucht werden etwa {}. Mach etwas Platz frei (z. B. alte Downloads oder Instanzen löschen) und versuch es dann noch einmal.",
            mount.trim_end_matches(['\\', '/']),
            gb_text(free),
            gb_text(needed)
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_longest_mount() {
        let m = vec![("/".to_string(), 1), ("/home".to_string(), 2), ("/home/x/data".to_string(), 3)];
        assert_eq!(pick_mount("/home/x/data/VibeLauncher", &m).unwrap().1, 3);
        assert_eq!(pick_mount("/home/y", &m).unwrap().1, 2);
        assert_eq!(pick_mount("/homeless", &m).unwrap().1, 1);
    }

    #[test]
    fn windows_style_paths() {
        let m = vec![(r"C:\".to_string(), 10), (r"D:\".to_string(), 20)];
        if cfg!(windows) {
            assert_eq!(pick_mount(r"\\?\d:\Games\VL", &m).unwrap().1, 20);
            assert_eq!(pick_mount(r"C:\Users\x", &m).unwrap().1, 10);
        }
        assert!(pick_mount(r"E:\x", &m).is_none());
    }

    #[test]
    fn shortage_math() {
        assert_eq!(shortage(5, 3), None);
        assert_eq!(shortage(3, 5), Some(2));
    }

    #[test]
    fn size_of_dir() {
        let d = crate::util::testdir::TestDir::new("disk");
        std::fs::create_dir_all(d.path().join("a/b")).unwrap();
        std::fs::write(d.path().join("a/b/x"), vec![0u8; 1000]).unwrap();
        std::fs::write(d.path().join("y"), vec![0u8; 24]).unwrap();
        assert_eq!(dir_size(d.path()), 1024);
        assert!(free_bytes(d.path()).is_some());
    }
}
