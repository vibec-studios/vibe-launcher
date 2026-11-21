use super::cleanup;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub fn files(data: &Path, skip: &HashSet<String>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Some(data.join("meta").join("cds")).filter(|p| p.exists()).into_iter().collect();
    if let Ok(rd) = std::fs::read_dir(data.join("instances")) {
        for e in rd.flatten().filter(|e| !skip.contains(&e.file_name().to_string_lossy().to_string())) {
            out.extend(crate::minecraft::cds::instance_files(&e.path().join("minecraft")));
        }
    }
    out
}

pub fn bytes(data: &Path, skip: &HashSet<String>) -> u64 {
    files(data, skip).iter().map(|p| cleanup::size_of(p)).sum()
}

pub fn clear(data: &Path, skip: &HashSet<String>) -> u64 {
    files(data, skip).iter().map(|p| cleanup::remove(p)).sum()
}
