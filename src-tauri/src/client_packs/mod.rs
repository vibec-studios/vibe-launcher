//! Client-Packs: eine Auswahl von Client-Mods, die man mit einem Klick in eine Instanz installiert.
//!
//! - **Definition** (`PACKS`): ID, Kategorie (offiziell/Community), Quelle (Vibe-Backend, NoRisk-Liste,
//!   Modrinth-Projekte), Ausschluss-Gruppe und Kompatibilitätsregeln (Loader). Neue Packs = ein Eintrag mehr;
//!   Modrinth-Packs brauchen nur die Projekt-IDs.
//! - **Ausschluss**: Packs derselben Gruppe (`client`: Vibey, NoRisk, NoRisk Mini) gehen nur einzeln. Vor dem
//!   Installieren werden die anderen nach Bestätigung (in der Oberfläche) sauber entfernt.
//! - **Zustand**: `instances/<id>/client-packs.json` (Version, Dateien, Modrinth-Projekte je Pack). Der Vibey
//!   Client behält seinen eigenen Zustand (`vibey-client.json`, siehe `vibey_client::install`) und wird hier
//!   nur eingebunden.
//! - **Updates**: Vibey über das Manifest (wie bisher, auch still vor dem Start), NoRisk über den Jar-Namen hinter
//!   dem offiziellen Link (nur auf Klick), Modrinth-Packs über die normalen Inhalts-Updates.
pub mod commands;
pub mod norisk;

use crate::content::index::ContentIndex;
use crate::content::{install as cinstall, local, provider, ContentKind, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{Instance, LoaderKind};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use crate::vibey_client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ------------------------------------------------------------------ Definitionen

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Official,
    Community,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackSource {
    /// Vibey Client über `/api/v1/client/latest` (vorhandene Verteilung)
    Vibey,
    /// Öffentliche Download-Liste von norisk.gg
    Norisk(norisk::Flavor),
    /// Modrinth-Projekte als (Projekt-ID, Mod-IDs zur Erkennung schon vorhandener Dateien), mit Pflicht-Abhängigkeiten
    Modrinth(&'static [(&'static str, &'static [&'static str])]),
}

impl PackSource {
    fn kind(&self) -> &'static str {
        match self {
            PackSource::Vibey => "vibe",
            PackSource::Norisk(_) => "norisk",
            PackSource::Modrinth(_) => "modrinth",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PackDef {
    pub id: &'static str,
    pub category: Category,
    pub source: PackSource,
    /// Packs derselben Gruppe schließen sich gegenseitig aus
    pub group: Option<&'static str>,
    /// Unterstützte Loader (genaue Versionen liefert die Quelle)
    pub loaders: &'static [LoaderKind],
    /// Weitere Packs, die nicht zusammen mit diesem gehen (gilt in beide Richtungen)
    pub conflicts: &'static [&'static str],
    /// Herausgeber (Community-Packs: „Von …, nicht mit Vibe verbunden“)
    pub vendor: Option<&'static str>,
    pub homepage: Option<&'static str>,
}

/// Gruppe der Clients: nur einer je Instanz.
pub const GROUP_CLIENT: &str = "client";

pub static PACKS: &[PackDef] = &[
    PackDef {
        id: "vibey",
        category: Category::Official,
        source: PackSource::Vibey,
        group: Some(GROUP_CLIENT),
        loaders: &[LoaderKind::Fabric, LoaderKind::Neoforge],
        conflicts: &[],
        vendor: None,
        homepage: None,
    },
    PackDef {
        id: "norisk",
        category: Category::Community,
        source: PackSource::Norisk(norisk::Flavor::Standalone),
        group: Some(GROUP_CLIENT),
        loaders: &[LoaderKind::Fabric, LoaderKind::Forge, LoaderKind::Neoforge],
        conflicts: &[],
        vendor: Some("NoRisk"),
        homepage: Some(norisk::WEBSITE),
    },
    PackDef {
        id: "norisk-mini",
        category: Category::Community,
        source: PackSource::Norisk(norisk::Flavor::Mini),
        group: Some(GROUP_CLIENT),
        loaders: &[LoaderKind::Fabric, LoaderKind::Forge, LoaderKind::Neoforge],
        conflicts: &[],
        vendor: Some("NoRisk"),
        homepage: Some(norisk::WEBSITE),
    },
    // Modrinth-Pack: Essential (ARR, vom Autor selbst auf Modrinth veröffentlicht; Laden nur über die
    // Modrinth-API, unverändert). Bringt eigene Cosmetics/Menüs/Social mit -> Client-Gruppe.
    PackDef {
        id: "essential",
        category: Category::Community,
        source: PackSource::Modrinth(&[("k2ZPuTBm", &["essential", "essential-container"])]),
        group: Some(GROUP_CLIENT),
        loaders: &[LoaderKind::Fabric, LoaderKind::Forge, LoaderKind::Neoforge],
        conflicts: &[],
        vendor: Some("Essential (Spark Universe)"),
        homepage: Some("https://modrinth.com/mod/essential"),
    },
];

pub fn def(id: &str) -> Option<&'static PackDef> {
    PACKS.iter().find(|p| p.id == id)
}

/// Gehen zwei Packs nicht zusammen? (gleiche Gruppe oder ausdrücklicher Konflikt, symmetrisch)
pub fn excludes(a: &PackDef, b: &PackDef) -> bool {
    a.id != b.id && ((a.group.is_some() && a.group == b.group) || a.conflicts.contains(&b.id) || b.conflicts.contains(&a.id))
}

/// Installierte Packs, die vor dem Installieren von `id` entfernt werden müssen.
pub fn to_replace(id: &str, installed: &[String]) -> Vec<String> {
    let Some(d) = def(id) else { return vec![] };
    installed.iter().filter(|other| def(other).is_some_and(|o| excludes(d, o))).cloned().collect()
}

// ------------------------------------------------------------------ Zustand je Instanz

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(default)]
pub struct InstalledPack {
    pub id: String,
    /// Version des Packs (NoRisk: aus dem Jar-Namen)
    pub version: Option<String>,
    /// Vom Pack angelegte Dateien in `mods/` (ohne `.disabled`)
    pub files: Vec<String>,
    /// Vom Pack installierte Modrinth-Projekte (nur diese werden beim Entfernen gelöscht)
    pub projects: Vec<String>,
    /// Für welche Instanz-Version installiert
    pub mc_version: String,
    pub loader: String,
    pub installed_at: i64,
    /// Offizieller Link, über den geladen wurde
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct PacksFile {
    pub packs: Vec<InstalledPack>,
}

impl PacksFile {
    pub fn get(&self, id: &str) -> Option<&InstalledPack> {
        self.packs.iter().find(|p| p.id == id)
    }
    pub fn upsert(&mut self, p: InstalledPack) {
        self.packs.retain(|x| x.id != p.id);
        self.packs.push(p);
    }
    pub fn remove(&mut self, id: &str) -> Option<InstalledPack> {
        let i = self.packs.iter().position(|p| p.id == id)?;
        Some(self.packs.remove(i))
    }
}

fn state_path(state: &AppState, id: &str) -> PathBuf {
    state.paths.instance_dir(id).join("client-packs.json")
}

pub fn load(state: &AppState, id: &str) -> PacksFile {
    std::fs::read(state_path(state, id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save(state: &AppState, id: &str, f: &PacksFile) -> AppResult<()> {
    if !state.paths.instance_dir(id).exists() {
        return Ok(());
    }
    crate::util::write_json_atomic(&state_path(state, id), f)
}

fn mods_dir(state: &AppState, id: &str) -> PathBuf {
    state.paths.game_dir(id).join("mods")
}

/// Liegt die Datei (aktiv oder deaktiviert) in `mods/`? -> (Pfad, aktiv)
fn find_file(state: &AppState, id: &str, file: &str) -> Option<(PathBuf, bool)> {
    let p = mods_dir(state, id).join(file);
    if p.is_file() {
        return Some((p, true));
    }
    let d = mods_dir(state, id).join(format!("{file}.disabled"));
    d.is_file().then_some((d, false))
}

/// Ist ein gemerktes Pack noch da? (Dateien bzw. Modrinth-Projekte nicht alle von Hand gelöscht)
fn present(state: &AppState, id: &str, p: &InstalledPack, idx: &ContentIndex) -> bool {
    if !p.files.is_empty() && p.files.iter().any(|f| find_file(state, id, f).is_some()) {
        return true;
    }
    if !p.projects.is_empty() {
        return p.projects.iter().any(|pid| idx.has_project(Source::Modrinth, pid));
    }
    p.files.is_empty() && p.projects.is_empty()
}

/// IDs der installierten Packs (inklusive Vibey Client, falls eingeschaltet).
pub fn installed_ids(state: &AppState, id: &str) -> Vec<String> {
    let idx = ContentIndex::load(&state.paths, id);
    let mut out: Vec<String> = load(state, id).packs.iter().filter(|p| present(state, id, p, &idx)).map(|p| p.id.clone()).collect();
    if vibey_client::install::load(state, id).enabled {
        out.insert(0, "vibey".into());
    }
    out
}

// ------------------------------------------------------------------ Angebot (für die Oberfläche)

#[derive(Debug, Clone, Serialize, Default)]
pub struct PackInstall {
    pub version: Option<String>,
    pub files: Vec<String>,
    pub mc_version: Option<String>,
    pub loader: Option<String>,
    pub installed_at: Option<i64>,
    /// Datei in der Inhalte-Liste deaktiviert
    pub disabled_by_user: bool,
    /// Datei fehlt (z. B. von Hand gelöscht oder Version passte nicht mehr)
    pub missing: bool,
    /// Instanz hat inzwischen eine andere MC-Version/einen anderen Loader
    pub mismatch: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PackOffer {
    pub id: &'static str,
    pub category: Category,
    /// "vibe" | "norisk" | "modrinth"
    pub source: &'static str,
    pub group: Option<&'static str>,
    pub vendor: Option<&'static str>,
    pub homepage: Option<&'static str>,
    /// Modrinth-Projekte des Packs
    pub projects: Vec<&'static str>,
    /// Passt zur Instanz? `None` = unbekannt (Quelle nicht erreichbar)
    pub available: Option<bool>,
    /// Warum nicht: "loader" | "version" | "vibe_off" | "unreachable"
    pub reason: Option<&'static str>,
    pub error: Option<String>,
    /// Unterstützte MC-Versionen für den Loader (Hinweis bei „passt nicht“)
    pub mc_versions: Vec<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub installed: Option<PackInstall>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PacksOverview {
    pub mc_version: String,
    pub loader: LoaderKind,
    pub vibe_enabled: bool,
    pub packs: Vec<PackOffer>,
}

fn base_offer(d: &PackDef) -> PackOffer {
    PackOffer {
        id: d.id,
        category: d.category,
        source: d.source.kind(),
        group: d.group,
        vendor: d.vendor,
        homepage: d.homepage,
        projects: match d.source {
            PackSource::Modrinth(p) => p.iter().map(|(id, _)| *id).collect(),
            _ => vec![],
        },
        available: None,
        reason: None,
        error: None,
        mc_versions: vec![],
        latest_version: None,
        update_available: false,
        installed: None,
    }
}

/// Packs mit Verfügbarkeit für Minecraft-Version + Loader, bei `instance` zusätzlich mit Installationsstand.
pub async fn overview(state: &AppState, instance: Option<&Instance>, mc: &str, loader: LoaderKind) -> PacksOverview {
    let vibe_enabled = state.settings().vibe.enabled;
    let futs = PACKS.iter().map(|d| offer(state, d, instance, mc, loader, vibe_enabled));
    let packs = futures::future::join_all(futs).await;
    PacksOverview { mc_version: mc.to_string(), loader, vibe_enabled, packs }
}

async fn offer(state: &AppState, d: &'static PackDef, instance: Option<&Instance>, mc: &str, loader: LoaderKind, vibe_enabled: bool) -> PackOffer {
    let mut o = base_offer(d);
    let loader_ok = d.loaders.contains(&loader);
    if !loader_ok {
        o.available = Some(false);
        o.reason = Some("loader");
    }
    match d.source {
        PackSource::Vibey => {
            if let Some(inst) = instance {
                let s = vibey_client::install::load(state, &inst.id);
                if s.enabled {
                    let st = vibey_client::install::status(state, &inst.id).await.ok();
                    o.installed = Some(PackInstall {
                        version: st.as_ref().and_then(|x| x.installed_version.clone()).or(s.version.clone()),
                        files: s.file.clone().into_iter().collect(),
                        mc_version: s.mc_version.clone(),
                        loader: s.loader.clone(),
                        installed_at: s.installed_at,
                        disabled_by_user: st.as_ref().is_some_and(|x| x.disabled_by_user),
                        missing: st.as_ref().is_some_and(|x| !x.present),
                        mismatch: s.mc_version.as_deref().is_some_and(|v| v != inst.mc_version),
                    });
                    if let Some(st) = &st {
                        o.update_available = st.update_available;
                    }
                }
            }
            if !vibe_enabled {
                o.available = Some(false);
                o.reason = Some("vibe_off");
                return o;
            }
            if !loader_ok {
                return o;
            }
            match vibey_client::latest(state, false).await {
                Ok(rel) => {
                    let lname = vibey_client::install::loader_name(loader).unwrap_or("");
                    let f = rel.file_for(lname, mc);
                    o.available = Some(f.is_some());
                    if f.is_none() {
                        o.reason = Some("version");
                    }
                    o.mc_versions = rel.mc_versions(lname);
                    o.mc_versions.reverse();
                    o.latest_version = Some(rel.version.clone());
                }
                Err(e) => {
                    o.reason = Some("unreachable");
                    o.error = Some(e.to_string());
                }
            }
        }
        PackSource::Norisk(flavor) => {
            let rec = instance.and_then(|i| load(state, &i.id).get(d.id).cloned().map(|r| (i, r)));
            if let Some((inst, r)) = &rec {
                let file = r.files.first().and_then(|f| find_file(state, &inst.id, f));
                o.installed = Some(PackInstall {
                    version: r.version.as_deref().map(|v| norisk::display_version(v).to_string()),
                    files: r.files.clone(),
                    mc_version: Some(r.mc_version.clone()),
                    loader: Some(r.loader.clone()),
                    installed_at: Some(r.installed_at),
                    disabled_by_user: file.as_ref().is_some_and(|(_, on)| !on),
                    missing: file.is_none(),
                    mismatch: r.mc_version != inst.mc_version || Some(r.loader.as_str()) != norisk::loader_name(inst.loader.kind),
                });
            }
            if !loader_ok {
                return o;
            }
            match norisk::list(false).await {
                Ok(list) => {
                    o.mc_versions = list.mc_versions(flavor, loader);
                    let entry = list.select(flavor, mc, loader);
                    o.available = Some(entry.is_some());
                    if entry.is_none() {
                        o.reason = Some("version");
                    }
                    if let (Some(e), Some((_, r))) = (entry, &rec) {
                        // Update nur für installierte Packs prüfen (ein GET ohne Weiterleitung, kein Download)
                        match norisk::latest_file(e).await {
                            Ok(f) => {
                                o.latest_version = norisk::version_from_file(&f, flavor).map(|v| norisk::display_version(&v).to_string());
                                o.update_available = r.files.first() != Some(&f);
                            }
                            Err(err) => o.error = Some(err.to_string()),
                        }
                    }
                    if let Some(i) = o.installed.as_mut() {
                        if i.mismatch || i.missing {
                            o.update_available = entry.is_some();
                        }
                    }
                }
                Err(e) => {
                    o.reason = Some("unreachable");
                    o.error = Some(e.to_string());
                }
            }
        }
        PackSource::Modrinth(projects) => {
            if let Some(inst) = instance {
                if let Some(r) = load(state, &inst.id).get(d.id) {
                    let idx = ContentIndex::load(&state.paths, &inst.id);
                    if present(state, &inst.id, r, &idx) {
                        // Version der (ersten) Pack-Mod aus dem Inhalts-Index (folgt auch normalen Updates)
                        let version = r.projects.iter().find_map(|pid| idx.files.values().find(|e| e.source == Source::Modrinth && &e.project_id == pid).and_then(|e| e.version_number.clone()));
                        o.installed = Some(PackInstall {
                            version,
                            files: r.files.clone(),
                            mc_version: Some(r.mc_version.clone()),
                            loader: Some(r.loader.clone()),
                            installed_at: Some(r.installed_at),
                            disabled_by_user: false,
                            missing: false,
                            mismatch: r.mc_version != inst.mc_version,
                        });
                    }
                }
            }
            if !loader_ok {
                return o;
            }
            let checks = projects.iter().map(|(p, _)| async move {
                provider::versions_for(state, Source::Modrinth, p, Some(mc), Some(loader)).await.map(|(list, pref, _)| provider::pick_best(&list, pref.as_deref()).is_some())
            });
            let res = futures::future::join_all(checks).await;
            if let Some(Err(e)) = res.iter().find(|r| r.is_err()) {
                o.reason = Some("unreachable");
                o.error = Some(e.to_string());
            } else {
                let all = res.iter().all(|r| matches!(r, Ok(true)));
                o.available = Some(all);
                if !all {
                    o.reason = Some("version");
                }
            }
        }
    }
    o
}

// ------------------------------------------------------------------ Installieren / Entfernen

fn ensure_idle(state: &AppState, id: &str) -> AppResult<()> {
    if state.game.is_running(id) {
        return Err(AppError::Invalid("Die Instanz läuft gerade – bitte zuerst beenden.".into()));
    }
    Ok(())
}

/// Prüfung vor dem Start der Aufgabe: Pack bekannt, Loader passt, Ausschluss bestätigt.
pub fn precheck(state: &AppState, instance_id: &str, pack_id: &str, replace: bool) -> AppResult<(Instance, &'static PackDef, Vec<String>)> {
    let inst = state.instances.get(instance_id)?;
    let d = def(pack_id).ok_or_else(|| AppError::NotFound(format!("Client-Pack {pack_id}")))?;
    if !d.loaders.contains(&inst.loader.kind) {
        return Err(AppError::Invalid("Dieses Pack passt nicht zum Loader der Instanz.".into()));
    }
    if d.source == PackSource::Vibey {
        crate::vibe::ensure(state, crate::vibe::Feature::Any)?;
    }
    ensure_idle(state, instance_id)?;
    let others = to_replace(pack_id, &installed_ids(state, instance_id));
    if !others.is_empty() && !replace {
        return Err(AppError::Invalid(format!("Nur ein Client gleichzeitig: zuerst {} entfernen.", others.join(", "))));
    }
    Ok((inst, d, others))
}

/// Pack installieren bzw. aktualisieren (Task-Körper). Andere Packs der Gruppe werden vorher entfernt.
pub async fn install(state: AppState, task: TaskHandle, instance_id: String, pack_id: String, replace: Vec<String>) -> AppResult<()> {
    let d = def(&pack_id).ok_or_else(|| AppError::NotFound(format!("Client-Pack {pack_id}")))?;
    for other in &replace {
        task.stage(format!("Entferne {} …", pretty(other)), Some(0.02));
        remove(&state, &instance_id, other).await?;
    }
    task.check()?;
    let inst = state.instances.get(&instance_id)?;
    match d.source {
        PackSource::Vibey => vibey_client::install::enable(state.clone(), task, instance_id).await,
        PackSource::Norisk(flavor) => install_norisk(&state, &task, &inst, d, flavor).await,
        PackSource::Modrinth(projects) => install_modrinth(&state, &task, &inst, d, projects).await,
    }
}

pub fn pretty(id: &str) -> &'static str {
    match id {
        "vibey" => "Vibey Client",
        "norisk" => "NoRisk Client",
        "norisk-mini" => "NoRisk Mini",
        "essential" => "Essential",
        _ => "Pack",
    }
}

async fn install_norisk(state: &AppState, task: &TaskHandle, inst: &Instance, d: &PackDef, flavor: norisk::Flavor) -> AppResult<()> {
    task.stage("NoRisk-Downloadliste wird geladen …", Some(0.05));
    // Immer frisch: Liste und Jar direkt von NoRisk
    let list = norisk::list(true).await?;
    let entry = list.select(flavor, &inst.mc_version, inst.loader.kind).ok_or_else(|| {
        AppError::NotFound(format!("{} gibt es nicht für Minecraft {} mit {:?}.", flavor.name(), inst.mc_version, inst.loader.kind))
    })?;
    task.stage(format!("{} wird von norisk.gg geladen …", flavor.name()), Some(0.15));
    let (file, bytes) = norisk::download(entry, flavor).await?;
    task.check()?;
    ensure_idle(state, &inst.id)?;

    let mut st = load(state, &inst.id);
    let prev = st.get(d.id).cloned();
    let prev_file = prev.as_ref().and_then(|p| p.files.first()).and_then(|f| find_file(state, &inst.id, f));
    let was_disabled = prev_file.as_ref().is_some_and(|(_, on)| !on);
    let dir = mods_dir(state, &inst.id);
    tokio::fs::create_dir_all(&dir).await?;
    let target = dir.join(if was_disabled { format!("{file}.disabled") } else { file.clone() });
    // Unverändert schreiben (über eine versteckte Teildatei im selben Ordner)
    let tmp = dir.join(format!(".{file}.part"));
    tokio::fs::write(&tmp, &bytes).await?;
    if let Err(e) = tokio::fs::rename(&tmp, &target).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e.into());
    }
    if let Some((old, _)) = prev_file {
        if old != target {
            let _ = tokio::fs::remove_file(&old).await;
        }
    }
    let version = norisk::version_from_file(&file, flavor);
    st.upsert(InstalledPack {
        id: d.id.to_string(),
        version: version.clone(),
        files: vec![file.clone()],
        projects: vec![],
        mc_version: inst.mc_version.clone(),
        loader: norisk::loader_name(inst.loader.kind).unwrap_or("").to_string(),
        installed_at: crate::util::now_ms(),
        url: Some(entry.href.clone()),
    });
    save(state, &inst.id, &st)?;
    state.content.emit_changed(&inst.id);
    let v = version.as_deref().map(norisk::display_version).unwrap_or("?");
    let line = match prev.and_then(|p| p.version) {
        Some(old) if Some(&old) != version.as_ref() => format!("{} aktualisiert: {} → {v}", flavor.name(), norisk::display_version(&old)),
        _ => format!("{} {v} installiert ({file})", flavor.name()),
    };
    state.game.launcher_line(&inst.id, crate::minecraft::LogLevel::Launcher, line.clone());
    task.message(line);
    Ok(())
}

async fn install_modrinth(state: &AppState, task: &TaskHandle, inst: &Instance, d: &PackDef, projects: &[(&str, &[&str])]) -> AppResult<()> {
    task.stage("Prüfe installierte Mods …", Some(0.05));
    let (scanned, idx) = local::refresh(state, &inst.id, ContentKind::Mod).await?;
    let has_mod = |mids: &[&str]| scanned.iter().any(|s| mids.iter().any(|m| s.meta.mod_id.as_deref() == Some(*m) || s.meta.provides.iter().any(|p| p == m)));
    let mut st = load(state, &inst.id);
    let mut owned = st.get(d.id).map(|p| p.projects.clone()).unwrap_or_default();
    // Schon vorhandene Mods bleiben, wie sie sind (und gehören nicht dem Pack)
    let roots: Vec<(Source, String, Option<String>)> = projects
        .iter()
        .filter(|(p, mids)| !idx.has_project(Source::Modrinth, p) && !has_mod(mids))
        .map(|(p, _)| (Source::Modrinth, p.to_string(), None))
        .collect();
    let mut files = st.get(d.id).map(|p| p.files.clone()).unwrap_or_default();
    if !roots.is_empty() {
        task.stage("Löse Abhängigkeiten auf …", Some(0.1));
        let mut warnings = Vec::new();
        let planned = cinstall::plan(state, inst, &idx, roots, &mut warnings).await?;
        task.check()?;
        // Nur die Pack-Projekte selbst gehören dem Pack; Abhängigkeiten bleiben beim Entfernen (andere Mods brauchen sie evtl.)
        let own: Vec<&str> = projects.iter().map(|(p, _)| *p).collect();
        for p in planned.iter().filter(|p| own.contains(&p.brief.id.as_str())) {
            if !owned.contains(&p.brief.id) {
                owned.push(p.brief.id.clone());
            }
            let f = crate::paths::sanitize_file_name(&p.file.filename);
            if !files.contains(&f) {
                files.push(f);
            }
        }
        task.stage(format!("Lade {} Mod(s) …", planned.len()), Some(0.2));
        cinstall::apply(state, inst, planned, &task.sub(0.2, 0.95)).await?;
        for w in warnings {
            tracing::warn!("Client-Pack {}: {w}", d.id);
        }
    }
    st.upsert(InstalledPack {
        id: d.id.to_string(),
        version: None,
        files,
        projects: owned,
        mc_version: inst.mc_version.clone(),
        loader: inst.loader.kind.as_str().to_string(),
        installed_at: crate::util::now_ms(),
        url: None,
    });
    save(state, &inst.id, &st)?;
    state.content.emit_changed(&inst.id);
    task.message(format!("{} installiert", pretty(d.id)));
    Ok(())
}

/// Pack entfernen: nur die Dateien/Projekte, die das Pack selbst angelegt hat.
pub async fn remove(state: &AppState, instance_id: &str, pack_id: &str) -> AppResult<()> {
    let d = def(pack_id).ok_or_else(|| AppError::NotFound(format!("Client-Pack {pack_id}")))?;
    state.instances.get(instance_id)?;
    ensure_idle(state, instance_id)?;
    if d.source == PackSource::Vibey {
        return vibey_client::install::disable(state, instance_id).await;
    }
    let mut st = load(state, instance_id);
    let Some(rec) = st.remove(pack_id) else { return Ok(()) };
    let mut names: Vec<String> = Vec::new();
    match d.source {
        PackSource::Modrinth(_) => {
            // Aktuelle Dateinamen über den Index (Updates ändern den Namen)
            let idx = ContentIndex::load(&state.paths, instance_id);
            for (k, e) in &idx.files {
                if e.source == Source::Modrinth && rec.projects.contains(&e.project_id) {
                    if let Some(name) = k.strip_prefix("mods/") {
                        for n in [name.to_string(), format!("{name}.disabled")] {
                            if mods_dir(state, instance_id).join(&n).exists() {
                                names.push(n);
                            }
                        }
                    }
                }
            }
        }
        _ => {
            for f in &rec.files {
                for n in [f.clone(), format!("{f}.disabled")] {
                    if mods_dir(state, instance_id).join(&n).exists() {
                        names.push(n);
                    }
                }
            }
        }
    }
    if !names.is_empty() {
        local::remove(state, instance_id, ContentKind::Mod, &names).await?;
    }
    save(state, instance_id, &st)?;
    state.content.emit_changed(instance_id);
    state.game.launcher_line(instance_id, crate::minecraft::LogLevel::Launcher, format!("{} entfernt", pretty(pack_id)));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn definitions_are_consistent() {
        let mut seen = std::collections::HashSet::new();
        for p in PACKS {
            assert!(seen.insert(p.id), "doppelte ID {}", p.id);
            assert!(!p.loaders.is_empty());
            for c in p.conflicts {
                assert!(def(c).is_some(), "unbekannter Konflikt {c}");
            }
            if p.category == Category::Community {
                assert!(p.vendor.is_some() && p.homepage.is_some(), "Community-Pack {} ohne Herkunft", p.id);
            }
        }
        assert_eq!(def("vibey").unwrap().category, Category::Official);
        assert!(def("gibtsnicht").is_none());
    }

    /// Pack außerhalb der Client-Gruppe (z. B. ein späteres Performance-Pack)
    const EXTRA: PackDef = PackDef {
        id: "extra",
        category: Category::Community,
        source: PackSource::Modrinth(&[("AANobbMI", &["sodium"])]),
        group: None,
        loaders: &[LoaderKind::Fabric],
        conflicts: &[],
        vendor: Some("Modrinth"),
        homepage: Some("https://modrinth.com"),
    };

    #[test]
    fn clients_exclude_each_other() {
        let clients: Vec<&PackDef> = ["vibey", "norisk", "norisk-mini", "essential"].iter().map(|id| def(id).unwrap()).collect();
        for a in &clients {
            assert!(!excludes(a, a));
            for b in &clients {
                if a.id != b.id {
                    assert!(excludes(a, b), "{} und {} müssen sich ausschließen", a.id, b.id);
                }
            }
            // Packs ohne Gruppe vertragen sich mit Clients
            assert!(!excludes(a, &EXTRA) && !excludes(&EXTRA, a));
        }
    }

    #[test]
    fn replacement_on_switch() {
        // Wechsel Vibey -> NoRisk: Vibey muss raus, unbekannte/fremde Einträge bleiben unberührt
        assert_eq!(to_replace("norisk", &ids(&["vibey"])), ids(&["vibey"]));
        // NoRisk -> Mini, Mini -> Essential, Essential -> Vibey
        assert_eq!(to_replace("norisk-mini", &ids(&["norisk"])), ids(&["norisk"]));
        assert_eq!(to_replace("essential", &ids(&["norisk-mini"])), ids(&["norisk-mini"]));
        assert_eq!(to_replace("vibey", &ids(&["essential"])), ids(&["essential"]));
        // Erneut installieren (Update) ersetzt nichts
        assert!(to_replace("norisk", &ids(&["norisk"])).is_empty());
        assert!(to_replace("essential", &ids(&["essential"])).is_empty());
        // Nichts installiert
        assert!(to_replace("vibey", &[]).is_empty());
        // Unbekannte Einträge werden ignoriert
        assert!(to_replace("vibey", &ids(&["alt"])).is_empty());
        assert!(to_replace("alt", &ids(&["vibey"])).is_empty());
        // Mehrere (inkonsistenter Altzustand): alle Clients raus
        assert_eq!(to_replace("essential", &ids(&["vibey", "norisk"])), ids(&["vibey", "norisk"]));
    }

    #[test]
    fn essential_is_modrinth_pack() {
        let e = def("essential").unwrap();
        assert_eq!(e.category, Category::Community);
        assert_eq!(e.source.kind(), "modrinth");
        assert!(matches!(e.source, PackSource::Modrinth(p) if p[0].0 == "k2ZPuTBm"));
        assert_eq!(base_offer(e).projects, vec!["k2ZPuTBm"]);
        assert!(e.vendor.unwrap().contains("Essential"));
    }

    #[test]
    fn explicit_conflicts_are_symmetric() {
        let a = PackDef { id: "a", conflicts: &["b"], ..EXTRA };
        let b = PackDef { id: "b", ..EXTRA };
        assert!(excludes(&a, &b) && excludes(&b, &a));
        assert!(!excludes(&a, &EXTRA));
    }

    #[test]
    fn state_file_roundtrip() {
        let mut f = PacksFile::default();
        f.upsert(InstalledPack { id: "norisk-mini".into(), version: Some("26.4.1+fabric.26.3".into()), files: ids(&["nrc-mini-26.4.1+fabric.26.3.jar"]), mc_version: "26.3".into(), loader: "fabric".into(), ..Default::default() });
        f.upsert(InstalledPack { id: "norisk-mini".into(), version: Some("26.4.2+fabric.26.3".into()), ..Default::default() });
        assert_eq!(f.packs.len(), 1);
        assert_eq!(f.get("norisk-mini").unwrap().version.as_deref(), Some("26.4.2+fabric.26.3"));
        let j = serde_json::to_string(&f).unwrap();
        assert_eq!(serde_json::from_str::<PacksFile>(&j).unwrap(), f);
        let old: PacksFile = serde_json::from_str(r#"{"packs":[{"id":"x","neu":1}]}"#).unwrap();
        assert_eq!(old.packs[0].id, "x");
        assert!(f.remove("norisk-mini").is_some() && f.packs.is_empty());
    }
}
