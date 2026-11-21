use crate::error::AppResult;
use crate::paths::Paths;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub created: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct AutoDep {
    pub required_by: BTreeSet<String>,
    pub installed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct OrganizeFile {
    pub format: u32,
    pub groups: Vec<Group>,
    pub members: BTreeMap<String, String>,
    pub tags: BTreeMap<String, BTreeSet<String>>,
    pub auto: BTreeMap<String, AutoDep>,
}

static LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

pub fn path(paths: &Paths, instance_id: &str) -> PathBuf {
    paths.instance_dir(instance_id).join("organize.json")
}

pub fn load(paths: &Paths, instance_id: &str) -> OrganizeFile {
    std::fs::read(path(paths, instance_id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn modify<R>(paths: &Paths, instance_id: &str, f: impl FnOnce(&mut OrganizeFile) -> AppResult<R>) -> AppResult<R> {
    let _g = LOCK.lock();
    let mut file = load(paths, instance_id);
    let before = file.clone();
    let out = f(&mut file)?;
    if file != before && paths.instance_dir(instance_id).exists() {
        file.format = 1;
        crate::util::write_json_atomic(&path(paths, instance_id), &file)?;
    }
    Ok(out)
}

impl OrganizeFile {
    pub fn group_exists(&self, id: &str) -> bool {
        self.groups.iter().any(|g| g.id == id)
    }
}
