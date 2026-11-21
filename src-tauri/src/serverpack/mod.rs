pub mod bundle;
pub mod filter;
pub mod place;
pub mod read;
pub mod run;
pub mod snapshot;

use crate::content::Side;
use crate::instance::Loader;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PackInput {
    Instance { id: String },
    File { path: String },
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EntryOrigin {
    Download,
    Local,
    Archive,
}

#[derive(Debug, Clone, Serialize)]
pub struct PackEntry {
    pub path: String,
    pub name: String,
    pub side: Side,
    pub enabled: bool,
    pub include: bool,
    pub origin: EntryOrigin,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TargetDiff {
    pub server_id: String,
    pub name: String,
    pub mc_from: String,
    pub loader_from: Loader,
    pub platform: Option<String>,
    pub changes_software: bool,
    pub running: bool,
    pub managed: Option<String>,
    pub removes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PackPreview {
    pub name: String,
    pub version_name: Option<String>,
    pub format: &'static str,
    pub mc_version: String,
    pub loader: Loader,
    pub entries: Vec<PackEntry>,
    pub config_files: u32,
    pub config_dirs: Vec<String>,
    pub client_skipped: u32,
    pub missing: Vec<String>,
    pub warnings: Vec<String>,
    pub worlds: Vec<String>,
    pub target: Option<TargetDiff>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ApplyTarget {
    New {
        name: String,
        #[serde(default)]
        port: Option<u16>,
        #[serde(default)]
        memory_mb: Option<u32>,
    },
    Existing {
        id: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
pub struct PackOptions {
    #[serde(default)]
    pub selected: Option<Vec<String>>,
    #[serde(default = "yes")]
    pub configs: bool,
    #[serde(default)]
    pub world: Option<String>,
}

impl Default for PackOptions {
    fn default() -> Self {
        PackOptions { selected: None, configs: true, world: None }
    }
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct PackApply {
    pub input: PackInput,
    pub target: ApplyTarget,
    #[serde(default)]
    pub options: PackOptions,
}

#[derive(Debug, Clone, Serialize)]
pub struct PackApplied {
    pub server_id: String,
    pub task_id: String,
}
