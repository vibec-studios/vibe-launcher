use super::*;

// ------------------------------------------------------------------ Aus einer Instanz

pub fn project_type_of_kind(k: ContentKind) -> ProjectType {
    match k {
        ContentKind::Mod => ProjectType::Mod,
        ContentKind::Resourcepack => ProjectType::Resourcepack,
        ContentKind::Shader => ProjectType::Shader,
        ContentKind::Datapack => ProjectType::Datapack,
    }
}

/// Inhalt einer Instanz, der in ein Set übernommen werden kann.
#[derive(Debug, Clone, Serialize)]
pub struct InstanceCandidate {
    pub entry: SetEntry,
    pub kind: ContentKind,
    pub file_name: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstanceCandidates {
    pub items: Vec<InstanceCandidate>,
    /// Dateien ohne bekannte Herkunft (nicht übernehmbar)
    pub unknown: Vec<String>,
}

/// Index-Eintrag -> Set-Eintrag (Schlüssel `mods/x.jar`). `fallback_title`: Name aus den Datei-Metadaten.
pub fn entry_for_key(idx: &ContentIndex, key: &str, fallback_title: Option<&str>) -> Option<(SetEntry, ContentKind)> {
    let e = idx.files.get(key)?;
    let folder = key.split('/').next().unwrap_or_default();
    let kind = ContentKind::from_folder(folder)?;
    let title = e.title.clone().or(fallback_title.map(str::to_string)).unwrap_or_else(|| e.project_id.clone());
    Some((
        SetEntry { source: e.source, project_id: e.project_id.clone(), slug: None, title, icon_url: e.icon_url.clone(), project_type: project_type_of_kind(kind), added: 0 },
        kind,
    ))
}

pub async fn instance_candidates(state: &AppState, instance_id: &str) -> AppResult<InstanceCandidates> {
    state.instances.get(instance_id)?;
    let mut items = Vec::new();
    let mut unknown = Vec::new();
    let mut seen = HashSet::new();
    for k in ContentKind::ALL {
        let (scanned, idx) = crate::content::local::scan(state, instance_id, k).await?;
        for s in scanned {
            match entry_for_key(&idx, &s.key, s.meta.name.as_deref()) {
                Some((entry, kind)) => {
                    if seen.insert(entry.key()) {
                        items.push(InstanceCandidate { entry, kind, file_name: s.file_name.clone(), enabled: s.enabled });
                    }
                }
                None => unknown.push(s.file_name.clone()),
            }
        }
    }
    items.sort_by_key(|a| a.entry.title.to_lowercase());
    Ok(InstanceCandidates { items, unknown })
}
