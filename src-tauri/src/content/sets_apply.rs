//! Mod-Sets anwenden: jedes Projekt eines Sets für Minecraft-Version und Loader einer Instanz auflösen
//! (neueste passende, bevorzugt stabile Version, inkl. Pflicht-Abhängigkeiten), Vorschau mit Gründen für
//! „nicht verfügbar“ und Alternativen, Installation als Aufgabe (vorher Sicherung), Merken je Instanz, welche Sets
//! angewendet wurden (Hinweis auf neue Projekte), und eine Kompatibilitätsübersicht je Set.
//!
//! Es wird nie etwas entfernt: Konflikte mit vorhandenen Mods werden nur angezeigt.
use super::index::ContentIndex;
use super::install::{self, Planned};
use super::sets::{self, norm, SetEntry};
use super::{curseforge as cf, modrinth as mr, provider, *};
use crate::error::{AppError, AppResult};
use crate::instance::Instance;
use crate::state::AppState;
use crate::tasks::TaskHandle;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::PathBuf;

// ------------------------------------------------------------------ Minecraft-Versionen

/// Zahlen einer Release-Version („1.21.4“ -> [1, 21, 4]). Snapshots/Pre-Releases: `None`.
pub fn mc_key(v: &str) -> Option<Vec<u64>> {
    let parts: Vec<&str> = v.split('.').collect();
    if parts.len() < 2 || parts.len() > 4 {
        return None;
    }
    parts.iter().map(|p| if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) { p.parse().ok() } else { None }).collect()
}

pub fn mc_cmp(a: &str, b: &str) -> Option<Ordering> {
    let (x, y) = (mc_key(a)?, mc_key(b)?);
    let n = x.len().max(y.len());
    for i in 0..n {
        match x.get(i).copied().unwrap_or(0).cmp(&y.get(i).copied().unwrap_or(0)) {
            Ordering::Equal => {}
            o => return Some(o),
        }
    }
    Some(Ordering::Equal)
}

fn sort_mc_desc(v: &mut [String]) {
    v.sort_by(|a, b| mc_cmp(b, a).unwrap_or(Ordering::Equal));
}

// ------------------------------------------------------------------ Auflösung (rein, testbar)

/// Warum ein Projekt für eine Instanz nicht passt.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    /// Mod in einer Vanilla-Instanz
    NeedsLoader,
    /// Gibt es (für diese Minecraft-Version) nur für andere Loader
    OtherLoader,
    /// Gibt es für diesen Loader, aber nicht für diese Minecraft-Version
    OtherMc,
    /// Projekt ohne Dateien
    NoFiles,
    /// Projekt nicht (mehr) gefunden
    NotFound,
    /// CurseForge ist nicht eingerichtet
    NeedsCurseforge,
    /// Modpacks werden als eigene Instanz installiert
    Modpack,
    /// Abfrage fehlgeschlagen (Netzwerk o. Ä.)
    Failed,
}

#[derive(Debug, Clone)]
pub enum Resolution {
    Ok(ProjectVersion),
    Unavailable {
        reason: Reason,
        /// Loader, für die es das Projekt gibt (bei `OtherLoader`)
        loaders: Vec<String>,
        /// Unterstützte Minecraft-Versionen mit diesem Loader (älteste, neueste)
        mc_range: Option<(String, String)>,
        /// Neueste Version für eine ältere Minecraft-Version (nur auf ausdrücklichen Wunsch) + deren MC-Version
        older: Option<(ProjectVersion, String)>,
    },
}

fn unavailable(reason: Reason) -> Resolution {
    Resolution::Unavailable { reason, loaders: vec![], mc_range: None, older: None }
}

/// Höchste mit dem Loader kompatible MC-Version einer Datei, die älter als `mc` ist.
fn best_older_mc(v: &ProjectVersion, pt: ProjectType, mc: &str, loader: LoaderKind) -> Option<String> {
    v.game_versions
        .iter()
        .filter(|g| mc_cmp(g, mc) == Some(Ordering::Less) && provider::compatible(v, pt, g, loader))
        .max_by(|a, b| mc_cmp(a, b).unwrap_or(Ordering::Equal))
        .cloned()
}

/// Passende Version aus allen Versionen eines Projekts bestimmen – oder begründen, warum es keine gibt.
pub fn classify(all: &[ProjectVersion], pt: ProjectType, mc: &str, loader: LoaderKind) -> Resolution {
    if pt == ProjectType::Modpack {
        return unavailable(Reason::Modpack);
    }
    if all.is_empty() {
        return unavailable(Reason::NoFiles);
    }
    let ok: Vec<ProjectVersion> = all.iter().filter(|v| provider::compatible(v, pt, mc, loader)).cloned().collect();
    let pref = provider::modrinth_loaders(pt, loader, mc).map(|(a, _)| a);
    if let Some(v) = provider::pick_best(&ok, pref.as_deref()) {
        return Resolution::Ok(v);
    }
    let loader_ok = |v: &ProjectVersion| v.game_versions.iter().any(|g| provider::compatible(v, pt, g, loader));
    let for_loader: Vec<&ProjectVersion> = all.iter().filter(|v| loader_ok(v)).collect();
    // Unterstützte (Release-)Versionen mit diesem Loader
    let mut mcs: Vec<String> = for_loader
        .iter()
        .flat_map(|v| v.game_versions.iter().filter(|g| mc_key(g).is_some() && provider::compatible(v, pt, g, loader)).cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    sort_mc_desc(&mut mcs);
    let mc_range = (!mcs.is_empty()).then(|| (mcs.last().cloned().unwrap_or_default(), mcs[0].clone()));
    // Ältere Minecraft-Version: höchste ältere, dann Release vor Beta, dann neueste
    let older = for_loader
        .iter()
        .filter_map(|v| best_older_mc(v, pt, mc, loader).map(|g| (*v, g)))
        .max_by(|(va, ga), (vb, gb)| {
            mc_cmp(ga, gb)
                .unwrap_or(Ordering::Equal)
                .then_with(|| (va.release_type == "release").cmp(&(vb.release_type == "release")))
                .then_with(|| va.date.cmp(&vb.date))
        })
        .map(|(v, g)| (v.clone(), g));
    let loaders_of = |vs: Vec<&ProjectVersion>| -> Vec<String> {
        let mut l: Vec<String> = vs.iter().flat_map(|v| v.loaders.iter().cloned()).filter(|l| l != "minecraft").collect::<BTreeSet<_>>().into_iter().collect();
        l.sort_by_key(|x| ["fabric", "quilt", "neoforge", "forge", "datapack"].iter().position(|k| k == x).unwrap_or(99));
        l
    };
    let for_mc: Vec<&ProjectVersion> = all.iter().filter(|v| v.game_versions.iter().any(|g| g == mc)).collect();
    let (reason, loaders) = if pt == ProjectType::Mod && loader == LoaderKind::Vanilla {
        (Reason::NeedsLoader, loaders_of(for_mc))
    } else if !for_mc.is_empty() {
        (Reason::OtherLoader, loaders_of(for_mc))
    } else if !for_loader.is_empty() {
        (Reason::OtherMc, vec![])
    } else {
        (Reason::OtherLoader, loaders_of(all.iter().collect()))
    };
    Resolution::Unavailable { reason, loaders, mc_range, older }
}

/// Bekannte Ersatzprojekte (Modrinth-Slugs) für denselben Zweck auf anderen Loadern.
const ALTERNATIVES: &[(&str, &[&str])] = &[
    ("sodium", &["embeddium"]),
    ("embeddium", &["sodium"]),
    ("rubidium", &["embeddium", "sodium"]),
    ("iris", &["oculus"]),
    ("oculus", &["iris"]),
    ("lithium", &["canary", "radium"]),
    ("modmenu", &["catalogue"]),
    ("catalogue", &["modmenu"]),
];

/// Mods, von denen nur einer gleichzeitig laufen sollte (Mod-IDs bzw. Modrinth-Slugs).
const CONFLICT_GROUPS: &[&[&str]] = &[&["sodium", "embeddium", "rubidium", "optifine", "optifabric"], &["iris", "oculus", "optifine", "optifabric"]];

/// Namen der installierten Mods, mit denen sich `slug` laut den bekannten Gruppen beißt.
pub fn group_conflicts(slug: &str, installed_ids: &HashSet<String>) -> Vec<String> {
    let mut out = Vec::new();
    for g in CONFLICT_GROUPS {
        if !g.contains(&slug) {
            continue;
        }
        for other in g.iter().filter(|o| **o != slug) {
            if installed_ids.contains(*other) && !out.iter().any(|x: &String| x == other) {
                out.push(other.to_string());
            }
        }
    }
    out
}

/// Ist ein Set-Eintrag schon (ohne Vibe-Zuordnung) installiert? Vergleich über Slug/Mod-ID und Namen.
pub fn same_project(e: &SetEntry, mod_ids: &HashSet<String>, names: &HashMap<String, String>) -> Option<String> {
    if let Some(slug) = &e.slug {
        let n = norm(slug);
        if n.len() >= 3 {
            if let Some(name) = names.get(&n) {
                return Some(name.clone());
            }
            if mod_ids.iter().any(|m| norm(m) == n) {
                return Some(e.title.clone());
            }
        }
    }
    let t = norm(&e.title);
    if t.len() >= 3 {
        return names.get(&t).cloned();
    }
    None
}

// ------------------------------------------------------------------ Vorschau

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ItemStatus {
    /// Wird installiert
    Install,
    /// Schon vorhanden
    Installed,
    /// Für diese Version/diesen Loader nicht verfügbar
    Unavailable,
    /// Verfügbar, verträgt sich aber nicht mit einem vorhandenen Mod (standardmäßig abgewählt)
    Conflict,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AltKind {
    /// Dasselbe Projekt für eine ältere Minecraft-Version
    OlderMc,
    /// Ein anderes Projekt mit demselben Zweck
    OtherProject,
}

#[derive(Debug, Clone, Serialize)]
pub struct Alternative {
    pub kind: AltKind,
    pub source: Source,
    pub project_id: String,
    pub title: String,
    pub icon_url: Option<String>,
    pub version_id: String,
    pub version_number: String,
    /// Bei `older_mc`: Minecraft-Version der Datei
    pub mc_version: Option<String>,
    /// Bekannter, bewährter Ersatz -> vorausgewählt
    pub recommended: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DepInfo {
    pub key: String,
    pub title: String,
    pub icon_url: Option<String>,
    pub version_number: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PreviewItem {
    pub key: String,
    pub entry: SetEntry,
    /// Sets, aus denen der Eintrag stammt
    pub set_ids: Vec<String>,
    pub status: ItemStatus,
    pub version_id: Option<String>,
    pub version_number: Option<String>,
    pub file_name: Option<String>,
    pub kind: Option<ContentKind>,
    pub reason: Option<Reason>,
    /// Fehlertext bei `failed`
    pub message: Option<String>,
    pub loaders: Vec<String>,
    pub mc_range: Option<(String, String)>,
    pub alternatives: Vec<Alternative>,
    /// Namen vorhandener Mods, mit denen es sich beißt
    pub conflicts: Vec<String>,
    /// Pflicht-Abhängigkeiten, die zusätzlich installiert werden
    pub deps: Vec<DepInfo>,
    /// Datei muss evtl. von Hand auf CurseForge geladen werden
    pub manual: bool,
    /// Bei `installed`: Name der vorhandenen Datei, falls nicht über Vibe zugeordnet
    pub installed_as: Option<String>,
    /// Bei `installed`: nicht nötig, weil ein Ersatzprojekt mit demselben Zweck schon installiert ist
    pub covered_by: Option<String>,
    /// Standardauswahl
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SetPreview {
    pub instance_id: String,
    pub mc_version: String,
    pub loader: LoaderKind,
    pub items: Vec<PreviewItem>,
}

/// Was in der Instanz schon liegt (für „schon da“ und Konflikte).
struct Present {
    idx: ContentIndex,
    mod_ids: HashSet<String>,
    names: HashMap<String, String>,
}

async fn present(state: &AppState, instance_id: &str) -> AppResult<Present> {
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
fn merged_entries(set_ids: &[String], only: Option<&[String]>, all: &[sets::ModSet]) -> AppResult<Vec<(SetEntry, Vec<String>)>> {
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
async fn resolve(state: &AppState, e: &SetEntry, mc: &str, loader: LoaderKind) -> (Resolution, ProjectType, Option<String>) {
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
type AltProject<'a> = (Source, &'a str, &'a str, Option<String>);

fn alt_from(kind: AltKind, (source, project_id, title, icon): AltProject, v: &ProjectVersion, mc: Option<String>, recommended: bool) -> Alternative {
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
async fn find_alternatives(state: &AppState, e: &SetEntry, pt: ProjectType, mc: &str, loader: LoaderKind) -> Vec<Alternative> {
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
fn dep_infos(planned: &[Planned]) -> Vec<DepInfo> {
    planned
        .iter()
        .skip(1)
        .map(|p| DepInfo { key: sets::entry_key(p.source, &p.brief.id), title: p.brief.title.clone(), icon_url: p.brief.icon_url.clone(), version_number: p.version.version_number.clone() })
        .collect()
}

fn base_item(e: SetEntry, set_ids: Vec<String>, status: ItemStatus) -> PreviewItem {
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

async fn preview_item(state: &AppState, inst: &Instance, pres: &Present, e: SetEntry, set_ids: Vec<String>) -> PreviewItem {
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

// ------------------------------------------------------------------ Prüfung ohne Instanz (Neue Instanz)

#[derive(Debug, Clone, Serialize)]
pub struct CheckMissing {
    pub title: String,
    pub icon_url: Option<String>,
    pub reason: Reason,
}

#[derive(Debug, Clone, Serialize)]
pub struct SetCheck {
    pub total: u32,
    pub available: u32,
    pub missing: Vec<CheckMissing>,
}

/// Wie viele Projekte der Sets gibt es für Version + Loader? (ohne Abhängigkeiten)
pub async fn check(state: &AppState, set_ids: &[String], mc: &str, loader: LoaderKind) -> AppResult<SetCheck> {
    let all = sets::all(&state.paths);
    let entries = merged_entries(set_ids, None, &all)?;
    let total = entries.len() as u32;
    let futs: Vec<_> = entries
        .into_iter()
        .map(|(e, _)| async move {
            let (r, _, _) = resolve(state, &e, mc, loader).await;
            (e, r)
        })
        .collect();
    let results: Vec<(SetEntry, Resolution)> = futures::stream::iter(futs).buffered(6).collect().await;
    let mut missing = Vec::new();
    for (e, r) in results {
        if let Resolution::Unavailable { reason, .. } = r {
            missing.push(CheckMissing { title: e.title, icon_url: e.icon_url, reason });
        }
    }
    Ok(SetCheck { total, available: total - missing.len() as u32, missing })
}

// ------------------------------------------------------------------ Angewendete Sets je Instanz

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AppliedSet {
    pub applied_at: i64,
    /// Einträge (Schlüssel), die beim Anwenden schon im Set waren oder als „gesehen“ markiert wurden
    pub known: BTreeSet<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Applied {
    pub sets: BTreeMap<String, AppliedSet>,
}

fn applied_path(state_paths: &crate::paths::Paths, instance_id: &str) -> PathBuf {
    state_paths.instance_dir(instance_id).join("mod_sets_applied.json")
}

pub fn load_applied(paths: &crate::paths::Paths, instance_id: &str) -> Applied {
    std::fs::read(applied_path(paths, instance_id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save_applied(paths: &crate::paths::Paths, instance_id: &str, a: &Applied) -> AppResult<()> {
    crate::util::write_json_atomic(&applied_path(paths, instance_id), a)
}

/// Neue Einträge seit dem Anwenden (noch nicht bekannt und nicht installiert).
pub fn new_entries<'a>(set: &'a sets::ModSet, applied: &AppliedSet, idx: &ContentIndex) -> Vec<&'a SetEntry> {
    set.entries.iter().filter(|e| !applied.known.contains(&e.key()) && !idx.has_project(e.source, &e.project_id)).collect()
}

/// Instanz -> angewendete Sets.
pub fn usage(state: &AppState) -> Vec<(String, Vec<String>)> {
    state.instances.list().into_iter().map(|i| (i.id.clone(), load_applied(&state.paths, &i.id).sets.into_keys().collect::<Vec<_>>())).filter(|(_, s)| !s.is_empty()).collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct SetNews {
    pub set_id: String,
    pub name: String,
    pub new_entries: Vec<SetEntry>,
}

pub fn news(state: &AppState, instance_id: &str) -> AppResult<Vec<SetNews>> {
    state.instances.get(instance_id)?;
    let applied = load_applied(&state.paths, instance_id);
    if applied.sets.is_empty() {
        return Ok(vec![]);
    }
    let idx = ContentIndex::load(&state.paths, instance_id);
    let all = sets::all(&state.paths);
    Ok(applied
        .sets
        .iter()
        .filter_map(|(sid, a)| {
            let set = all.iter().find(|s| &s.id == sid)?;
            let n: Vec<SetEntry> = new_entries(set, a, &idx).into_iter().cloned().collect();
            (!n.is_empty()).then(|| SetNews { set_id: sid.clone(), name: set.name.clone(), new_entries: n })
        })
        .collect())
}

/// Alle aktuellen Einträge als gesehen markieren („Nicht installieren“). `forget`: Set nicht mehr verfolgen.
pub fn dismiss_news(state: &AppState, instance_id: &str, set_id: &str, forget: bool) -> AppResult<()> {
    let mut applied = load_applied(&state.paths, instance_id);
    if forget {
        applied.sets.remove(set_id);
    } else if let Ok(set) = sets::get(&state.paths, set_id) {
        let a = applied.sets.entry(set_id.to_string()).or_default();
        a.known.extend(set.entries.iter().map(SetEntry::key));
    }
    save_applied(&state.paths, instance_id, &applied)
}

fn record_applied(state: &AppState, instance_id: &str, set_ids: &[String]) -> AppResult<()> {
    let mut applied = load_applied(&state.paths, instance_id);
    let all = sets::all(&state.paths);
    for sid in set_ids {
        let Some(set) = all.iter().find(|s| &s.id == sid) else { continue };
        let a = applied.sets.entry(sid.clone()).or_default();
        a.applied_at = crate::util::now_ms();
        a.known.extend(set.entries.iter().map(SetEntry::key));
    }
    save_applied(&state.paths, instance_id, &applied)
}

// ------------------------------------------------------------------ Installation

/// Ausgewähltes Projekt (Eintrag oder Alternative), optional mit fester Version.
#[derive(Debug, Clone, Deserialize)]
pub struct Pick {
    pub source: Source,
    pub project_id: String,
    #[serde(default)]
    pub version_id: Option<String>,
}

fn set_names(state: &AppState, set_ids: &[String]) -> String {
    let all = sets::all(&state.paths);
    let names: Vec<String> = set_ids.iter().filter_map(|id| all.iter().find(|s| &s.id == id).map(|s| format!("„{}“", s.name))).collect();
    names.join(", ")
}

/// Task-Körper: Sets anwenden. `picks = None`: alles Verfügbare ohne Konflikte (neue Instanz, „Mit Sets starten“).
/// `snapshot`: vorher Sicherung (bei bestehenden Instanzen).
pub async fn run_apply(state: AppState, task: TaskHandle, instance_id: String, set_ids: Vec<String>, picks: Option<Vec<Pick>>, snapshot: bool) -> AppResult<()> {
    let inst = state.instances.get(&instance_id)?;
    let names = set_names(&state, &set_ids);
    task.set_title(format!("Mod-Set {names} anwenden"));
    let mut skipped = 0usize;
    let picks = match picks {
        Some(p) => p,
        None => {
            task.stage("Suche passende Versionen …", None);
            let pv = preview(&state, &instance_id, &set_ids, None).await?;
            skipped = pv.items.iter().filter(|i| matches!(i.status, ItemStatus::Unavailable | ItemStatus::Conflict)).count();
            pv.items
                .into_iter()
                .filter(|i| i.selected)
                .map(|i| Pick { source: i.entry.source, project_id: i.entry.project_id, version_id: i.version_id })
                .collect()
        }
    };
    task.check()?;
    if picks.is_empty() {
        record_applied(&state, &instance_id, &set_ids)?;
        task.message(if skipped > 0 { format!("Nichts installiert – {skipped} Inhalt(e) passen nicht zu dieser Instanz") } else { "Alles war schon installiert".into() });
        return Ok(());
    }
    if snapshot {
        task.stage("Sicherung wird erstellt …", None);
        if let Err(e) = super::snapshots::create(&state, &instance_id, &format!("Vor Mod-Set {names}"), true, None).await {
            tracing::warn!("Snapshot vor Mod-Set fehlgeschlagen: {e}");
        }
        task.check()?;
    }
    task.stage("Löse Abhängigkeiten auf …", Some(0.05));
    let (_, idx) = install::refresh_all(&state, &instance_id).await?;
    let mut plans: Vec<Vec<Planned>> = Vec::new();
    let mut warnings = Vec::new();
    let mut failed = Vec::new();
    // Je Projekt einzeln planen: ein nicht installierbares Projekt bricht die übrigen nicht ab
    for p in picks {
        task.check()?;
        match install::plan(&state, &inst, &idx, vec![(p.source, p.project_id.clone(), p.version_id.clone())], &mut warnings).await {
            Ok(list) => plans.push(list),
            Err(e) => failed.push(format!("{}: {e}", p.project_id)),
        }
    }
    let planned = merge_plans(plans);
    for w in &warnings {
        tracing::warn!("Mod-Set {instance_id}: {w}");
    }
    let n = planned.iter().filter(|p| p.file.url.is_some()).count();
    task.stage(format!("Lade {n} Datei(en) …"), Some(0.15));
    let missing = install::apply(&state, &inst, planned, &task.sub(0.15, 1.0)).await?;
    if !missing.is_empty() {
        super::missing::watch(&state, &instance_id, super::missing::WATCH_FOR);
    }
    record_applied(&state, &instance_id, &set_ids)?;
    let mut msg = format!("{n} Datei(en) installiert");
    if !missing.is_empty() {
        msg.push_str(&format!(", {} manuell herunterzuladen", missing.len()));
    }
    if skipped + failed.len() > 0 {
        msg.push_str(&format!(", {} übersprungen", skipped + failed.len()));
    }
    if let Some(f) = failed.first() {
        tracing::warn!("Mod-Set {instance_id}: {f}");
    }
    task.message(msg);
    Ok(())
}

// ------------------------------------------------------------------ Kompatibilitätsübersicht

pub const MATRIX_LOADERS: [LoaderKind; 4] = [LoaderKind::Fabric, LoaderKind::Quilt, LoaderKind::Forge, LoaderKind::Neoforge];
const POPULAR_MC: &[&str] = &["1.20.1", "1.19.2", "1.18.2", "1.16.5", "1.12.2"];

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CompatCell {
    pub mc: String,
    pub loader: LoaderKind,
    pub available: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct EntryCompat {
    pub key: String,
    pub loaders: Vec<LoaderKind>,
    pub mc_min: Option<String>,
    pub mc_max: Option<String>,
    /// Konnte nicht geprüft werden
    pub error: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SetCompat {
    pub total: u32,
    pub mc_versions: Vec<String>,
    pub loaders: Vec<LoaderKind>,
    pub cells: Vec<CompatCell>,
    pub entries: Vec<EntryCompat>,
    /// Kombination mit den meisten verfügbaren Projekten (neueste Version bevorzugt)
    pub best: Option<CompatCell>,
}

pub type Support = HashSet<(String, LoaderKind)>;

/// Unterstützte (MC-Version, Loader)-Paare aus Versionen.
pub fn support_of(versions: &[ProjectVersion], pt: ProjectType) -> Support {
    let mut out = Support::new();
    let loaders = [LoaderKind::Vanilla, LoaderKind::Fabric, LoaderKind::Quilt, LoaderKind::Forge, LoaderKind::Neoforge];
    for v in versions {
        for g in v.game_versions.iter().filter(|g| mc_key(g).is_some()) {
            for l in loaders {
                if provider::compatible(v, pt, g, l) && !(pt == ProjectType::Mod && l == LoaderKind::Vanilla && provider::target_kind(pt, v, l, g) == ContentKind::Mod) {
                    out.insert((g.clone(), l));
                }
            }
        }
    }
    out
}

/// Spalten der Übersicht: neueste Versionen, beliebte ältere und die der eigenen Instanzen.
pub fn pick_mc_columns(supports: &[Support], own: &[String]) -> Vec<String> {
    let mut all: Vec<String> = supports.iter().flat_map(|s| s.iter().map(|(g, _)| g.clone())).collect::<BTreeSet<_>>().into_iter().collect();
    sort_mc_desc(&mut all);
    let mut cols: Vec<String> = all.iter().take(4).cloned().collect();
    for p in POPULAR_MC.iter().map(|s| s.to_string()).chain(own.iter().cloned()) {
        if all.contains(&p) && !cols.contains(&p) {
            cols.push(p);
        }
    }
    sort_mc_desc(&mut cols);
    cols.truncate(10);
    cols
}

pub fn build_matrix(supports: &[Support], mcs: &[String], loaders: &[LoaderKind]) -> Vec<CompatCell> {
    let mut out = Vec::new();
    for l in loaders {
        for mc in mcs {
            let n = supports.iter().filter(|s| s.contains(&(mc.clone(), *l))).count() as u32;
            out.push(CompatCell { mc: mc.clone(), loader: *l, available: n });
        }
    }
    out
}

pub fn best_cell(cells: &[CompatCell], mcs: &[String], loaders: &[LoaderKind]) -> Option<CompatCell> {
    cells
        .iter()
        .filter(|c| c.available > 0)
        .max_by(|a, b| {
            a.available
                .cmp(&b.available)
                .then_with(|| mcs.iter().position(|m| m == &b.mc).cmp(&mcs.iter().position(|m| m == &a.mc)))
                .then_with(|| loaders.iter().position(|l| *l == b.loader).cmp(&loaders.iter().position(|l| *l == a.loader)))
        })
        .cloned()
}

async fn entry_support(state: &AppState, e: &SetEntry) -> Option<Support> {
    match e.source {
        Source::Curseforge => {
            if !cf::available(state) {
                return None;
            }
            // Günstig: Index der neuesten Dateien je (Version, Loader) statt aller Dateien
            let m = cf::raw_mod(state, &e.project_id).await.ok()?;
            let pt = cf::project_type_of_class(m.class_id);
            let versions: Vec<ProjectVersion> = m
                .latest_files_indexes
                .iter()
                .map(|i| ProjectVersion {
                    source: Source::Curseforge,
                    id: i.file_id.to_string(),
                    project_id: e.project_id.clone(),
                    name: String::new(),
                    version_number: String::new(),
                    game_versions: vec![i.game_version.clone()],
                    loaders: i.mod_loader.and_then(cf::loader_name).map(|l| vec![l.to_string()]).unwrap_or_default(),
                    release_type: "release".into(),
                    date: String::new(),
                    downloads: 0,
                    files: vec![],
                    dependencies: vec![],
                    changelog: None,
                })
                .collect();
            Some(support_of(&versions, pt))
        }
        _ => {
            let (all, _, pt) = provider::versions_for(state, e.source, &e.project_id, None, None).await.ok()?;
            Some(support_of(&all, pt))
        }
    }
}

pub async fn compat(state: &AppState, set_id: &str) -> AppResult<SetCompat> {
    let set = sets::get(&state.paths, set_id)?;
    let futs: Vec<_> = set.entries.iter().map(|e| async move { (e.key(), entry_support(state, e).await) }).collect();
    let results: Vec<(String, Option<Support>)> = futures::stream::iter(futs).buffered(6).collect().await;
    let supports: Vec<Support> = results.iter().map(|(_, s)| s.clone().unwrap_or_default()).collect();
    let own: Vec<String> = state.instances.list().into_iter().map(|i| i.mc_version).collect();
    let mcs = pick_mc_columns(&supports, &own);
    let mut loaders: Vec<LoaderKind> = MATRIX_LOADERS.to_vec();
    if !set.entries.iter().any(|e| e.project_type == ProjectType::Mod) {
        loaders.insert(0, LoaderKind::Vanilla);
    }
    let cells = build_matrix(&supports, &mcs, &loaders);
    let best = best_cell(&cells, &mcs, &loaders);
    let entries = results
        .iter()
        .map(|(key, s)| {
            let Some(s) = s else { return EntryCompat { key: key.clone(), loaders: vec![], mc_min: None, mc_max: None, error: true } };
            let ls: Vec<LoaderKind> = loaders.iter().copied().filter(|l| s.iter().any(|(_, x)| x == l)).collect();
            let mut mcs: Vec<String> = s.iter().map(|(g, _)| g.clone()).collect::<BTreeSet<_>>().into_iter().collect();
            sort_mc_desc(&mut mcs);
            EntryCompat { key: key.clone(), loaders: ls, mc_min: mcs.last().cloned(), mc_max: mcs.first().cloned(), error: false }
        })
        .collect();
    Ok(SetCompat { total: set.entries.len() as u32, mc_versions: mcs, loaders, cells, entries, best })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(id: &str, date: &str, rt: &str, mcs: &[&str], loaders: &[&str]) -> ProjectVersion {
        ProjectVersion {
            source: Source::Modrinth,
            id: id.into(),
            project_id: "p".into(),
            name: id.into(),
            version_number: id.into(),
            game_versions: mcs.iter().map(|s| s.to_string()).collect(),
            loaders: loaders.iter().map(|s| s.to_string()).collect(),
            release_type: rt.into(),
            date: date.into(),
            downloads: 0,
            files: vec![],
            dependencies: vec![],
            changelog: None,
        }
    }

    fn sodium_like() -> Vec<ProjectVersion> {
        vec![
            v("f-1214-beta", "2025-03", "beta", &["1.21.4"], &["fabric"]),
            v("f-1214", "2025-02", "release", &["1.21.4"], &["fabric", "quilt"]),
            v("n-1214", "2025-02", "release", &["1.21.4"], &["neoforge"]),
            v("f-1211", "2024-10", "release", &["1.21", "1.21.1"], &["fabric"]),
            v("f-1201", "2024-01", "release", &["1.20.1"], &["fabric"]),
        ]
    }

    #[test]
    fn resolves_per_version_and_loader() {
        let all = sodium_like();
        // Fabric 1.21.4: stabile Version vor neuerer Beta
        match classify(&all, ProjectType::Mod, "1.21.4", LoaderKind::Fabric) {
            Resolution::Ok(x) => assert_eq!(x.id, "f-1214"),
            r => panic!("{r:?}"),
        }
        // Quilt nutzt Fabric-Dateien
        match classify(&all, ProjectType::Mod, "1.20.1", LoaderKind::Quilt) {
            Resolution::Ok(x) => assert_eq!(x.id, "f-1201"),
            r => panic!("{r:?}"),
        }
        match classify(&all, ProjectType::Mod, "1.21.4", LoaderKind::Neoforge) {
            Resolution::Ok(x) => assert_eq!(x.id, "n-1214"),
            r => panic!("{r:?}"),
        }
    }

    #[test]
    fn explains_unavailable() {
        let all = sodium_like();
        // Forge: gibt es nicht – Loader-Liste für diese Version
        match classify(&all, ProjectType::Mod, "1.21.4", LoaderKind::Forge) {
            Resolution::Unavailable { reason, loaders, older, .. } => {
                assert_eq!(reason, Reason::OtherLoader);
                assert_eq!(loaders, vec!["fabric", "quilt", "neoforge"]);
                assert!(older.is_none());
            }
            r => panic!("{r:?}"),
        }
        // Fabric 1.21.5: noch nicht – nächstältere als Alternative (nur auf Wunsch)
        match classify(&all, ProjectType::Mod, "1.21.5", LoaderKind::Fabric) {
            Resolution::Unavailable { reason, mc_range, older, .. } => {
                assert_eq!(reason, Reason::OtherMc);
                assert_eq!(mc_range, Some(("1.20.1".into(), "1.21.4".into())));
                let (ov, g) = older.unwrap();
                assert_eq!(ov.id, "f-1214");
                assert_eq!(g, "1.21.4");
            }
            r => panic!("{r:?}"),
        }
        // Neoforge 1.21.1: es gibt Fabric für 1.21.1 -> anderer Loader; ältere Neoforge-Version gibt es nicht
        match classify(&all, ProjectType::Mod, "1.21.1", LoaderKind::Neoforge) {
            Resolution::Unavailable { reason, loaders, older, .. } => {
                assert_eq!(reason, Reason::OtherLoader);
                assert_eq!(loaders, vec!["fabric"]);
                assert!(older.is_none());
            }
            r => panic!("{r:?}"),
        }
        // Vanilla braucht einen Loader
        assert!(matches!(classify(&all, ProjectType::Mod, "1.21.4", LoaderKind::Vanilla), Resolution::Unavailable { reason: Reason::NeedsLoader, .. }));
        assert!(matches!(classify(&[], ProjectType::Mod, "1.21.4", LoaderKind::Fabric), Resolution::Unavailable { reason: Reason::NoFiles, .. }));
        assert!(matches!(classify(&all, ProjectType::Modpack, "1.21.4", LoaderKind::Fabric), Resolution::Unavailable { reason: Reason::Modpack, .. }));
    }

    #[test]
    fn datapack_variant_and_loaderless_types() {
        // Mod mit Datapack-Variante: Vanilla bekommt die Datapack-Datei
        let all = vec![v("dp", "2024-05", "release", &["1.21.1"], &["datapack"]), v("fab", "2024-05", "release", &["1.21.1"], &["fabric"])];
        match classify(&all, ProjectType::Mod, "1.21.1", LoaderKind::Vanilla) {
            Resolution::Ok(x) => assert_eq!(x.id, "dp"),
            r => panic!("{r:?}"),
        }
        match classify(&all, ProjectType::Mod, "1.21.1", LoaderKind::Fabric) {
            Resolution::Ok(x) => assert_eq!(x.id, "fab"),
            r => panic!("{r:?}"),
        }
        // Shader/Resourcepacks: Loader egal, nur die Version zählt
        let sh = vec![v("s", "2024", "release", &["1.20.1", "1.21.1"], &["iris", "optifine"])];
        assert!(matches!(classify(&sh, ProjectType::Shader, "1.21.1", LoaderKind::Forge), Resolution::Ok(_)));
        assert!(matches!(classify(&sh, ProjectType::Shader, "1.21.4", LoaderKind::Fabric), Resolution::Unavailable { reason: Reason::OtherMc, .. }));
    }

    #[test]
    fn mc_versions() {
        assert_eq!(mc_cmp("1.21.10", "1.21.9"), Some(Ordering::Greater));
        assert_eq!(mc_cmp("1.21", "1.21.0"), Some(Ordering::Equal));
        assert_eq!(mc_cmp("24w10a", "1.21"), None);
        let mut v = vec!["1.20.1".to_string(), "1.21.4".into(), "1.9".into()];
        sort_mc_desc(&mut v);
        assert_eq!(v, vec!["1.21.4", "1.20.1", "1.9"]);
    }

    #[test]
    fn conflicts_and_installed() {
        let ids: HashSet<String> = ["optifine".to_string(), "fabric-api".into()].into_iter().collect();
        assert_eq!(group_conflicts("sodium", &ids), vec!["optifine"]);
        assert_eq!(group_conflicts("iris", &ids), vec!["optifine"]);
        assert!(group_conflicts("lithium", &ids).is_empty());
        let e = SetEntry { source: Source::Modrinth, project_id: "P7dR8mSH".into(), slug: Some("fabric-api".into()), title: "Fabric API".into(), icon_url: None, project_type: ProjectType::Mod, added: 0 };
        assert!(same_project(&e, &ids, &HashMap::new()).is_some());
        let names: HashMap<String, String> = [(norm("Xaero's Minimap"), "Xaero's Minimap".to_string())].into_iter().collect();
        let x = SetEntry { slug: None, title: "Xaero's Minimap".into(), ..e.clone() };
        assert_eq!(same_project(&x, &HashSet::new(), &names).as_deref(), Some("Xaero's Minimap"));
        let y = SetEntry { slug: Some("sodium".into()), title: "Sodium".into(), ..e };
        assert!(same_project(&y, &ids, &names).is_none());
    }

    #[test]
    fn news_after_apply() {
        let set = sets::ModSet {
            id: "s".into(),
            name: "Performance".into(),
            description: None,
            created: 0,
            updated: 0,
            entries: vec![
                SetEntry { source: Source::Modrinth, project_id: "a".into(), slug: None, title: "A".into(), icon_url: None, project_type: ProjectType::Mod, added: 0 },
                SetEntry { source: Source::Modrinth, project_id: "b".into(), slug: None, title: "B".into(), icon_url: None, project_type: ProjectType::Mod, added: 0 },
                SetEntry { source: Source::Modrinth, project_id: "c".into(), slug: None, title: "C".into(), icon_url: None, project_type: ProjectType::Mod, added: 0 },
            ],
        };
        let applied = AppliedSet { applied_at: 1, known: ["modrinth:a".to_string()].into_iter().collect() };
        let mut idx = ContentIndex::default();
        idx.files.insert(
            "mods/c.jar".into(),
            super::super::index::IndexEntry {
                source: Source::Modrinth,
                project_id: "c".into(),
                version_id: "1".into(),
                sha1: None,
                sha512: None,
                title: None,
                icon_url: None,
                version_number: None,
                url: None,
                size: None,
                date: None,
                release_type: None,
                side: None,
            },
        );
        // b ist neu; c ist neu im Set, aber schon installiert
        let n: Vec<&str> = new_entries(&set, &applied, &idx).iter().map(|e| e.project_id.as_str()).collect();
        assert_eq!(n, vec!["b"]);
    }

    fn planned(id: &str, title: &str) -> Planned {
        let mut ver = v(&format!("{id}-v"), "2025", "release", &["1.21.4"], &["fabric"]);
        ver.files = vec![VersionFile { url: Some(format!("https://cdn.example/{id}.jar")), filename: format!("{id}.jar"), size: 1, sha1: None, primary: true, sha512: None, fingerprint: None }];
        Planned {
            brief: provider::Brief { id: id.into(), title: title.into(), icon_url: None, project_type: ProjectType::Mod, page_url: String::new(), side: None },
            source: Source::Modrinth,
            kind: ContentKind::Mod,
            file: ver.files[0].clone(),
            version: ver,
            side: None,
        }
    }

    #[test]
    fn dependencies_merged_and_listed() {
        // Mod Menu braucht Fabric API, Iris braucht Sodium; Fabric API wird von zwei Projekten gebraucht
        let a = vec![planned("modmenu", "Mod Menu"), planned("fabric-api", "Fabric API")];
        let b = vec![planned("iris", "Iris"), planned("sodium", "Sodium"), planned("fabric-api", "Fabric API")];
        let deps = dep_infos(&b);
        assert_eq!(deps.iter().map(|d| d.title.as_str()).collect::<Vec<_>>(), vec!["Sodium", "Fabric API"]);
        assert_eq!(deps[0].key, "modrinth:sodium");
        assert!(dep_infos(&a[..1]).is_empty());
        let merged = merge_plans(vec![a, b, vec![planned("sodium", "Sodium")]]);
        assert_eq!(merged.iter().map(|p| p.brief.id.as_str()).collect::<Vec<_>>(), vec!["modmenu", "fabric-api", "iris", "sodium"]);
    }

    #[test]
    fn compat_matrix() {
        let a = support_of(&sodium_like(), ProjectType::Mod);
        assert!(a.contains(&("1.21.4".into(), LoaderKind::Quilt)));
        assert!(!a.contains(&("1.21.4".into(), LoaderKind::Forge)));
        assert!(!a.contains(&("1.21.4".into(), LoaderKind::Vanilla)));
        let b = support_of(&[v("b", "1", "release", &["1.21.4", "1.20.1"], &["forge", "fabric"])], ProjectType::Mod);
        let supports = vec![a, b];
        let cols = pick_mc_columns(&supports, &["1.21".to_string()]);
        assert_eq!(cols, vec!["1.21.4", "1.21.1", "1.21", "1.20.1"]);
        let cells = build_matrix(&supports, &cols, &MATRIX_LOADERS);
        let get = |mc: &str, l: LoaderKind| cells.iter().find(|c| c.mc == mc && c.loader == l).unwrap().available;
        assert_eq!(get("1.21.4", LoaderKind::Fabric), 2);
        assert_eq!(get("1.21.4", LoaderKind::Forge), 1);
        assert_eq!(get("1.20.1", LoaderKind::Neoforge), 1); // NeoForge 1.20.1 nimmt Forge-Dateien
        assert_eq!(get("1.21.4", LoaderKind::Neoforge), 1);
        assert_eq!(get("1.21.1", LoaderKind::Forge), 0);
        let best = best_cell(&cells, &cols, &MATRIX_LOADERS).unwrap();
        assert_eq!((best.mc.as_str(), best.loader, best.available), ("1.21.4", LoaderKind::Fabric, 2));
    }
}
