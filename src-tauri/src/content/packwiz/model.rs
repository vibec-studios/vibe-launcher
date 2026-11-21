use crate::content::Side;
use crate::error::{AppError, AppResult};
use crate::instance::{Loader, LoaderKind};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct PackToml {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    pub index: IndexRef,
    #[serde(default)]
    pub versions: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct IndexRef {
    pub file: String,
    #[serde(rename = "hash-format", default)]
    pub hash_format: Option<String>,
    #[serde(default)]
    pub hash: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct IndexToml {
    #[serde(rename = "hash-format", default)]
    pub hash_format: Option<String>,
    #[serde(default)]
    pub files: Vec<IndexFile>,
}

#[derive(Debug, Deserialize)]
pub struct IndexFile {
    pub file: String,
    #[serde(default)]
    pub hash: Option<String>,
    #[serde(rename = "hash-format", default)]
    pub hash_format: Option<String>,
    #[serde(default)]
    pub alias: Option<String>,
    #[serde(default)]
    pub metafile: bool,
}

#[derive(Debug, Deserialize)]
pub struct MetaToml {
    #[serde(default)]
    pub name: Option<String>,
    pub filename: String,
    #[serde(default)]
    pub side: Option<String>,
    pub download: MetaDownload,
    #[serde(default)]
    pub update: MetaUpdate,
    #[serde(default)]
    pub option: Option<MetaOption>,
}

#[derive(Debug, Deserialize)]
pub struct MetaDownload {
    #[serde(default)]
    pub url: Option<String>,
    #[serde(rename = "hash-format", default)]
    pub hash_format: Option<String>,
    #[serde(default)]
    pub hash: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct MetaUpdate {
    #[serde(default)]
    pub modrinth: Option<MrUpdate>,
    #[serde(default)]
    pub curseforge: Option<CfUpdate>,
}

#[derive(Debug, Deserialize)]
pub struct MrUpdate {
    #[serde(rename = "mod-id")]
    pub mod_id: String,
    pub version: String,
}

#[derive(Debug, Deserialize)]
pub struct CfUpdate {
    #[serde(rename = "file-id")]
    pub file_id: u64,
    #[serde(rename = "project-id")]
    pub project_id: u64,
}

#[derive(Debug, Deserialize)]
pub struct MetaOption {
    #[serde(default)]
    pub optional: bool,
    #[serde(default)]
    pub default: bool,
}

fn parse<T: serde::de::DeserializeOwned>(bytes: &[u8], what: &str) -> AppResult<T> {
    let text = std::str::from_utf8(bytes).map_err(|_| AppError::Invalid(format!("{what} ist keine Textdatei")))?;
    toml::from_str(text).map_err(|e| AppError::Invalid(format!("{what} ist ungültig: {}", e.message())))
}

pub fn parse_pack(bytes: &[u8]) -> AppResult<PackToml> {
    let p: PackToml = parse(bytes, "pack.toml")?;
    if !p.versions.contains_key("minecraft") {
        return Err(AppError::Invalid("pack.toml enthält keine Minecraft-Version".into()));
    }
    Ok(p)
}

pub fn parse_index(bytes: &[u8]) -> AppResult<IndexToml> {
    parse(bytes, "index.toml")
}

pub fn parse_meta(bytes: &[u8], path: &str) -> AppResult<MetaToml> {
    parse(bytes, path)
}

impl PackToml {
    pub fn mc_version(&self) -> String {
        self.versions.get("minecraft").cloned().unwrap_or_default()
    }

    pub fn loader(&self) -> Loader {
        for (key, kind) in [("neoforge", LoaderKind::Neoforge), ("forge", LoaderKind::Forge), ("quilt", LoaderKind::Quilt), ("fabric", LoaderKind::Fabric)] {
            if let Some(v) = self.versions.get(key).filter(|v| !v.trim().is_empty()) {
                return Loader { kind, version: Some(v.trim().to_string()) };
            }
        }
        Loader { kind: LoaderKind::Vanilla, version: None }
    }
}

impl MetaToml {
    pub fn wanted_on_client(&self) -> bool {
        if self.side.as_deref() == Some("server") {
            return false;
        }
        self.option.as_ref().is_none_or(|o| !o.optional || o.default)
    }

    pub fn side(&self) -> Side {
        match self.side.as_deref() {
            Some("client") => Side::Client,
            Some("server") => Side::Server,
            Some("both") => Side::Both,
            _ => Side::Unknown,
        }
    }

    pub fn is_curseforge_metadata(&self) -> bool {
        self.download.url.is_none() && self.download.mode.as_deref().is_some_and(|m| m.eq_ignore_ascii_case("metadata:curseforge"))
    }
}

pub fn folder_of(rel: &str) -> &str {
    rel.rsplit_once('/').map(|(d, _)| d).unwrap_or("")
}

pub fn join_rel(folder: &str, name: &str) -> String {
    if folder.is_empty() {
        name.to_string()
    } else {
        format!("{folder}/{name}")
    }
}

pub fn valid_rel(rel: &str) -> bool {
    let r = rel.replace('\\', "/");
    !r.is_empty() && !r.starts_with('/') && !r.contains(':') && crate::util::safe_join(std::path::Path::new("base"), &r).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    const PACK: &str = r#"
name = "Testpack"
author = "Henny"
version = "1.2.0"
pack-format = "packwiz:1.1.0"

[index]
file = "index.toml"
hash-format = "sha256"
hash = "abc"

[versions]
minecraft = "1.20.1"
fabric = "0.15.11"
"#;

    const INDEX: &str = r#"
hash-format = "sha256"

[[files]]
file = "config/sodium-options.json"
hash = "11"

[[files]]
file = "mods/sodium.pw.toml"
hash = "22"
metafile = true
"#;

    const META: &str = r#"
name = "Sodium"
filename = "sodium-fabric-0.5.8.jar"
side = "client"

[download]
url = "https://cdn.modrinth.com/data/AANobbMI/versions/b4hTi3mo/sodium-fabric-0.5.8.jar"
hash-format = "sha512"
hash = "ff"

[update.modrinth]
mod-id = "AANobbMI"
version = "b4hTi3mo"
"#;

    const CF_META: &str = r#"
name = "JEI"
filename = "jei.jar"
side = "both"

[download]
hash-format = "murmur2"
hash = "123"
mode = "metadata:curseforge"

[update.curseforge]
file-id = 4712866
project-id = 238222

[option]
optional = true
default = false
"#;

    #[test]
    fn pack_and_loader() {
        let p = parse_pack(PACK.as_bytes()).unwrap();
        assert_eq!(p.name.as_deref(), Some("Testpack"));
        assert_eq!(p.mc_version(), "1.20.1");
        assert_eq!(p.loader(), Loader { kind: LoaderKind::Fabric, version: Some("0.15.11".into()) });
        assert_eq!(p.index.file, "index.toml");
        assert!(parse_pack(b"[index]\nfile = \"index.toml\"\n").is_err());
    }

    #[test]
    fn index_and_meta() {
        let i = parse_index(INDEX.as_bytes()).unwrap();
        assert_eq!(i.files.len(), 2);
        assert!(i.files[1].metafile && !i.files[0].metafile);
        let m = parse_meta(META.as_bytes(), "mods/sodium.pw.toml").unwrap();
        assert!(m.wanted_on_client());
        assert_eq!(m.side(), Side::Client);
        assert_eq!(m.update.modrinth.as_ref().unwrap().version, "b4hTi3mo");
        let cf = parse_meta(CF_META.as_bytes(), "mods/jei.pw.toml").unwrap();
        assert!(cf.is_curseforge_metadata());
        assert!(!cf.wanted_on_client());
        assert_eq!(cf.update.curseforge.as_ref().unwrap().project_id, 238222);
    }

    #[test]
    fn rel_paths() {
        assert_eq!(folder_of("mods/a.pw.toml"), "mods");
        assert_eq!(folder_of("a.pw.toml"), "");
        assert_eq!(join_rel("mods", "a.jar"), "mods/a.jar");
        assert!(valid_rel("config/a.json"));
        assert!(!valid_rel("../evil"));
        assert!(!valid_rel("/etc/passwd"));
        assert!(!valid_rel("C:/x"));
    }
}
