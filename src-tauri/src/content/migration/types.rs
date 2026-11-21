use super::*;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct GameVersion {
    pub mc_version: String,
    pub loader: Loader,
}

impl From<&Instance> for GameVersion {
    fn from(inst: &Instance) -> Self {
        Self {
            mc_version: inst.mc_version.clone(),
            loader: inst.loader.clone(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Problem {
    Unknown,
    Unavailable,
    Pinned,
    Manual,
    Dependencies,
    Conflict,
    CheckFailed,
}

#[derive(Serialize)]
pub(super) struct PreviewItem {
    pub(super) file_name: String,
    pub(super) title: String,
    pub(super) version: Option<String>,
    pub(super) problem: Option<Problem>,
}

#[derive(Serialize)]
pub struct Preview {
    pub(super) token: String,
    pub(super) items: Vec<PreviewItem>,
    pub(super) dependencies: Vec<String>,
}

pub(super) struct Existing {
    pub(super) scan: local::Scanned,
    pub(super) origin: Option<IndexEntry>,
    pub(super) pinned: bool,
}

impl Existing {
    pub(super) fn project(&self) -> Option<Project> {
        self.origin.as_ref().map(|e| (e.source, e.project_id.clone()))
    }
}

pub(super) struct Selected {
    pub(super) planned: install::Planned,
    pub(super) enabled: bool,
}

pub(super) struct Plan {
    pub(super) before: GameVersion,
    pub(super) files: Vec<Existing>,
    pub(super) selected: Vec<Selected>,
    pub(super) preview: Preview,
}
