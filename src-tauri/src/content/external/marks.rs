use super::*;

/// Merker: aus welchem Ordner wurde eine Instanz importiert (`instances/<id>/external.json`).
#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct ExternalMark {
    pub launcher: LauncherKind,
    pub source_path: String,
    pub imported_at: i64,
    /// Beim Import übernommene Einträge der obersten Ebene des Spielordners (für den Nachimport: in Vibe
    /// gelöschte Einträge nicht erneut vorschlagen). Fehlt bei älteren Importen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copied: Option<Vec<String>>,
}

impl ExternalMark {
    pub fn prior(&self) -> crate::content::gamedata::Prior {
        crate::content::gamedata::Prior { launcher: Some(self.launcher), imported_at: self.imported_at, copied: self.copied.clone() }
    }
}

pub(crate) fn read_mark(state: &AppState, instance_id: &str) -> Option<ExternalMark> {
    let p = state.paths.instance_dir(instance_id).join("external.json");
    serde_json::from_slice(&std::fs::read(p).ok()?).ok()
}

pub(crate) fn write_mark(state: &AppState, instance_id: &str, launcher: LauncherKind, source_path: &str, copied: Vec<String>) -> AppResult<()> {
    crate::util::write_json_atomic(
        &state.paths.instance_dir(instance_id).join("external.json"),
        &ExternalMark { launcher, source_path: source_path.to_string(), imported_at: crate::util::now_ms(), copied: Some(copied) },
    )
}

pub(super) fn imported_map(state: &AppState) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for inst in state.instances.list() {
        if let Some(mark) = read_mark(state, &inst.id) {
            m.insert(norm(&mark.source_path), inst.id.clone());
        }
    }
    m
}

pub(super) fn mark_imported(state: &AppState, list: &mut [ExternalLauncher]) {
    let m = imported_map(state);
    for l in list {
        for i in &mut l.instances {
            i.imported_as = m.get(&norm(&i.source_path)).cloned();
        }
    }
}
