use crate::error::{AppError, AppResult};
use crate::paths::location::POINTER_FILE;
use std::path::{Path, PathBuf};

const SKIP_REWRITE: &[&str] = &["meta", "cache", "java", "logs"];

fn canon(p: &Path) -> PathBuf {
    let mut cur = p.to_path_buf();
    let mut tail = Vec::new();
    while !cur.exists() {
        match (cur.file_name().map(|n| n.to_os_string()), cur.parent()) {
            (Some(n), Some(par)) => {
                tail.push(n);
                cur = par.to_path_buf();
            }
            _ => return p.to_path_buf(),
        }
    }
    let mut out = cur.canonicalize().unwrap_or(cur);
    for n in tail.into_iter().rev() {
        out.push(n);
    }
    out
}

pub fn is_inside(a: &Path, b: &Path) -> bool {
    let (a, b) = (canon(a), canon(b));
    let (a, b) = (a.to_string_lossy().to_lowercase(), b.to_string_lossy().to_lowercase());
    a == b || a.starts_with(&format!("{}{}", b.trim_end_matches(['\\', '/']), std::path::MAIN_SEPARATOR))
}

pub fn only_pointer(dir: &Path) -> bool {
    std::fs::read_dir(dir).map(|rd| rd.flatten().all(|e| e.file_name() == POINTER_FILE)).unwrap_or(true)
}

pub fn validate_target(current: &Path, target: &Path) -> AppResult<()> {
    if !target.is_absolute() {
        return Err(AppError::Invalid("Bitte wähle einen vollständigen Ordnerpfad.".into()));
    }
    if is_inside(target, current) || is_inside(current, target) {
        return Err(AppError::Invalid("Der neue Ort darf nicht im aktuellen Datenordner liegen (und umgekehrt).".into()));
    }
    if target.is_file() {
        return Err(AppError::Invalid("Am gewählten Ort liegt eine Datei.".into()));
    }
    if target.is_dir() && !only_pointer(target) {
        return Err(AppError::Invalid("Der gewählte Ordner ist nicht leer. Wähle einen leeren Ordner oder lege einen neuen an.".into()));
    }
    Ok(())
}

pub fn copy_all(src: &Path, dst: &Path, on_bytes: &dyn Fn(u64), cancelled: &dyn Fn() -> bool) -> AppResult<(u64, u64)> {
    std::fs::create_dir_all(dst)?;
    let (mut files, mut bytes) = (0u64, 0u64);
    for entry in walkdir::WalkDir::new(src).min_depth(1) {
        if cancelled() {
            return Err(AppError::Cancelled);
        }
        let entry = entry.map_err(|e| AppError::msg(e.to_string()))?;
        let rel = entry.path().strip_prefix(src).map_err(|e| AppError::msg(e.to_string()))?;
        if rel == Path::new(POINTER_FILE) {
            continue;
        }
        let to = dst.join(rel);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&to)?;
        } else if entry.file_type().is_file() {
            let n = std::fs::copy(entry.path(), &to).map_err(|e| AppError::msg(format!("{} konnte nicht kopiert werden: {e}", rel.display())))?;
            files += 1;
            bytes += n;
            on_bytes(n);
        }
    }
    Ok((files, bytes))
}

pub fn tally(dir: &Path) -> (u64, u64) {
    walkdir::WalkDir::new(dir)
        .min_depth(1)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file() && e.path().strip_prefix(dir).ok() != Some(Path::new(POINTER_FILE)))
        .filter_map(|e| e.metadata().ok())
        .fold((0, 0), |(f, b), m| (f + 1, b + m.len()))
}

pub fn rollback(dst: &Path, created: bool) {
    if created {
        let _ = std::fs::remove_dir_all(dst);
        return;
    }
    if let Ok(rd) = std::fs::read_dir(dst) {
        for e in rd.flatten().filter(|e| e.file_name() != POINTER_FILE) {
            let p = e.path();
            let _ = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
        }
    }
}

fn json_escaped(p: &Path) -> String {
    let s = serde_json::to_string(&p.to_string_lossy()).unwrap_or_default();
    s.trim_matches('"').to_string()
}

pub fn rewrite_paths(root: &Path, old: &Path, new: &Path) -> usize {
    let (from, to) = (json_escaped(old), json_escaped(new));
    if from.is_empty() || from == to {
        return 0;
    }
    let mut n = 0;
    let walker = walkdir::WalkDir::new(root).max_depth(4).into_iter().filter_entry(|e| {
        let rel = e.path().strip_prefix(root).unwrap_or(e.path());
        let first = rel.components().next().map(|c| c.as_os_str().to_string_lossy().to_string()).unwrap_or_default();
        !SKIP_REWRITE.contains(&first.as_str()) && e.file_name() != "minecraft"
    });
    for e in walker.flatten().filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|x| x == "json")) {
        let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
        if !text.contains(&from) {
            continue;
        }
        if std::fs::write(e.path(), text.replace(&from, &to)).is_ok() {
            n += 1;
        }
    }
    n
}

pub fn cleanup_old(old: &Path, current: &Path, default_root: &Path) -> AppResult<()> {
    if is_inside(old, current) || is_inside(current, old) || !old.join("settings.json").is_file() || !current.join("settings.json").is_file() {
        return Ok(());
    }
    if canon(old) == canon(default_root) {
        rollback(old, false);
    } else {
        std::fs::remove_dir_all(old)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::testdir::TestDir;

    fn sample(root: &Path) {
        std::fs::create_dir_all(root.join("instances/a/minecraft/mods")).unwrap();
        std::fs::write(root.join("settings.json"), "{}").unwrap();
        std::fs::write(root.join(POINTER_FILE), "{}").unwrap();
        std::fs::write(root.join("instances/a/minecraft/mods/x.jar"), vec![1u8; 100]).unwrap();
    }

    #[test]
    fn rejects_nested_and_nonempty() {
        let d = TestDir::new("mv");
        let cur = d.path().join("cur");
        sample(&cur);
        assert!(validate_target(&cur, &cur.join("sub")).is_err());
        assert!(validate_target(&cur.join("instances"), &cur).is_err());
        let full = d.path().join("full");
        std::fs::create_dir_all(&full).unwrap();
        std::fs::write(full.join("x"), "1").unwrap();
        assert!(validate_target(&cur, &full).is_err());
        assert!(validate_target(&cur, &d.path().join("new")).is_ok());
        let ptr_only = d.path().join("ptr");
        std::fs::create_dir_all(&ptr_only).unwrap();
        std::fs::write(ptr_only.join(POINTER_FILE), "{}").unwrap();
        assert!(validate_target(&cur, &ptr_only).is_ok());
    }

    #[test]
    fn copies_without_pointer_and_rolls_back() {
        let d = TestDir::new("mv");
        let (cur, dst) = (d.path().join("cur"), d.path().join("dst"));
        sample(&cur);
        let (files, bytes) = copy_all(&cur, &dst, &|_| {}, &|| false).unwrap();
        assert_eq!((files, bytes), tally(&cur));
        assert_eq!(tally(&dst), tally(&cur));
        assert!(!dst.join(POINTER_FILE).exists());
        rollback(&dst, true);
        assert!(!dst.exists());
        assert!(matches!(copy_all(&cur, &dst, &|_| {}, &|| true), Err(AppError::Cancelled)));
    }

    #[test]
    fn rewrites_json_paths_but_not_game_files() {
        let d = TestDir::new("mv");
        let (old, new) = (d.path().join("old"), d.path().join("new"));
        std::fs::create_dir_all(new.join("instances/a/minecraft")).unwrap();
        let p = |r: &Path| json_escaped(&r.join("java"));
        std::fs::write(new.join("settings.json"), format!("{{\"j\":\"{}\"}}", p(&old))).unwrap();
        std::fs::write(new.join("instances/a/minecraft/x.json"), format!("{{\"j\":\"{}\"}}", p(&old))).unwrap();
        assert_eq!(rewrite_paths(&new, &old, &new), 1);
        assert!(std::fs::read_to_string(new.join("settings.json")).unwrap().contains(&p(&new)));
        assert!(std::fs::read_to_string(new.join("instances/a/minecraft/x.json")).unwrap().contains(&p(&old)));
    }

    #[test]
    fn cleanup_keeps_pointer_in_default_root() {
        let d = TestDir::new("mv");
        let (def, new) = (d.path().join("def"), d.path().join("new"));
        sample(&def);
        sample(&new);
        cleanup_old(&def, &new, &def).unwrap();
        assert!(def.join(POINTER_FILE).is_file());
        assert!(!def.join("settings.json").exists());
        assert!(new.join("settings.json").is_file());
        let other = d.path().join("other");
        sample(&other);
        cleanup_old(&other, &new, &def).unwrap();
        assert!(!other.exists());
    }
}
