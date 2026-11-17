//! Installation von Projekten in Instanzen (mit Pflicht-Abhängigkeiten) und Updates.
use super::index::{self, ContentIndex, IndexEntry};
use super::missing::{self, MissingEntry};
use super::provider::{self, Brief};
use super::{curseforge as cf, modrinth as mr, *};
use crate::error::{AppError, AppResult};
use crate::instance::Instance;
use crate::net::DownloadItem;
use crate::state::AppState;
use crate::tasks::{SubProgress, TaskHandle};
use futures::StreamExt;
use std::collections::VecDeque;

#[derive(Debug, Clone)]
pub struct Planned {
    pub brief: Brief,
    pub source: Source,
    pub kind: ContentKind,
    pub version: ProjectVersion,
    pub file: VersionFile,
}

fn loader_label(inst: &Instance) -> String {
    let l = match inst.loader.kind {
        LoaderKind::Vanilla => "Vanilla",
        LoaderKind::Fabric => "Fabric",
        LoaderKind::Quilt => "Quilt",
        LoaderKind::Forge => "Forge",
        LoaderKind::Neoforge => "NeoForge",
    };
    format!("Minecraft {} ({l})", inst.mc_version)
}

fn primary_file(v: &ProjectVersion) -> Option<VersionFile> {
    v.files.iter().find(|f| f.primary).or(v.files.first()).cloned()
}

/// Neueste kompatible Version eines Projekts.
async fn best_version(state: &AppState, inst: &Instance, source: Source, project_id: &str) -> AppResult<Option<ProjectVersion>> {
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
        out.push(Planned { brief, source, kind, version, file });
    }
    Ok(out)
}

fn state_check_limit(n: usize) -> AppResult<()> {
    if n > 200 {
        return Err(AppError::msg("Zu viele Abhängigkeiten – Installation abgebrochen"));
    }
    Ok(())
}

/// Plan ausführen: herunterladen, alte Versionen ersetzen, Index aktualisieren.
/// Gesperrte Downloads (CurseForge) landen in `missing.json`.
pub async fn apply(state: &AppState, inst: &Instance, planned: Vec<Planned>, sub: &SubProgress) -> AppResult<Vec<MissingDownload>> {
    let game_dir = state.paths.game_dir(&inst.id);
    let idx = ContentIndex::load(&state.paths, &inst.id);
    let mut items = Vec::new();
    let mut entries: Vec<(String, IndexEntry, Vec<String>)> = Vec::new();
    let mut missing_list: Vec<MissingEntry> = Vec::new();
    // Gesperrte CurseForge-Downloads: identische Datei von Modrinth (gleicher SHA-1)
    let locked: Vec<String> = planned.iter().filter(|p| p.file.url.is_none()).filter_map(|p| p.file.sha1.clone()).collect();
    let mirrors = mr::mirrors(state, &locked).await;
    let planned: Vec<Planned> = planned
        .into_iter()
        .map(|mut p| {
            if p.file.url.is_none() {
                if let Some(m) = p.file.sha1.as_ref().and_then(|h| mirrors.get(&h.to_ascii_lowercase())) {
                    p.file.url = Some(m.url.clone());
                }
            }
            p
        })
        .collect();

    for p in &planned {
        let folder = p.kind.folder();
        let old_keys = idx.keys_of_project(p.source, &p.brief.id);
        // War die alte Version deaktiviert? Dann bleibt die neue es auch.
        let was_disabled = !old_keys.is_empty()
            && old_keys.iter().all(|k| {
                let path = game_dir.join(k);
                !path.exists() && path.with_file_name(format!("{}.disabled", path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default())).exists()
            });
        let file_name = crate::paths::sanitize_file_name(&p.file.filename);
        let Some(url) = p.file.url.clone() else {
            let page = if p.source == Source::Curseforge {
                format!("{}/files/{}", p.brief.page_url.trim_end_matches('/'), p.version.id)
            } else {
                p.brief.page_url.clone()
            };
            missing_list.push(MissingEntry {
                info: MissingDownload { file_name: file_name.clone(), project_name: p.brief.title.clone(), page_url: page, kind: p.kind },
                sha1: p.file.sha1.clone(),
                project_id: Some(p.brief.id.clone()),
                file_id: Some(p.version.id.clone()),
            });
            continue;
        };
        let on_disk = if was_disabled { format!("{file_name}.disabled") } else { file_name.clone() };
        let path = game_dir.join(folder).join(&on_disk);
        items.push(DownloadItem::new(url.clone(), path).sha1(p.file.sha1.clone()).size(Some(p.file.size).filter(|s| *s > 0)));
        let key = index::key(folder, &file_name);
        entries.push((
            key,
            IndexEntry {
                source: p.source,
                project_id: p.brief.id.clone(),
                version_id: p.version.id.clone(),
                sha1: p.file.sha1.clone(),
                sha512: p.file.sha512.clone(),
                title: Some(p.brief.title.clone()),
                icon_url: p.brief.icon_url.clone(),
                version_number: Some(p.version.version_number.clone()),
                url: Some(url),
                size: Some(p.file.size),
                date: Some(p.version.date.clone()),
                release_type: Some(p.version.release_type.clone()),
            },
            old_keys,
        ));
    }

    state.net.download_all(items, Some(sub)).await?;

    // Alte Dateien entfernen, Index aktualisieren
    let lock = state.content.lock(&inst.id);
    let _g = lock.lock().await;
    let mut idx = ContentIndex::load(&state.paths, &inst.id);
    for (key, entry, old_keys) in entries {
        for ok in old_keys {
            if ok != key {
                let p = game_dir.join(&ok);
                let disabled = p.with_file_name(format!("{}.disabled", p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()));
                for f in [p, disabled] {
                    if f.is_file() {
                        let _ = tokio::fs::remove_file(&f).await;
                    }
                }
                idx.files.remove(&ok);
                idx.local.remove(&ok);
            }
        }
        idx.files.insert(key, entry);
    }
    idx.save(&state.paths, &inst.id)?;
    drop(_g);
    let out: Vec<MissingDownload> = missing_list.iter().map(|m| m.info.clone()).collect();
    missing::add(&state.paths, &inst.id, missing_list)?;
    state.content.update_counts.lock().remove(&inst.id);
    state.content.emit_changed(&inst.id);
    Ok(out)
}

async fn refresh_all(state: &AppState, inst_id: &str) -> AppResult<(Vec<(ContentKind, local::Scanned)>, ContentIndex)> {
    let mut all = Vec::new();
    for k in ContentKind::ALL {
        let (s, _) = local::refresh(state, inst_id, k).await?;
        all.extend(s.into_iter().map(|s| (k, s)));
    }
    Ok((all, ContentIndex::load(&state.paths, inst_id)))
}

fn finish_message(task: &TaskHandle, warnings: &[String], missing: &[MissingDownload], installed: usize) {
    let mut msg = format!("{installed} Datei(en) installiert");
    if !missing.is_empty() {
        msg.push_str(&format!(", {} manuell herunterzuladen", missing.len()));
    }
    if let Some(w) = warnings.first() {
        msg.push_str(&format!(" – Hinweis: {w}"));
    }
    task.message(msg);
}

/// Task-Körper von `content_install`.
pub async fn run_install(state: AppState, task: TaskHandle, instance_id: String, source: Source, project_id: String, version_id: Option<String>) -> AppResult<()> {
    let inst = state.instances.get(&instance_id)?;
    if source == Source::Curseforge {
        cf::key(&state)?;
    }
    task.stage("Prüfe installierte Inhalte …", None);
    let (_, idx) = refresh_all(&state, &instance_id).await?;
    task.check()?;
    task.stage("Löse Abhängigkeiten auf …", None);
    let mut warnings = Vec::new();
    let planned = plan(&state, &inst, &idx, vec![(source, project_id, version_id)], &mut warnings).await?;
    if let Some(root) = planned.first() {
        task.set_title(format!("{} installieren", root.brief.title));
    }
    task.check()?;
    let n = planned.iter().filter(|p| p.file.url.is_some()).count();
    task.stage(format!("Lade {n} Datei(en) …"), Some(0.1));
    let root_title = planned.first().map(|p| p.brief.title.clone()).unwrap_or_default();
    let root_file = planned.first().map(|p| crate::paths::sanitize_file_name(&p.file.filename));
    let missing = apply(&state, &inst, planned, &task.sub(0.1, 1.0)).await?;
    let root_locked = root_file.is_some_and(|f| missing.iter().any(|m| m.file_name == f));
    for w in &warnings {
        tracing::warn!("content_install {instance_id}: {w}");
    }
    if root_locked {
        return Err(AppError::msg(format!(
            "Der Autor von {root_title} erlaubt keine Downloads über andere Launcher. Bitte lade die Datei manuell herunter (siehe Hinweis bei der Instanz)."
        )));
    }
    finish_message(&task, &warnings, &missing, n);
    Ok(())
}

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
            if nv.id == e.version_id || nv.project_id != e.project_id {
                continue;
            }
            if let Some(d) = &e.date {
                if nv.date_published.as_str() <= d.as_str() {
                    continue;
                }
            }
            out.push(ContentUpdate {
                file_name: s.file_name.clone(),
                kind,
                source: Source::Modrinth,
                project_id: e.project_id.clone(),
                current_version: e.version_number.clone().or(s.meta.version.clone()),
                new_version: mr::convert_version(nv.clone()),
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
                let only_release = e.release_type.as_deref().map_or(true, |r| r == "release");
                let nv = list.into_iter().find(|v| !only_release || v.release_type == "release")?;
                if nv.id == e.version_id || e.date.as_deref().is_some_and(|d| nv.date.as_str() <= d) {
                    return None;
                }
                Some(ContentUpdate {
                    file_name: s.file_name.clone(),
                    kind,
                    source: Source::Curseforge,
                    project_id: e.project_id.clone(),
                    current_version: e.version_number.clone().or(s.meta.version.clone()),
                    new_version: nv,
                })
            }
        }))
        .buffer_unordered(6)
        .collect()
        .await;
        out.extend(results.into_iter().flatten());
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
        let only_release = e.release_type.as_deref().map_or(true, |r| r == "release");
        let pool: Vec<ProjectVersion> = list.into_iter().filter(|v| !only_release || v.release_type == "release").collect();
        let Some(nv) = provider::pick_best(&pool, pref.as_deref()) else { continue };
        if nv.id == e.version_id || e.date.as_deref().is_some_and(|d| nv.date.as_str() <= d) {
            continue;
        }
        out.push(ContentUpdate {
            file_name: s.file_name.clone(),
            kind,
            source: Source::Store(key),
            project_id: e.project_id.clone(),
            current_version: e.version_number.clone().or(s.meta.version.clone()),
            new_version: nv,
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

/// Task-Körper von `content_update`.
pub async fn run_update(state: AppState, task: TaskHandle, instance_id: String, file_names: Vec<String>) -> AppResult<()> {
    let inst = state.instances.get(&instance_id)?;
    task.stage("Suche Updates …", None);
    let updates = check_updates(&state, &instance_id).await?;
    let selected: Vec<&ContentUpdate> = updates.iter().filter(|u| file_names.is_empty() || file_names.contains(&u.file_name)).collect();
    if selected.is_empty() {
        task.message("Alles aktuell");
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
    let missing = apply(&state, &inst, planned, &task.sub(0.1, 1.0)).await?;
    finish_message(&task, &warnings, &missing, n);
    Ok(())
}
