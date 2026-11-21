use super::*;

// ------------------------------------------------------------------ Rohdaten

#[derive(Debug, Deserialize)]
pub struct CfData<T> {
    pub data: T,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct CfPagination {
    pub index: u32,
    pub page_size: u32,
    pub result_count: u32,
    pub total_count: u64,
}

#[derive(Debug, Deserialize)]
pub struct CfPage<T> {
    pub data: Vec<T>,
    #[serde(default)]
    pub pagination: CfPagination,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct CfLinks {
    pub website_url: Option<String>,
    pub wiki_url: Option<String>,
    pub issues_url: Option<String>,
    pub source_url: Option<String>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct CfCategory {
    pub id: u64,
    pub name: String,
    pub slug: String,
    pub icon_url: Option<String>,
    pub class_id: Option<u32>,
    pub parent_category_id: Option<u64>,
    pub is_class: Option<bool>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default)]
pub struct CfAuthor {
    pub name: String,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct CfAsset {
    pub title: Option<String>,
    pub description: Option<String>,
    pub thumbnail_url: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct CfFileIndex {
    pub game_version: String,
    pub file_id: u64,
    pub release_type: u32,
    pub mod_loader: Option<u32>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct CfMod {
    pub id: u64,
    pub name: String,
    pub slug: String,
    pub links: CfLinks,
    pub summary: String,
    pub download_count: f64,
    pub categories: Vec<CfCategory>,
    pub class_id: Option<u32>,
    pub authors: Vec<CfAuthor>,
    pub logo: Option<CfAsset>,
    pub screenshots: Vec<CfAsset>,
    pub latest_files_indexes: Vec<CfFileIndex>,
    pub date_created: Option<String>,
    pub date_modified: Option<String>,
    pub date_released: Option<String>,
    pub thumbs_up_count: u64,
    pub allow_mod_distribution: Option<bool>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default)]
pub struct CfHash {
    pub value: String,
    /// 1 = SHA-1, 2 = MD5
    pub algo: u32,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct CfDependency {
    pub mod_id: u64,
    /// 1 Embedded, 2 Optional, 3 Required, 4 Tool, 5 Incompatible, 6 Include
    pub relation_type: u32,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct CfFile {
    pub id: u64,
    pub mod_id: u64,
    pub is_available: Option<bool>,
    pub display_name: String,
    pub file_name: String,
    /// 1 Release, 2 Beta, 3 Alpha
    pub release_type: u32,
    pub hashes: Vec<CfHash>,
    pub file_date: String,
    pub file_length: u64,
    pub download_count: f64,
    pub download_url: Option<String>,
    pub game_versions: Vec<String>,
    pub dependencies: Vec<CfDependency>,
    pub is_server_pack: Option<bool>,
    pub file_fingerprint: u64,
}

impl CfFile {
    pub fn sha1(&self) -> Option<String> {
        self.hashes.iter().find(|h| h.algo == 1).map(|h| h.value.to_ascii_lowercase())
    }
    /// Download über Drittanbieter gesperrt (keine `downloadUrl`)?
    pub fn locked(&self) -> bool {
        self.download_url.as_deref().map_or(true, str::is_empty)
    }
}

/// Fingerprint als 32-Bit-Wert (CurseForge liefert ihn als Zahl; 0 = unbekannt).
pub fn fingerprint32(fp: u64) -> Option<u32> {
    (fp > 0 && fp <= u32::MAX as u64).then_some(fp as u32)
}

/// Erlaubt der Autor keine Downloads über andere Launcher? (`allowModDistribution == false`;
/// `null` bei alten Projekten gilt als erlaubt – gesperrte Dateien erkennt man dann an `downloadUrl == null`.)
pub fn manual_only(m: &CfMod) -> bool {
    m.allow_mod_distribution == Some(false)
}

#[derive(Debug, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct CfFingerprintMatch {
    pub id: u64,
    pub file: CfFile,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct CfFingerprintResult {
    pub exact_matches: Vec<CfFingerprintMatch>,
}
