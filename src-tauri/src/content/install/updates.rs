use super::*;

// ------------------------------------------------------------------ Updates

pub async fn check_updates(state: &AppState, instance_id: &str) -> AppResult<Vec<ContentUpdate>> {
    let inst = state.instances.get(instance_id)?;
    let (all, idx) = refresh_all(state, instance_id).await?;
    let mc = inst.mc_version.clone();
    let loader = inst.loader.kind;
    let mut out = Vec::new();

    // Modrinth: je Art ein Batch-Aufruf
    for kind in ContentKind::ALL {
        let entries: Vec<(&local::Scanned, &IndexEntry, String)> = all
            .iter()
            .filter(|(k, _)| *k == kind)
            .filter_map(|(_, s)| {
                let e = idx.files.get(&s.key)?;
                let sha1 = s.meta.sha1.clone().or(e.sha1.clone())?;
                (e.source == Source::Modrinth).then_some((s, e, sha1))
            })
            .collect();
        if entries.is_empty() {
            continue;
        }
        let loaders: Option<Vec<String>> = match kind {
            ContentKind::Mod => provider::modrinth_loaders(ProjectType::Mod, loader, &mc).map(|(a, _)| a).filter(|a| !a.is_empty()),
            ContentKind::Datapack => Some(vec!["datapack".into()]),
            ContentKind::Resourcepack => Some(vec!["minecraft".into()]),
            ContentKind::Shader => None,
        };
        if kind == ContentKind::Mod && loaders.is_none() {
            continue;
        }
        let hashes: Vec<String> = entries.iter().map(|(_, _, h)| h.clone()).collect();
        let latest = mr::latest_by_hash(state, &hashes, loaders.as_deref(), std::slice::from_ref(&mc)).await?;
        for (s, e, h) in entries {
            let Some(nv) = latest.get(&h.to_ascii_lowercase()) else { continue };
            if nv.project_id != e.project_id {
                continue;
            }
            let mut nv = mr::convert_version(nv.clone());
            if wants_release(e) && nv.release_type != "release" {
                let l = if kind == ContentKind::Mod { Some(loader) } else { None };
                let Ok((list, pref, _)) = provider::versions_for(state, Source::Modrinth, &e.project_id, Some(&mc), l).await else { continue };
                let pool: Vec<ProjectVersion> = list.into_iter().filter(|v| v.release_type == "release").collect();
                let Some(best) = provider::pick_best(&pool, pref.as_deref()) else { continue };
                nv = best;
            }
            if !is_newer(e, Some(&h), &nv) {
                continue;
            }
            out.push(ContentUpdate {
                file_name: s.file_name.clone(),
                kind,
                source: Source::Modrinth,
                project_id: e.project_id.clone(),
                current_version: e.version_number.clone().or(s.meta.version.clone()),
                new_version: nv,
                manual: false,
                page_url: None,
            });
        }
    }

    // CurseForge: Dateilisten je Projekt
    if cf::available(state) {
        let cf_entries: Vec<(ContentKind, local::Scanned, IndexEntry)> = all
            .iter()
            .filter_map(|(k, s)| idx.files.get(&s.key).filter(|e| e.source == Source::Curseforge).map(|e| (*k, s.clone(), e.clone())))
            .collect();
        let results: Vec<Option<ContentUpdate>> = futures::stream::iter(cf_entries.into_iter().map(|(kind, s, e)| {
            let mc = mc.clone();
            async move {
                let l = if kind == ContentKind::Mod { Some(loader) } else { None };
                let (list, _, _) = provider::versions_for(state, Source::Curseforge, &e.project_id, Some(&mc), l).await.ok()?;
                let only_release = wants_release(&e);
                let nv = list.into_iter().find(|v| !only_release || v.release_type == "release")?;
                if !is_newer(&e, s.meta.sha1.as_deref().or(e.sha1.as_deref()), &nv) {
                    return None;
                }
                let manual = nv.files.first().is_some_and(|f| f.url.is_none());
                Some(ContentUpdate {
                    file_name: s.file_name.clone(),
                    kind,
                    source: Source::Curseforge,
                    project_id: e.project_id.clone(),
                    current_version: e.version_number.clone().or(s.meta.version.clone()),
                    new_version: nv,
                    manual,
                    page_url: None,
                })
            }
        }))
        .buffer_unordered(6)
        .collect()
        .await;
        let mut cf_updates: Vec<ContentUpdate> = results.into_iter().flatten().collect();
        mark_manual(state, &mut cf_updates).await;
        out.extend(cf_updates);
    }

    // Eigene Stores: neueste kompatible Version je Projekt
    let store_entries: Vec<(ContentKind, local::Scanned, IndexEntry, StoreKey)> = all
        .iter()
        .filter_map(|(k, s)| {
            let e = idx.files.get(&s.key)?;
            match e.source {
                Source::Store(key) => Some((*k, s.clone(), e.clone(), key)),
                _ => None,
            }
        })
        .collect();
    for (kind, s, e, key) in store_entries {
        let l = if kind == ContentKind::Mod { Some(loader) } else { None };
        let Ok((list, pref, _)) = provider::versions_for(state, Source::Store(key), &e.project_id, Some(&mc), l).await else { continue };
        let only_release = wants_release(&e);
        let pool: Vec<ProjectVersion> = list.into_iter().filter(|v| !only_release || v.release_type == "release").collect();
        let Some(nv) = provider::pick_best(&pool, pref.as_deref()) else { continue };
        if !is_newer(&e, s.meta.sha1.as_deref().or(e.sha1.as_deref()), &nv) {
            continue;
        }
        out.push(ContentUpdate {
            file_name: s.file_name.clone(),
            kind,
            source: Source::Store(key),
            project_id: e.project_id.clone(),
            current_version: e.version_number.clone().or(s.meta.version.clone()),
            new_version: nv,
            manual: false,
            page_url: None,
        });
    }
    // Fixierte Inhalte nie anbieten
    out.retain(|u| {
        let folder = u.kind.folder();
        !idx.pinned.contains(&index::key(folder, &u.file_name))
    });
    out.sort_by_key(|u| u.file_name.to_lowercase());
    Ok(out)
}

fn wants_release(e: &IndexEntry) -> bool {
    e.release_type.as_deref().map_or(true, |r| r == "release")
}

fn is_newer(e: &IndexEntry, sha1: Option<&str>, nv: &ProjectVersion) -> bool {
    let same_file = sha1.is_some_and(|h| nv.files.iter().any(|f| f.sha1.as_deref().is_some_and(|x| x.eq_ignore_ascii_case(h))));
    nv.id != e.version_id && !same_file && e.date.as_deref().map_or(true, |d| nv.date.as_str() > d)
}

#[cfg(test)]
#[path = "updates_tests.rs"]
mod tests;

/// Gesperrte CurseForge-Updates: Gibt es die Datei identisch auf Modrinth, wird automatisch aktualisiert;
/// sonst bleibt das Update manuell und bekommt den Link zur Dateiseite.
pub(super) async fn mark_manual(state: &AppState, updates: &mut [ContentUpdate]) {
    if !updates.iter().any(|u| u.manual) {
        return;
    }
    let sha1s: Vec<String> = updates.iter().filter(|u| u.manual).filter_map(|u| u.new_version.files.first()?.sha1.clone()).collect();
    let mirrors = mr::mirrors(state, &sha1s).await;
    let ids: Vec<u64> = updates.iter().filter(|u| u.manual).filter_map(|u| u.project_id.parse().ok()).collect::<HashSet<_>>().into_iter().collect();
    let mods: Vec<cf::CfMod> = cf::raw_mods(state, &ids).await.unwrap_or_default();
    for u in updates.iter_mut().filter(|u| u.manual) {
        let mirrored = u.new_version.files.first().and_then(|f| f.sha1.as_ref()).is_some_and(|h| mirrors.contains_key(&h.to_ascii_lowercase()));
        if mirrored {
            u.manual = false;
            continue;
        }
        let file_id: u64 = u.new_version.id.parse().unwrap_or(0);
        u.page_url = Some(match mods.iter().find(|m| m.id.to_string() == u.project_id) {
            Some(m) => cf::file_page_url(m, file_id),
            None => format!("https://www.curseforge.com/projects/{}", u.project_id),
        });
    }
}

/// Hinweis zu übersprungenen manuellen Updates.
pub fn manual_skipped_text(n: usize) -> Option<String> {
    match n {
        0 => None,
        1 => Some("1 Update musst du manuell laden".into()),
        n => Some(format!("{n} Updates musst du manuell laden")),
    }
}

/// Task-Körper von `content_update`.
pub async fn run_update(state: AppState, task: TaskHandle, instance_id: String, file_names: Vec<String>) -> AppResult<()> {
    let inst = state.instances.get(&instance_id)?;
    task.stage("Suche Updates …", None);
    let updates = check_updates(&state, &instance_id).await?;
    let wanted: Vec<&ContentUpdate> = updates.iter().filter(|u| file_names.is_empty() || file_names.contains(&u.file_name)).collect();
    // Gesperrte Downloads nie automatisch – nur zählen und am Ende nennen
    let skipped = wanted.iter().filter(|u| u.manual).count();
    let selected: Vec<&ContentUpdate> = wanted.into_iter().filter(|u| !u.manual).collect();
    if selected.is_empty() {
        task.message(manual_skipped_text(skipped).unwrap_or_else(|| "Alles aktuell".into()));
        return Ok(());
    }
    task.check()?;
    task.stage(format!("{} Update(s) vorbereiten …", selected.len()), Some(0.05));
    let idx = ContentIndex::load(&state.paths, &instance_id);
    let mut warnings = Vec::new();
    let roots = selected.iter().map(|u| (u.source, u.project_id.clone(), Some(u.new_version.id.clone()))).collect();
    let planned = plan(&state, &inst, &idx, roots, &mut warnings).await?;
    let n = planned.iter().filter(|p| p.file.url.is_some()).count();
    task.stage(format!("Lade {n} Datei(en) …"), Some(0.1));
    let note = crate::content::organize::InstallNote::new(&planned, selected.len(), false);
    let missing = apply(&state, &inst, planned, &task.sub(0.1, 1.0)).await?;
    note.commit(&state.paths, &instance_id);
    finish_message(&task, &warnings, &missing, n);
    if let Some(m) = manual_skipped_text(skipped) {
        task.message(format!("{n} Datei(en) aktualisiert – {m}"));
    }
    Ok(())
}
