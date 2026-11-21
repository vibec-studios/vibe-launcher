use std::path::{Component, Path, PathBuf};

pub const PROTECTED: &[&str] = &["vibe-server.json"];

#[derive(Debug, PartialEq, Eq)]
pub enum PathError {
    Denied,
    Protected,
}

pub fn clean_rel(rel: &str) -> Result<Vec<String>, PathError> {
    if rel.contains('\0') || rel.contains('\\') || rel.contains(':') {
        return Err(PathError::Denied);
    }
    if rel.starts_with('/') && rel.trim_start_matches('/').is_empty() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for part in rel.split('/') {
        match part {
            "" | "." => continue,
            ".." => return Err(PathError::Denied),
            p => {
                let comps: Vec<_> = Path::new(p).components().collect();
                if comps.len() != 1 || !matches!(comps[0], Component::Normal(_)) {
                    return Err(PathError::Denied);
                }
                out.push(p.to_string());
            }
        }
    }
    Ok(out)
}

fn canonical_base(base: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(base).ok()
}

fn deepest_existing(p: &Path) -> Option<PathBuf> {
    let mut cur = p.to_path_buf();
    loop {
        if let Ok(c) = std::fs::canonicalize(&cur) {
            return Some(c);
        }
        if !cur.pop() {
            return None;
        }
    }
}

pub fn resolve(base: &Path, rel: &str) -> Result<PathBuf, PathError> {
    let parts = clean_rel(rel)?;
    let mut out = base.to_path_buf();
    for p in &parts {
        out.push(p);
    }
    let cbase = canonical_base(base).ok_or(PathError::Denied)?;
    let existing = deepest_existing(&out).ok_or(PathError::Denied)?;
    if !existing.starts_with(&cbase) {
        return Err(PathError::Denied);
    }
    Ok(out)
}

pub fn resolve_writable(base: &Path, rel: &str) -> Result<PathBuf, PathError> {
    let parts = clean_rel(rel)?;
    if parts.is_empty() {
        return Err(PathError::Denied);
    }
    if parts.len() == 1 && PROTECTED.iter().any(|p| p.eq_ignore_ascii_case(&parts[0])) {
        return Err(PathError::Protected);
    }
    resolve(base, rel)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> PathBuf {
        let d = std::env::temp_dir().join(format!("vibe-agent-fs-{}", crate::crypto::new_id("t")));
        std::fs::create_dir_all(d.join("world")).unwrap();
        d
    }

    #[test]
    fn rejects_escapes() {
        let b = base();
        for bad in ["../x", "a/../../x", "..", "C:/Windows", "a\\..\\b", "/../etc", "x\0y"] {
            assert_eq!(resolve(&b, bad), Err(PathError::Denied), "{bad}");
        }
        assert!(resolve(&b, "").is_ok());
        assert!(resolve(&b, "world/level.dat").is_ok());
        assert!(resolve(&b, "/world").is_ok());
        assert!(resolve(&b, "neu/ordner/datei.txt").is_ok());
        let _ = std::fs::remove_dir_all(b);
    }

    #[test]
    fn protects_meta_file() {
        let b = base();
        assert_eq!(resolve_writable(&b, "vibe-server.json"), Err(PathError::Protected));
        assert_eq!(resolve_writable(&b, ""), Err(PathError::Denied));
        assert!(resolve_writable(&b, "config/vibe-server.json").is_ok());
        let _ = std::fs::remove_dir_all(b);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let b = base();
        let outside = std::env::temp_dir().join(format!("vibe-agent-out-{}", crate::crypto::new_id("t")));
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, b.join("link")).unwrap();
        assert_eq!(resolve(&b, "link/secret"), Err(PathError::Denied));
        let _ = std::fs::remove_dir_all(b);
        let _ = std::fs::remove_dir_all(outside);
    }
}
