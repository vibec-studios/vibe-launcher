use super::*;

/// Bekannte Mod-ID -> Modrinth-Projekt (wo ID und Slug abweichen).
pub(super) fn known_project(id: &str) -> Option<&'static str> {
    Some(match id {
        "fabric" | "fabric-api" | "fabric_api" => "P7dR8mSH",
        "fabric-language-kotlin" | "fabric_language_kotlin" => "Ha28R6CL",
        "yet_another_config_lib_v3" | "yet-another-config-lib" | "yacl" => "yacl",
        "cloth-config" | "cloth_config" | "cloth-config2" => "cloth-config",
        "forgeconfigapiport" => "forge-config-api-port",
        "puzzleslib" => "puzzles-lib",
        "owo" => "owo-lib",
        "geckolib" | "geckolib3" => "geckolib",
        "architectury" => "architectury-api",
        "kotlinforforge" => "kotlin-for-forge",
        "sodium" => "sodium",
        "iris" => "iris",
        _ => return None,
    })
}

/// Modrinth-Projekt zu einer Mod-ID suchen (bekannte Zuordnung, Slug, Suche).
pub(crate) async fn resolve_modrinth(state: &AppState, id: &str, inst: &Instance) -> Option<(String, String)> {
    // Fabric-Mods über Connector: statt Fabric API die NeoForge-Portierung (Forgified Fabric API)
    let forgified = connector_hosts(inst) && matches!(id, "fabric" | "fabric-api" | "fabric_api");
    let candidate = if forgified {
        "forgified-fabric-api".to_string()
    } else {
        known_project(id).map(str::to_string).unwrap_or_else(|| id.replace('_', "-"))
    };
    if let Ok(p) = mr::raw_project(state, &candidate).await {
        if p.project_type == "mod" {
            return Some((p.id, p.title));
        }
    }
    // Suche nach der ID, Treffer muss zum normalisierten Slug passen
    let q = crate::content::SearchQuery {
        source: Source::Modrinth,
        query: id.to_string(),
        project_type: crate::content::ProjectType::Mod,
        game_version: Some(inst.mc_version.clone()),
        loader: Some(inst.loader.kind),
        categories: vec![],
        sort: crate::content::SortOrder::Relevance,
        offset: 0,
        limit: 5,
        created_after: None,
    };
    let norm = |s: &str| s.to_ascii_lowercase().replace(['-', '_', ' '], "");
    let r = mr::search(state, &q).await.ok()?;
    r.hits.into_iter().find(|h| norm(&h.slug) == norm(id) || norm(&h.title) == norm(id)).map(|h| (h.id, h.title))
}

pub(super) fn name_of(s: &Scanned) -> String {
    s.meta.name.clone().unwrap_or_else(|| s.file_name.clone())
}

/// Prüfung ohne Netz (für den Start); `resolve` ergänzt Installationsvorschläge über Modrinth.
pub async fn check(state: &AppState, instance_id: &str, resolve: bool) -> AppResult<Vec<DepIssue>> {
    let inst = state.instances.get(instance_id)?;
    let (scanned, _idx): (Vec<Scanned>, ContentIndex) = crate::content::local::scan(state, instance_id, ContentKind::Mod).await?;
    fn info(s: &Scanned) -> Option<ModInfo<'_>> {
        s.meta.mod_id.as_deref().map(|id| ModInfo { s, id })
    }
    let mods: Vec<ModInfo> = scanned.iter().filter(|s| s.enabled).filter_map(info).collect();
    let disabled: Vec<ModInfo> = scanned.iter().filter(|s| !s.enabled).filter_map(info).collect();
    let mut issues = analyze(&inst, &mods, &disabled);
    if let Some(i) = loader_files_issue(&inst, &crate::content::loaderfix::inspect(&state.paths, &inst)) {
        issues.push(i);
    }
    if resolve {
        // Fehlende Abhängigkeiten: Modrinth-Projekt suchen (gleiche ID nur einmal)
        let mut cache: HashMap<String, Option<(String, String)>> = HashMap::new();
        for i in issues.iter_mut().filter(|i| i.kind == IssueKind::MissingDependency) {
            let Some(t) = i.target.clone() else { continue };
            if !cache.contains_key(&t) {
                let r = resolve_modrinth(state, &t, &inst).await;
                cache.insert(t.clone(), r);
            }
            if let Some(Some((pid, title))) = cache.get(&t) {
                i.fixes.insert(0, Fix::Install { source: Source::Modrinth, project_id: pid.clone(), title: title.clone() });
            }
        }
    }
    Ok(issues)
}

/// Hinweis zur Loader-Installation (fehlende Dateien lädt der nächste Start nach -> nur Warnung).
pub(crate) fn loader_files_issue(inst: &Instance, files: &crate::content::loaderfix::LoaderFiles) -> Option<DepIssue> {
    use crate::content::loaderfix::LoaderFiles as F;
    let name = loader_label(inst.loader.kind.as_str()).to_string();
    let full = match inst.loader.version.as_deref().filter(|v| !v.is_empty()) {
        Some(v) => format!("{name} {v}"),
        None => name.clone(),
    };
    let (severity, message) = match files {
        F::Ok | F::NotInstalled => return None,
        F::Failed => ("error", format!("{full}: Die letzte Installation ist fehlgeschlagen")),
        F::Missing { files } => ("warning", format!("{full}: {files} Datei(en) der Installation fehlen")),
        F::Broken { files } => ("error", format!("{full}: Die Installation ist beschädigt ({files} Datei(en))")),
    };
    Some(DepIssue {
        kind: IssueKind::LoaderFiles,
        severity: severity.into(),
        file_name: String::new(),
        mod_name: name,
        target: Some(inst.loader.kind.as_str().into()),
        other_file: None,
        message,
        fixes: vec![],
    })
}
