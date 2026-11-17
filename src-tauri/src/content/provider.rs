//! Gemeinsame Schicht über Modrinth und CurseForge (Suche, Details, Versionen mit Kompatibilitätsfilter).
use super::{curseforge as cf, modrinth as mr, *};
use crate::error::AppResult;
use crate::state::AppState;

/// Kurzinfo zu einem Projekt (für Installation/Index).
#[derive(Debug, Clone)]
pub struct Brief {
    /// Kanonische ID (Slugs werden aufgelöst)
    pub id: String,
    pub title: String,
    pub icon_url: Option<String>,
    pub project_type: ProjectType,
    pub page_url: String,
    /// Client/Server, falls bekannt
    pub side: Option<Side>,
}

pub async fn search(state: &AppState, q: &SearchQuery) -> AppResult<SearchResult> {
    match q.source {
        Source::Modrinth => mr::search(state, q).await,
        Source::Curseforge => cf::search(state, q).await,
        Source::Store(k) => super::store::search(state, k, q).await,
    }
}

pub async fn categories(state: &AppState, source: Source, pt: ProjectType) -> AppResult<Vec<Category>> {
    match source {
        Source::Modrinth => mr::categories(state, pt).await,
        Source::Curseforge => cf::categories(state, pt).await,
        Source::Store(k) => super::store::categories(state, k, pt).await,
    }
}

pub async fn project(state: &AppState, source: Source, id: &str) -> AppResult<ProjectDetails> {
    match source {
        Source::Modrinth => mr::project(state, id).await,
        Source::Curseforge => cf::project(state, id).await,
        Source::Store(k) => super::store::project(state, k, id).await,
    }
}

pub async fn brief(state: &AppState, source: Source, id: &str) -> AppResult<Brief> {
    match source {
        Source::Modrinth => {
            let p = mr::raw_project(state, id).await?;
            let hit = mr::project_to_hit(&p, String::new());
            let side = Some(super::sides::from_sides(p.client_side.as_deref(), p.server_side.as_deref()));
            Ok(Brief { page_url: mr::page_url(hit.project_type, &p.slug), id: p.id, title: p.title, icon_url: hit.icon_url, project_type: hit.project_type, side })
        }
        Source::Curseforge => {
            let m = cf::raw_mod(state, id).await?;
            let hit = cf::mod_to_hit(&m);
            Ok(Brief { page_url: cf::page_url(&m), id: hit.id, title: hit.title, icon_url: hit.icon_url, project_type: hit.project_type, side: None })
        }
        Source::Store(k) => super::store::brief(state, k, id).await,
    }
}

/// Erlaubte Modrinth-Loader für Projekttyp + Instanz-Loader. `None` = keine Einschränkung.
/// Erstes Element: bevorzugte Loader, zweites: Ausweichlösung (z. B. Datapack-Variante eines Mods).
pub fn modrinth_loaders(pt: ProjectType, loader: LoaderKind, mc: &str) -> Option<(Vec<String>, Vec<String>)> {
    let mod_loaders: Vec<&str> = match loader {
        LoaderKind::Vanilla => vec![],
        LoaderKind::Fabric => vec!["fabric"],
        LoaderKind::Quilt => vec!["quilt", "fabric"],
        LoaderKind::Forge => vec!["forge"],
        LoaderKind::Neoforge if mc == "1.20.1" => vec!["neoforge", "forge"],
        LoaderKind::Neoforge => vec!["neoforge"],
    };
    let own = |v: Vec<&str>| v.into_iter().map(str::to_string).collect::<Vec<_>>();
    match pt {
        ProjectType::Mod | ProjectType::Datapack => Some((own(mod_loaders), vec!["datapack".to_string()])),
        ProjectType::Modpack => {
            if loader == LoaderKind::Vanilla {
                None
            } else {
                Some((own(mod_loaders), vec![]))
            }
        }
        ProjectType::Resourcepack | ProjectType::Shader => None,
    }
}

/// Bevorzugt Loader-Treffer, dann Releases, dann neueste.
pub fn pick_best(versions: &[ProjectVersion], preferred: Option<&[String]>) -> Option<ProjectVersion> {
    let matches_pref = |v: &ProjectVersion| preferred.map_or(true, |p| p.is_empty() || v.loaders.iter().any(|l| p.contains(l)));
    // (Loader muss passen, nur Releases) in absteigender Priorität
    for (need_pref, need_release) in [(true, true), (true, false), (false, true), (false, false)] {
        if let Some(v) = versions.iter().find(|v| (!need_pref || matches_pref(v)) && (!need_release || v.release_type == "release")) {
            return Some(v.clone());
        }
    }
    None
}

fn sort_desc(v: &mut [ProjectVersion]) {
    v.sort_by(|a, b| b.date.cmp(&a.date));
}

/// Versionen eines Projekts, gefiltert nach Minecraft-Version und Loader (passend zum Projekttyp).
/// Neueste zuerst. Zusätzlich: bevorzugte Loader (für `pick_best`).
pub async fn versions_for(
    state: &AppState,
    source: Source,
    id: &str,
    mc: Option<&str>,
    loader: Option<LoaderKind>,
) -> AppResult<(Vec<ProjectVersion>, Option<Vec<String>>, ProjectType)> {
    match source {
        Source::Modrinth => {
            let p = mr::raw_project(state, id).await?;
            let pt = mr::project_to_hit(&p, String::new()).project_type;
            let raw = mr::raw_versions(state, &p.id).await?;
            let sets = loader.and_then(|l| modrinth_loaders(pt, l, mc.unwrap_or("")));
            let mut out: Vec<ProjectVersion> = raw
                .into_iter()
                .filter(|v| mc.map_or(true, |mc| v.game_versions.iter().any(|g| g == mc)))
                .filter(|v| match &sets {
                    None => true,
                    Some((a, b)) => v.loaders.iter().any(|l| a.contains(l) || b.contains(l)),
                })
                .map(mr::convert_version)
                .collect();
            sort_desc(&mut out);
            Ok((out, sets.map(|(a, _)| a), pt))
        }
        Source::Curseforge => {
            let m = cf::raw_mod(state, id).await?;
            let pt = cf::project_type_of_class(m.class_id);
            let loader_filter = if matches!(pt, ProjectType::Mod | ProjectType::Modpack) { loader } else { None };
            let mut files = cf::raw_files(state, id, mc, loader_filter).await?;
            files.retain(|f| cf::file_compatible(f, mc, loader_filter));
            cf::sort_files(&mut files);
            Ok((files.iter().map(cf::convert_file).collect(), None, pt))
        }
        Source::Store(k) => {
            let (all, pt) = super::store::versions(state, k, id).await?;
            let sets = loader.and_then(|l| modrinth_loaders(pt, l, mc.unwrap_or("")));
            let out: Vec<ProjectVersion> = all
                .into_iter()
                .filter(|v| mc.map_or(true, |mc| v.game_versions.iter().any(|g| g == mc)))
                .filter(|v| match &sets {
                    None => true,
                    Some((a, b)) => v.loaders.iter().any(|l| a.contains(l) || b.contains(l)),
                })
                .collect();
            Ok((out, sets.map(|(a, _)| a), pt))
        }
    }
}

/// Einzelne Version laden.
pub async fn version(state: &AppState, source: Source, project_id: &str, version_id: &str) -> AppResult<ProjectVersion> {
    match source {
        Source::Modrinth => Ok(mr::convert_version(mr::raw_version(state, version_id).await?)),
        Source::Curseforge => {
            let f = cf::raw_file(state, project_id, version_id).await?;
            let mut v = cf::convert_file(&f);
            if let Ok(c) = cf::changelog(state, project_id, version_id).await {
                v.changelog = Some(c).filter(|c| !c.trim().is_empty());
            }
            Ok(v)
        }
        Source::Store(k) => super::store::version(state, k, project_id, version_id).await,
    }
}

/// Ist eine Version mit der Instanz kompatibel?
pub fn compatible(v: &ProjectVersion, pt: ProjectType, mc: &str, loader: LoaderKind) -> bool {
    if !v.game_versions.iter().any(|g| g == mc) {
        return false;
    }
    match v.source {
        Source::Modrinth | Source::Store(_) => match modrinth_loaders(pt, loader, mc) {
            None => true,
            Some((a, b)) => v.loaders.iter().any(|l| a.contains(l) || b.contains(l)),
        },
        Source::Curseforge => {
            if !matches!(pt, ProjectType::Mod | ProjectType::Modpack) || loader == LoaderKind::Vanilla {
                return true;
            }
            let ok: &[&str] = match loader {
                LoaderKind::Fabric => &["fabric"],
                LoaderKind::Quilt => &["quilt", "fabric"],
                LoaderKind::Forge => &["forge"],
                LoaderKind::Neoforge if mc == "1.20.1" => &["neoforge", "forge"],
                LoaderKind::Neoforge => &["neoforge"],
                LoaderKind::Vanilla => &[],
            };
            v.loaders.is_empty() && loader == LoaderKind::Forge || v.loaders.iter().any(|l| ok.contains(&l.as_str()))
        }
    }
}

/// Zielordner für eine Version. Mod-Loader-Varianten gehen nach mods/, reine Datapacks nach datapacks/.
pub fn target_kind(pt: ProjectType, v: &ProjectVersion, loader: LoaderKind, mc: &str) -> ContentKind {
    match pt {
        ProjectType::Resourcepack => ContentKind::Resourcepack,
        ProjectType::Shader => ContentKind::Shader,
        ProjectType::Mod | ProjectType::Datapack | ProjectType::Modpack => {
            if v.source == Source::Curseforge {
                return if pt == ProjectType::Datapack { ContentKind::Datapack } else { ContentKind::Mod };
            }
            let mod_loaders = modrinth_loaders(ProjectType::Mod, loader, mc).map(|(a, _)| a).unwrap_or_default();
            if v.loaders.iter().any(|l| mod_loaders.contains(l)) {
                ContentKind::Mod
            } else if v.loaders.iter().any(|l| l == "datapack") {
                ContentKind::Datapack
            } else {
                ContentKind::Mod
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(id: &str, date: &str, rt: &str, loaders: &[&str]) -> ProjectVersion {
        ProjectVersion {
            source: Source::Modrinth,
            id: id.into(),
            project_id: "p".into(),
            name: id.into(),
            version_number: id.into(),
            game_versions: vec!["1.20.1".into()],
            loaders: loaders.iter().map(|s| s.to_string()).collect(),
            release_type: rt.into(),
            date: date.into(),
            downloads: 0,
            files: vec![],
            dependencies: vec![],
            changelog: None,
        }
    }

    #[test]
    fn best_version() {
        let list = vec![
            v("dp", "2024-03", "release", &["datapack"]),
            v("beta", "2024-02", "beta", &["fabric"]),
            v("rel", "2024-01", "release", &["fabric", "quilt"]),
        ];
        let pref = vec!["quilt".to_string(), "fabric".to_string()];
        assert_eq!(pick_best(&list, Some(&pref)).unwrap().id, "rel");
        assert_eq!(pick_best(&list[1..2], Some(&pref)).unwrap().id, "beta");
        assert_eq!(pick_best(&list[0..1], Some(&pref)).unwrap().id, "dp");
    }

    #[test]
    fn loaders_mapping() {
        let (a, b) = modrinth_loaders(ProjectType::Mod, LoaderKind::Quilt, "1.20.1").unwrap();
        assert_eq!(a, vec!["quilt", "fabric"]);
        assert_eq!(b, vec!["datapack"]);
        assert!(modrinth_loaders(ProjectType::Shader, LoaderKind::Fabric, "1.20.1").is_none());
        let (a, _) = modrinth_loaders(ProjectType::Mod, LoaderKind::Neoforge, "1.20.1").unwrap();
        assert!(a.contains(&"forge".to_string()));
        let fabric_mod = v("x", "1", "release", &["fabric"]);
        assert!(compatible(&fabric_mod, ProjectType::Mod, "1.20.1", LoaderKind::Quilt));
        assert!(!compatible(&fabric_mod, ProjectType::Mod, "1.20.1", LoaderKind::Forge));
        assert!(!compatible(&fabric_mod, ProjectType::Mod, "1.21", LoaderKind::Fabric));
        let dp = v("d", "1", "release", &["datapack"]);
        assert_eq!(target_kind(ProjectType::Datapack, &dp, LoaderKind::Fabric, "1.20.1"), ContentKind::Datapack);
        let both = v("b", "1", "release", &["datapack", "fabric"]);
        assert_eq!(target_kind(ProjectType::Datapack, &both, LoaderKind::Fabric, "1.20.1"), ContentKind::Mod);
        let rp = v("r", "1", "release", &["minecraft"]);
        assert!(compatible(&rp, ProjectType::Resourcepack, "1.20.1", LoaderKind::Forge));
    }
}
