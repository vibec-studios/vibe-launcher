use crate::instance::LoaderKind;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub(super) struct RawManifest {
    #[serde(default)]
    pub format: String,
    #[serde(default)]
    pub version: Option<u32>,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub loader_version: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub minecraft: Vec<String>,
    #[serde(default)]
    pub mods: String,
    pub profile: Option<RawProfile>,
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct RawProfile {
    #[serde(rename = "mainClass", default)]
    pub main_class: String,
    #[serde(default)]
    pub arguments: Option<RawArguments>,
    #[serde(default)]
    pub libraries: Vec<Library>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub(super) struct RawArguments {
    #[serde(default)]
    pub jvm: Vec<serde_json::Value>,
    #[serde(default)]
    pub game: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Manifest {
    pub format: String,
    pub version: u32,
    pub id: String,
    pub name: String,
    pub loader_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub minecraft: Vec<String>,
    pub mods: LoaderKind,
    pub profile: Profile,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Arguments {
    pub jvm: Vec<String>,
    pub game: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Profile {
    #[serde(rename = "mainClass")]
    pub main_class: String,
    pub arguments: Arguments,
    pub libraries: Vec<Library>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Library {
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha1: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

impl Library {
    pub fn maven_path(&self) -> String {
        crate::paths::maven_path(&self.name).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default()
    }

    pub fn is_local(&self) -> bool {
        self.file.is_some()
    }
}

impl Manifest {
    pub fn supports(&self, mc: &str) -> bool {
        self.minecraft.iter().any(|v| v == mc)
    }
}
