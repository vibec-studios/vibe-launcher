use super::cleanup;
use std::path::{Path, PathBuf};

const DATA_DIR: &str = "vibey";
const STATE_FILE: &str = "vibey-client.json";

pub fn data_dir(data: &Path) -> PathBuf {
    data.join(DATA_DIR)
}

pub fn leftovers(data: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Some(data_dir(data)).filter(|p| p.exists()).into_iter().collect();
    if let Ok(rd) = std::fs::read_dir(data.join("instances")) {
        out.extend(rd.flatten().map(|e| e.path().join(STATE_FILE)).filter(|p| p.is_file()));
    }
    out
}

pub fn bytes(data: &Path) -> u64 {
    leftovers(data).iter().map(|p| cleanup::size_of(p)).sum()
}

pub fn clear(data: &Path) -> u64 {
    leftovers(data).iter().map(|p| cleanup::remove(p)).sum()
}
