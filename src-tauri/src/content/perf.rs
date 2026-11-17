//! Performance-Presets: passende Optimierungs-Mods je Loader/Minecraft-Version (von Modrinth).
use super::index::ContentIndex;
use super::{install, local, modrinth as mr, provider, ContentKind, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{Instance, LoaderKind};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use serde::Serialize;

/// (Modrinth-Slug, Mod-IDs zur Erkennung, Gruppe – je Gruppe wird nur der erste verfügbare empfohlen)
type Entry = (&'static str, &'static [&'static str], &'static str);

fn preset(loader: LoaderKind) -> Vec<Entry> {
    match loader {
        LoaderKind::Fabric | LoaderKind::Quilt => vec![
            ("sodium", &["sodium"], "renderer"),
            ("lithium", &["lithium"], "lithium"),
            ("ferrite-core", &["ferritecore"], "ferrite"),
            ("modernfix", &["modernfix"], "modernfix"),
            ("immediatelyfast", &["immediatelyfast"], "immediatelyfast"),
            ("entityculling", &["entityculling"], "entityculling"),
            ("dynamic-fps", &["dynamic_fps"], "dynamicfps"),
            ("moreculling", &["moreculling"], "moreculling"),
        ],
        LoaderKind::Neoforge => vec![
            ("sodium", &["sodium"], "renderer"),
            ("embeddium", &["embeddium", "rubidium"], "renderer"),
            ("lithium", &["lithium"], "lithium"),
            ("ferrite-core", &["ferritecore"], "ferrite"),
            ("modernfix", &["modernfix"], "modernfix"),
            ("immediatelyfast", &["immediatelyfast"], "immediatelyfast"),
            ("entityculling", &["entityculling"], "entityculling"),
            ("dynamic-fps", &["dynamic_fps"], "dynamicfps"),
        ],
        LoaderKind::Forge => vec![
            ("embeddium", &["embeddium", "rubidium"], "renderer"),
            ("ferrite-core", &["ferritecore"], "ferrite"),
            ("modernfix", &["modernfix"], "modernfix"),
            ("immediatelyfast", &["immediatelyfast"], "immediatelyfast"),
            ("entityculling", &["entityculling"], "entityculling"),
            ("dynamic-fps", &["dynamic_fps"], "dynamicfps"),
        ],
        LoaderKind::Vanilla => vec![],
    }
}

/// Mods, die sich mit einem Renderer-Ersatz beißen.
const RENDER_CONFLICTS: &[&str] = &["optifine", "optifabric"];

#[derive(Debug, Clone, Serialize)]
pub struct PerfCandidate {
    pub project_id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    /// Version, die installiert würde
    pub version_number: Option<String>,
    /// Für Loader/Version verfügbar
    pub available: bool,
    pub installed: bool,
    /// Standardmäßig ausgewählt
    pub recommended: bool,
    /// Hinweis (z. B. Konflikt mit OptiFine, Alternative gewählt)
    pub note: Option<String>,
}

async fn installed_ids(state: &AppState, id: &str) -> AppResult<(Vec<String>, ContentIndex)> {
    let (scanned, idx) = local::scan(state, id, ContentKind::Mod).await?;
    let mut ids: Vec<String> = scanned.iter().filter_map(|s| s.meta.mod_id.clone()).collect();
    ids.extend(scanned.iter().flat_map(|s| s.meta.provides.clone()));
    Ok((ids, idx))
}

pub async fn preview(state: &AppState, instance_id: &str) -> AppResult<Vec<PerfCandidate>> {
    let inst = state.instances.get(instance_id)?;
    if inst.loader.kind == LoaderKind::Vanilla {
        return Err(AppError::Invalid("Performance-Mods brauchen einen Mod-Loader (Fabric, Quilt, Forge oder NeoForge)".into()));
    }
    let (ids, idx) = installed_ids(state, instance_id).await?;
    let entries = preset(inst.loader.kind);
    let checks = entries.iter().map(|(slug, _, _)| candidate(state, &inst, slug));
    let results = futures::future::join_all(checks).await;
    let conflict = ids.iter().find(|i| RENDER_CONFLICTS.contains(&i.as_str())).cloned();
    let mut taken_groups: Vec<&str> = Vec::new();
    let mut out = Vec::new();
    for ((slug, mod_ids, group), r) in entries.iter().zip(results) {
        let Some(mut c) = r else { continue };
        c.installed = mod_ids.iter().any(|m| ids.iter().any(|i| i == m)) || idx.has_project(Source::Modrinth, &c.project_id);
        let group_installed = entries.iter().filter(|e| e.2 == *group).any(|e| e.1.iter().any(|m| ids.iter().any(|i| i == m)));
        if c.available && !c.installed && !taken_groups.contains(group) && !group_installed {
            c.recommended = true;
            taken_groups.push(group);
        } else if c.available && !c.installed && (taken_groups.contains(group) || group_installed) && *group == "renderer" {
            c.note = Some("Alternative – es wird nur ein Renderer-Ersatz gebraucht".into());
        }
        if *group == "renderer" {
            if let Some(cf) = &conflict {
                c.recommended = false;
                c.note = Some(format!("Nicht zusammen mit {cf} verwenden"));
            }
        }
        let _ = slug;
        out.push(c);
    }
    Ok(out)
}

async fn candidate(state: &AppState, inst: &Instance, slug: &str) -> Option<PerfCandidate> {
    let p = mr::raw_project(state, slug).await.ok()?;
    let versions = provider::versions_for(state, Source::Modrinth, &p.id, Some(&inst.mc_version), Some(inst.loader.kind)).await.ok();
    let best = versions.as_ref().and_then(|(list, pref, _)| provider::pick_best(list, pref.as_deref()));
    Some(PerfCandidate {
        project_id: p.id.clone(),
        slug: p.slug.clone(),
        title: p.title.clone(),
        description: p.description.clone(),
        icon_url: p.icon_url.clone().filter(|u| !u.is_empty()),
        version_number: best.as_ref().map(|v| v.version_number.clone()),
        available: best.is_some(),
        installed: false,
        recommended: false,
        note: None,
    })
}

/// Task-Körper: Snapshot, dann ausgewählte Projekte inkl. Abhängigkeiten installieren.
pub async fn run_install(state: AppState, task: TaskHandle, instance_id: String, project_ids: Vec<String>) -> AppResult<()> {
    let inst = state.instances.get(&instance_id)?;
    if project_ids.is_empty() {
        return Ok(());
    }
    task.stage("Sicherung wird erstellt …", None);
    if let Err(e) = super::snapshots::create(&state, &instance_id, "Vor Performance-Mods", true, None).await {
        tracing::warn!("Snapshot vor Performance-Mods fehlgeschlagen: {e}");
    }
    task.check()?;
    task.stage("Löse Abhängigkeiten auf …", None);
    let (_, idx) = local::refresh(&state, &instance_id, ContentKind::Mod).await?;
    let mut warnings = Vec::new();
    let roots = project_ids.into_iter().map(|p| (Source::Modrinth, p, None)).collect();
    let planned = install::plan(&state, &inst, &idx, roots, &mut warnings).await?;
    let n = planned.len();
    task.stage(format!("Lade {n} Datei(en) …"), Some(0.1));
    install::apply(&state, &inst, planned, &task.sub(0.1, 1.0)).await?;
    task.message(format!("{n} Datei(en) installiert"));
    Ok(())
}
