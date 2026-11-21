use super::*;

// ------------------------------------------------------------------ Formate

#[derive(Deserialize)]
pub(super) struct MrIndex {
    #[serde(default)]
    pub(super) name: String,
    #[serde(rename = "versionId", default)]
    pub(super) version_id: Option<String>,
    #[serde(default)]
    pub(super) files: Vec<MrIndexFile>,
    #[serde(default)]
    pub(super) dependencies: HashMap<String, String>,
}

#[derive(Deserialize)]
pub(super) struct MrIndexFile {
    pub(super) path: String,
    #[serde(default)]
    pub(super) hashes: HashMap<String, String>,
    #[serde(default)]
    pub(super) env: Option<HashMap<String, String>>,
    #[serde(default)]
    pub(super) downloads: Vec<String>,
    #[serde(rename = "fileSize", default)]
    pub(super) file_size: Option<u64>,
}

#[derive(Deserialize)]
pub(super) struct CfManifest {
    pub(super) minecraft: CfManifestMc,
    #[serde(default)]
    pub(super) name: String,
    #[serde(default)]
    pub(super) version: Option<String>,
    #[serde(default)]
    pub(super) author: Option<String>,
    #[serde(default)]
    pub(super) files: Vec<CfManifestFile>,
    #[serde(default)]
    pub(super) overrides: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct CfManifestMc {
    pub(super) version: String,
    #[serde(rename = "modLoaders", default)]
    pub(super) mod_loaders: Vec<CfManifestLoader>,
}

#[derive(Deserialize)]
pub(super) struct CfManifestLoader {
    pub(super) id: String,
    #[serde(default)]
    pub(super) primary: bool,
}

#[derive(Deserialize)]
pub(super) struct CfManifestFile {
    #[serde(rename = "projectID")]
    pub(super) project_id: u64,
    #[serde(rename = "fileID")]
    pub(super) file_id: u64,
    #[serde(default = "yes")]
    pub(super) required: bool,
}

pub(super) fn yes() -> bool {
    true
}

/// `vlpack.json` (siehe docs/VLPACK.md).
#[derive(Debug, Deserialize, serde::Serialize)]
pub struct VlPack {
    pub format_version: u32,
    pub name: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub mc_version: String,
    pub loader: Loader,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub files: Vec<VlFile>,
}

#[derive(Debug, Deserialize, serde::Serialize, Clone)]
pub struct VlFile {
    pub path: String,
    /// "modrinth" | "curseforge" | "url"
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_id: Option<String>,
    pub url: String,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
}
