use crate::paths::Paths;
use std::path::PathBuf;

pub mod commands;
mod guard;
mod issue;
mod install;
mod limits;
mod manifest;
mod pack;
mod store;
mod validate;

pub use install::{ensure_profile, resolve, version_id};
pub use guard::{block, label};
pub use issue::PackIssue;
pub use manifest::{Library, Manifest, Profile};
pub use pack::{inspect, PackPreview, RemoteLibrary};
pub use store::{delete, import, list, load, InstalledPack};

pub const FORMAT: &str = "vibe-launcher-loader";
pub const FORMAT_VERSION: u32 = 1;
pub const MANIFEST: &str = "vibeloader.json";

pub fn root(paths: &Paths) -> PathBuf {
    paths.root.join("loaders")
}

pub fn pack_dir(paths: &Paths, id: &str, version: &str) -> PathBuf {
    root(paths).join(id).join(version)
}

#[cfg(test)]
mod tests;
