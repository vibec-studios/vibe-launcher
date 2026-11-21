use super::*;

// ------------------------------------------------------------------ Rohdaten

#[derive(Debug, Deserialize)]
pub(super) struct MrSearch {
    #[serde(default)]
    pub(super) hits: Vec<MrHit>,
    #[serde(default)]
    pub(super) total_hits: u64,
}

#[derive(Debug, Deserialize)]
pub(super) struct MrHit {
    pub(super) project_id: String,
    #[serde(default)]
    pub(super) slug: Option<String>,
    #[serde(default)]
    pub(super) title: String,
    #[serde(default)]
    pub(super) description: String,
    #[serde(default)]
    pub(super) author: String,
    #[serde(default)]
    pub(super) icon_url: Option<String>,
    #[serde(default)]
    pub(super) downloads: u64,
    #[serde(default)]
    pub(super) follows: u64,
    #[serde(default)]
    pub(super) categories: Vec<String>,
    #[serde(default)]
    pub(super) display_categories: Vec<String>,
    #[serde(default)]
    pub(super) project_type: String,
    #[serde(default)]
    pub(super) date_modified: Option<String>,
    #[serde(default)]
    pub(super) versions: Vec<String>,
    #[serde(default)]
    pub(super) featured_gallery: Option<String>,
    #[serde(default)]
    pub(super) gallery: Vec<String>,
    #[serde(default)]
    pub(super) color: Option<u32>,
    #[serde(default)]
    pub(super) date_created: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct MrMember {
    #[serde(default)]
    pub(super) role: String,
    #[serde(default)]
    pub(super) is_owner: bool,
    pub(super) user: MrUser,
}

#[derive(Debug, Deserialize)]
pub(super) struct MrUser {
    #[serde(default)]
    pub(super) username: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct MrCategory {
    #[serde(default)]
    pub(super) icon: Option<String>,
    pub(super) name: String,
    #[serde(default)]
    pub(super) project_type: String,
    #[serde(default)]
    pub(super) header: String,
}
