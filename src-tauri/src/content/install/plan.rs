use super::*;

#[derive(Debug, Clone)]
pub struct Planned {
    pub brief: Brief,
    pub source: Source,
    pub kind: ContentKind,
    pub version: ProjectVersion,
    pub file: VersionFile,
    pub side: Option<Side>,
}

impl Planned {
    pub(crate) fn index_entry(&self) -> IndexEntry {
        IndexEntry {
            source: self.source,
            project_id: self.brief.id.clone(),
            version_id: self.version.id.clone(),
            sha1: self.file.sha1.clone(),
            sha512: self.file.sha512.clone(),
            title: Some(self.brief.title.clone()),
            icon_url: self.brief.icon_url.clone(),
            version_number: Some(self.version.version_number.clone()),
            url: self.file.url.clone(),
            size: Some(self.file.size),
            date: Some(self.version.date.clone()),
            release_type: Some(self.version.release_type.clone()),
            side: self.side,
        }
    }
}

pub(super) fn loader_label(inst: &Instance) -> String {
    let l = match inst.loader.kind {
        LoaderKind::Vanilla => "Vanilla",
        LoaderKind::Fabric => "Fabric",
        LoaderKind::Quilt => "Quilt",
        LoaderKind::Forge => "Forge",
        LoaderKind::Neoforge => "NeoForge",
    };
    format!("Minecraft {} ({l})", inst.mc_version)
}

pub(super) fn primary_file(v: &ProjectVersion) -> Option<VersionFile> {
    v.files.iter().find(|f| f.primary).or(v.files.first()).cloned()
}

/// Neueste kompatible Version eines Projekts.
pub(crate) async fn best_version(state: &AppState, inst: &Instance, source: Source, project_id: &str) -> AppResult<Option<ProjectVersion>> {
    let (list, pref, _) = provider::versions_for(state, source, project_id, Some(&inst.mc_version), Some(inst.loader.kind)).await?;
    Ok(provider::pick_best(&list, pref.as_deref()))
}

/// Installationsplan: Wurzelprojekt + rekursiv alle Pflicht-Abhängigkeiten, die noch nicht installiert sind.
pub async fn plan(
    state: &AppState,
    inst: &Instance,
    idx: &ContentIndex,
    roots: Vec<(Source, String, Option<String>)>,
    warnings: &mut Vec<String>,
) -> AppResult<Vec<Planned>> {
    let mut queue: VecDeque<(Source, String, Option<String>, bool)> = roots.into_iter().map(|(s, p, v)| (s, p, v, true)).collect();
    let mut visited: HashSet<(Source, String)> = HashSet::new();
    let mut out: Vec<Planned> = Vec::new();
    let mc = inst.mc_version.clone();
    let loader = inst.loader.kind;

    while let Some((source, pid, vid, root)) = queue.pop_front() {
        state_check_limit(out.len())?;
        let brief = match provider::brief(state, source, &pid).await {
            Ok(b) => b,
            Err(e) if !root => {
                warnings.push(format!("Abhängigkeit {pid} nicht gefunden ({e})"));
                continue;
            }
            Err(e) => return Err(e),
        };
        if !visited.insert((source, brief.id.clone())) {
            continue;
        }
        if !root && idx.has_project(source, &brief.id) {
            continue;
        }
        if brief.project_type == ProjectType::Modpack {
            if root {
                return Err(AppError::Invalid(format!("{} ist ein Modpack und wird als eigene Instanz installiert", brief.title)));
            }
            continue;
        }
        // Version bestimmen
        let mut version: Option<ProjectVersion> = None;
        if let Some(vid) = &vid {
            match provider::version(state, source, &brief.id, vid).await {
                Ok(v) if root || provider::compatible(&v, brief.project_type, &mc, loader) => version = Some(v),
                Ok(_) => {}
                Err(e) if root => return Err(e),
                Err(_) => {}
            }
        }
        if version.is_none() {
            version = match best_version(state, inst, source, &brief.id).await {
                Ok(v) => v,
                Err(e) if root => return Err(e),
                Err(e) => {
                    warnings.push(format!("{}: {e}", brief.title));
                    None
                }
            };
        }
        let Some(version) = version else {
            if root {
                return Err(AppError::NotFound(format!("keine passende Version von {} für {}", brief.title, loader_label(inst))));
            }
            warnings.push(format!("Abhängigkeit {} hat keine Version für {}", brief.title, loader_label(inst)));
            continue;
        };
        let Some(file) = primary_file(&version) else {
            if root {
                return Err(AppError::msg(format!("{}: Version {} enthält keine Datei", brief.title, version.version_number)));
            }
            continue;
        };
        let kind = provider::target_kind(brief.project_type, &version, loader, &mc);
        if kind == ContentKind::Mod && loader == LoaderKind::Vanilla && root {
            return Err(AppError::Invalid("Diese Instanz hat keinen Mod-Loader. Wähle eine Instanz mit Fabric, Quilt, Forge oder NeoForge.".into()));
        }
        // Pflicht-Abhängigkeiten einreihen
        for d in &version.dependencies {
            if d.kind != DependencyKind::Required {
                continue;
            }
            let dsrc = d.source.unwrap_or(source);
            match (&d.project_id, &d.version_id) {
                (Some(p), v) => queue.push_back((dsrc, p.clone(), v.clone(), false)),
                (None, Some(v)) if dsrc == Source::Modrinth => match mr::raw_version(state, v).await {
                    Ok(rv) => queue.push_back((dsrc, rv.project_id.clone(), Some(v.clone()), false)),
                    Err(e) => warnings.push(format!("Abhängigkeit (Version {v}) nicht gefunden: {e}")),
                },
                _ => {}
            }
        }
        let side = brief.side;
        out.push(Planned { brief, source, kind, version, file, side });
    }
    Ok(out)
}
