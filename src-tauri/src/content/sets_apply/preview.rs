use super::*;

pub(super) async fn present(state: &AppState, instance_id: &str) -> AppResult<Present> {
    let (all, idx) = install::refresh_all(state, instance_id).await?;
    let mut mod_ids = HashSet::new();
    let mut names = HashMap::new();
    for (_, s) in &all {
        if let Some(id) = &s.meta.mod_id {
            mod_ids.insert(id.to_ascii_lowercase());
        }
        mod_ids.extend(s.meta.provides.iter().map(|p| p.to_ascii_lowercase()));
        let display = s.meta.name.clone().unwrap_or_else(|| s.file_name.clone());
        if let Some(n) = &s.meta.name {
            names.insert(norm(n), display.clone());
        }
        if let Some(t) = idx.files.get(&s.key).and_then(|e| e.title.clone()) {
            names.insert(norm(&t), t);
        }
    }
    Ok(Present { idx, mod_ids, names })
}

/// Einträge mehrerer Sets zusammenführen (gleiches Projekt nur einmal, mit allen Set-IDs).
pub(super) fn merged_entries(set_ids: &[String], only: Option<&[String]>, all: &[sets::ModSet]) -> AppResult<Vec<(SetEntry, Vec<String>)>> {
    let mut out: Vec<(SetEntry, Vec<String>)> = Vec::new();
    for sid in set_ids {
        let set = all.iter().find(|s| &s.id == sid).ok_or_else(|| AppError::NotFound("Mod-Set".into()))?;
        for e in &set.entries {
            if only.is_some_and(|o| !o.contains(&e.key())) {
                continue;
            }
            match out.iter_mut().find(|(x, _)| x.key() == e.key()) {
                Some((_, ids)) => ids.push(sid.clone()),
                None => out.push((e.clone(), vec![sid.clone()])),
            }
        }
    }
    Ok(out)
}

/// Einen Eintrag für Version/Loader auflösen (erst gefiltert, nur bei Bedarf alle Versionen).
pub(super) async fn resolve(state: &AppState, e: &SetEntry, mc: &str, loader: LoaderKind) -> (Resolution, ProjectType, Option<String>) {
    if e.source == Source::Curseforge && !cf::available(state) {
        return (unavailable(Reason::NeedsCurseforge), e.project_type, None);
    }
    let first = provider::versions_for(state, e.source, &e.project_id, Some(mc), Some(loader)).await;
    let pt = match &first {
        Ok((list, _, pt)) => {
            if let r @ Resolution::Ok(_) = classify(list, *pt, mc, loader) {
                return (r, *pt, None);
            }
            *pt
        }
        Err(AppError::NotFound(_)) => return (unavailable(Reason::NotFound), e.project_type, None),
        Err(err) => return (unavailable(Reason::Failed), e.project_type, Some(err.to_string())),
    };
    match provider::versions_for(state, e.source, &e.project_id, None, None).await {
        Ok((all, _, _)) => (classify(&all, pt, mc, loader), pt, None),
        Err(err) => (unavailable(Reason::Failed), pt, Some(err.to_string())),
    }
}

/// Projekt einer Alternative: (Quelle, ID, Titel, Icon)
pub(super) type AltProject<'a> = (Source, &'a str, &'a str, Option<String>);

pub(super) fn alt_from(kind: AltKind, (source, project_id, title, icon): AltProject, v: &ProjectVersion, mc: Option<String>, recommended: bool) -> Alternative {
    Alternative {
        kind,
        source,
        project_id: project_id.to_string(),
        title: title.to_string(),
        icon_url: icon,
        version_id: v.id.clone(),
        version_number: v.version_number.clone(),
        mc_version: mc,
        recommended,
    }
}

/// Ersatzprojekte für ein nicht verfügbares Projekt suchen (bekannte Liste, sonst gleichnamige Projekte).
pub(super) async fn find_alternatives(state: &AppState, e: &SetEntry, pt: ProjectType, mc: &str, loader: LoaderKind) -> Vec<Alternative> {
    if pt != ProjectType::Mod || loader == LoaderKind::Vanilla {
        return vec![];
    }
    let mut out = Vec::new();
    let slug = e.slug.clone().unwrap_or_default().to_ascii_lowercase();
    let known: Vec<&str> = ALTERNATIVES.iter().find(|(s, _)| *s == slug).map(|(_, a)| a.to_vec()).unwrap_or_default();
    for alt in known {
        let Ok(p) = mr::raw_project(state, alt).await else { continue };
        if let Ok((list, pref, _)) = provider::versions_for(state, Source::Modrinth, &p.id, Some(mc), Some(loader)).await {
            if let Some(v) = provider::pick_best(&list, pref.as_deref()) {
                out.push(alt_from(AltKind::OtherProject, (Source::Modrinth, &p.id, &p.title, p.icon_url.clone().filter(|u| !u.is_empty())), &v, None, true));
                break;
            }
        }
    }
    if !out.is_empty() {
        return out;
    }
    // Gleichnamige Projekte für diesen Loader („Fabric API“ -> „Forgified Fabric API“, Forge-Ports)
    let q = SearchQuery {
        source: Source::Modrinth,
        query: e.title.clone(),
        project_type: ProjectType::Mod,
        game_version: Some(mc.to_string()),
        loader: Some(loader),
        categories: vec![],
        sort: SortOrder::Relevance,
        offset: 0,
        limit: 6,
        created_after: None,
    };
    let Ok(r) = provider::search(state, &q).await else { return out };
    let me = norm(&e.title);
    for h in r.hits.iter().filter(|h| !(h.source == e.source && h.id == e.project_id)) {
        let t = norm(&h.title);
        if me.len() < 4 || !(t.contains(&me) || me.contains(&t)) || t.len() < 4 {
            continue;
        }
        if let Ok((list, pref, _)) = provider::versions_for(state, Source::Modrinth, &h.id, Some(mc), Some(loader)).await {
            if let Some(v) = provider::pick_best(&list, pref.as_deref()) {
                out.push(alt_from(AltKind::OtherProject, (Source::Modrinth, &h.id, &h.title, h.icon_url.clone()), &v, None, false));
            }
        }
        if out.len() >= 2 {
            break;
        }
    }
    out
}

/// Pläne mehrerer Projekte zusammenführen: gemeinsame Abhängigkeiten (z. B. Fabric API) nur einmal.
pub fn merge_plans(plans: Vec<Vec<Planned>>) -> Vec<Planned> {
    let mut seen: HashSet<(Source, String)> = HashSet::new();
    plans.into_iter().flatten().filter(|x| seen.insert((x.source, x.brief.id.clone()))).collect()
}

/// Pflicht-Abhängigkeiten eines Plans (alles nach dem Wurzelprojekt) für die Vorschau.
pub(super) fn dep_infos(planned: &[Planned]) -> Vec<DepInfo> {
    planned
        .iter()
        .skip(1)
        .map(|p| DepInfo { key: sets::entry_key(p.source, &p.brief.id), title: p.brief.title.clone(), icon_url: p.brief.icon_url.clone(), version_number: p.version.version_number.clone() })
        .collect()
}

pub(super) fn base_item(e: SetEntry, set_ids: Vec<String>, status: ItemStatus) -> PreviewItem {
    PreviewItem {
        key: e.key(),
        entry: e,
        set_ids,
        status,
        version_id: None,
        version_number: None,
        file_name: None,
        kind: None,
        reason: None,
        message: None,
        loaders: vec![],
        mc_range: None,
        alternatives: vec![],
        conflicts: vec![],
        deps: vec![],
        manual: false,
        installed_as: None,
        covered_by: None,
        selected: false,
    }
}

pub(super) async fn preview_item(state: &AppState, inst: &Instance, pres: &Present, e: SetEntry, set_ids: Vec<String>) -> PreviewItem {
    let mc = inst.mc_version.as_str();
    let loader = inst.loader.kind;
    // Schon da? (über Vibe zugeordnet oder gleiche Mod-ID/gleicher Name)
    if pres.idx.has_project(e.source, &e.project_id) {
        return base_item(e, set_ids, ItemStatus::Installed);
    }
    if let Some(name) = same_project(&e, &pres.mod_ids, &pres.names) {
        let mut it = base_item(e, set_ids, ItemStatus::Installed);
        it.installed_as = Some(name);
        return it;
    }
    let (res, pt, msg) = resolve(state, &e, mc, loader).await;
    match res {
        Resolution::Unavailable { reason, loaders, mc_range, older } => {
            let mut it = base_item(e.clone(), set_ids, ItemStatus::Unavailable);
            it.reason = Some(reason);
            it.message = msg;
            it.loaders = loaders;
            it.mc_range = mc_range;
            if matches!(reason, Reason::OtherLoader | Reason::OtherMc | Reason::NeedsLoader) {
                it.alternatives = find_alternatives(state, &e, pt, mc, loader).await;
            }
            // Ersatz mit demselben Zweck schon installiert (z. B. Sodium statt Embeddium) -> nichts zu tun
            if let Some(a) = it.alternatives.iter().find(|a| a.kind == AltKind::OtherProject && (pres.idx.has_project(a.source, &a.project_id) || pres.names.contains_key(&norm(&a.title)))) {
                let mut done = base_item(e, it.set_ids.clone(), ItemStatus::Installed);
                done.covered_by = Some(a.title.clone());
                return done;
            }
            if let Some((v, g)) = older {
                if reason == Reason::OtherMc || reason == Reason::OtherLoader {
                    it.alternatives.push(alt_from(AltKind::OlderMc, (e.source, &e.project_id, &e.title, e.icon_url.clone()), &v, Some(g), false));
                }
            }
            it
        }
        Resolution::Ok(v) => {
            let mut warnings = Vec::new();
            let planned = install::plan(state, inst, &pres.idx, vec![(e.source, e.project_id.clone(), Some(v.id.clone()))], &mut warnings).await;
            let mut it = base_item(e.clone(), set_ids, ItemStatus::Install);
            match planned {
                Ok(planned) if !planned.is_empty() => {
                    let root = &planned[0];
                    it.version_id = Some(root.version.id.clone());
                    it.version_number = Some(root.version.version_number.clone());
                    it.file_name = Some(root.file.filename.clone());
                    it.kind = Some(root.kind);
                    it.manual = root.file.url.is_none();
                    it.deps = dep_infos(&planned);
                    // Konflikte: Modrinth-„incompatible“ mit Installiertem + bekannte Gruppen (Renderer, Shader-Loader)
                    for d in root.version.dependencies.iter().filter(|d| d.kind == DependencyKind::Incompatible) {
                        if let Some(pid) = &d.project_id {
                            let src = d.source.unwrap_or(e.source);
                            if pres.idx.has_project(src, pid) {
                                let title = pres.idx.files.values().find(|x| x.source == src && &x.project_id == pid).and_then(|x| x.title.clone()).unwrap_or_else(|| pid.clone());
                                it.conflicts.push(title);
                            }
                        }
                    }
                    let slug = e.slug.clone().unwrap_or_else(|| norm(&e.title)).to_ascii_lowercase();
                    for c in group_conflicts(&slug, &pres.mod_ids) {
                        let name = pres.names.get(&norm(&c)).cloned().unwrap_or(c);
                        if !it.conflicts.contains(&name) {
                            it.conflicts.push(name);
                        }
                    }
                    if !it.conflicts.is_empty() {
                        it.status = ItemStatus::Conflict;
                    }
                    it.selected = it.status == ItemStatus::Install;
                }
                Ok(_) => {
                    it.status = ItemStatus::Unavailable;
                    it.reason = Some(Reason::NoFiles);
                }
                Err(err) => {
                    it.status = ItemStatus::Unavailable;
                    it.reason = Some(Reason::Failed);
                    it.message = Some(err.to_string());
                }
            }
            it
        }
    }
}

/// Vorschau für eine Instanz. `only`: nur diese Einträge (Schlüssel `quelle:id`, z. B. neue Projekte eines Sets).
pub async fn preview(state: &AppState, instance_id: &str, set_ids: &[String], only: Option<Vec<String>>) -> AppResult<SetPreview> {
    let inst = state.instances.get(instance_id)?;
    let all = sets::all(&state.paths);
    let entries = merged_entries(set_ids, only.as_deref(), &all)?;
    let pres = present(state, instance_id).await?;
    let futs: Vec<_> = entries.into_iter().map(|(e, ids)| preview_item(state, &inst, &pres, e, ids)).collect();
    let items: Vec<PreviewItem> = futures::stream::iter(futs).buffered(6).collect().await;
    Ok(SetPreview { instance_id: instance_id.to_string(), mc_version: inst.mc_version.clone(), loader: inst.loader.kind, items })
}
