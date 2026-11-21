use super::{Plan, PlanJar, PlanMod};
use crate::content::index::ContentIndex;
use crate::content::{install, local, missing, ContentKind, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{Instance, LoaderKind};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;

#[derive(Debug, Clone, Default)]
pub struct Outcome {
    pub installed: Vec<String>,
    pub locked: Vec<String>,
    pub failed: Vec<Failed>,
    pub fallback: Vec<PlanJar>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Failed {
    pub name: String,
    pub reason: String,
}

fn fallback_jar(m: &PlanMod) -> Option<PlanJar> {
    let path = m.cache.clone().filter(|p| p.is_file())?;
    let file = path.file_name()?.to_string_lossy().to_string();
    let name = if m.enabled { file } else { format!("{file}.disabled") };
    Some(PlanJar { path, name, mod_id: None })
}

pub async fn install(state: &AppState, task: &TaskHandle, inst: &Instance, mods: &[PlanMod], from: f64, to: f64, warnings: &mut Vec<String>) -> AppResult<Outcome> {
    let mut out = Outcome::default();
    if mods.is_empty() || inst.loader.kind == LoaderKind::Vanilla {
        return Ok(out);
    }
    task.stage(format!("Installiere {} Mods …", mods.len()), Some(from));
    let idx = ContentIndex::load(&state.paths, &inst.id);
    let mut all: Vec<install::Planned> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let fail = |m: &PlanMod, reason: String, out: &mut Outcome| match fallback_jar(m) {
        Some(j) => out.fallback.push(j),
        None => out.failed.push(Failed { name: m.name.clone(), reason }),
    };
    for (i, m) in mods.iter().enumerate() {
        task.check()?;
        task.progress(from + (to - from) * 0.4 * i as f64 / mods.len() as f64);
        if m.source == Source::Curseforge {
            if let Err(e) = crate::content::curseforge::key(state) {
                fail(m, e.to_string(), &mut out);
                continue;
            }
        }
        match install::plan(state, inst, &idx, vec![(m.source, m.project_id.clone(), m.version_id.clone())], warnings).await {
            Ok(list) => {
                for p in list {
                    if seen.insert(p.brief.id.clone()) {
                        all.push(p);
                    }
                }
            }
            Err(e) => fail(m, e.to_string(), &mut out),
        }
    }
    out.installed = all.iter().filter(|p| p.file.url.is_some()).map(|p| p.brief.title.clone()).collect();
    let mid = from + (to - from) * 0.4;
    let locked = install::apply(state, inst, all, &task.sub(mid, to)).await?;
    if !locked.is_empty() {
        let still = from_cache(state, &inst.id, mods, &locked).await;
        out.locked = locked.iter().filter(|l| still.contains(&l.file_name)).map(|l| l.project_name.clone()).collect();
        if !out.locked.is_empty() {
            missing::watch(state, &inst.id, missing::WATCH_FOR);
        }
    }
    disable(state, &inst.id, mods);
    Ok(out)
}

async fn from_cache(state: &AppState, id: &str, mods: &[PlanMod], locked: &[crate::content::MissingDownload]) -> HashSet<String> {
    let dirs: Vec<PathBuf> = mods.iter().filter_map(|m| m.cache.as_ref()?.parent().map(PathBuf::from)).collect();
    let game = state.paths.game_dir(id);
    let mut copied = false;
    for l in locked {
        let name = l.file_name.as_str();
        if name.contains(['/', '\\']) || name.starts_with('.') {
            continue;
        }
        if let Some(src) = dirs.iter().map(|d| d.join(name)).find(|p| p.is_file()) {
            let dst = game.join(l.kind.folder()).join(name);
            if dst.parent().map(std::fs::create_dir_all).is_some_and(|r| r.is_ok()) && std::fs::copy(&src, &dst).is_ok() {
                copied = true;
            }
        }
    }
    if copied {
        if let Err(e) = missing::scan(state, id, false, &mut missing::HashCache::default()).await {
            tracing::warn!("Gesperrte Downloads aus dem NoRisk-Cache nicht übernommen: {e}");
        }
    }
    missing::load(&state.paths, id).into_iter().map(|e| e.info.file_name).collect()
}

fn disable(state: &AppState, id: &str, mods: &[PlanMod]) {
    let dst = state.paths.game_dir(id);
    let idx = ContentIndex::load(&state.paths, id);
    for m in mods.iter().filter(|m| !m.enabled) {
        for k in idx.keys_of_project(m.source, &m.project_id) {
            let p = dst.join(&k);
            if p.is_file() {
                let mut d = p.clone().into_os_string();
                d.push(".disabled");
                let _ = std::fs::rename(&p, PathBuf::from(d));
            }
        }
    }
}

fn base(name: &str) -> String {
    name.to_ascii_lowercase().trim_end_matches(".disabled").to_string()
}

pub fn jars_to_copy(jars: &[PlanJar], names: &HashSet<String>, ids: &HashSet<String>) -> Vec<PlanJar> {
    jars.iter().filter(|j| !names.contains(&base(&j.name)) && !j.mod_id.as_ref().is_some_and(|m| ids.contains(m))).cloned().collect()
}

async fn installed(state: &AppState, id: &str) -> (HashSet<String>, HashSet<String>) {
    match local::scan(state, id, ContentKind::Mod).await {
        Ok((list, _)) => (list.iter().map(|s| base(&s.file_name)).collect(), list.iter().filter_map(|s| s.meta.mod_id.clone()).collect()),
        Err(_) => (HashSet::new(), HashSet::new()),
    }
}

pub async fn copy_jars(state: &AppState, id: &str, jars: &[PlanJar]) -> AppResult<Vec<String>> {
    let (names, ids) = installed(state, id).await;
    let todo = jars_to_copy(jars, &names, &ids);
    let dst = state.paths.game_dir(id).join("mods");
    tokio::task::spawn_blocking(move || -> AppResult<Vec<String>> {
        std::fs::create_dir_all(&dst)?;
        let mut done = Vec::new();
        for j in &todo {
            if j.name.contains(['/', '\\']) || j.name.starts_with('.') || done.iter().any(|d: &String| d.eq_ignore_ascii_case(&j.name)) {
                continue;
            }
            std::fs::copy(&j.path, dst.join(&j.name)).map_err(|e| AppError::msg(format!("{} konnte nicht kopiert werden: {e}", j.name)))?;
            done.push(j.name.clone());
        }
        Ok(done)
    })
    .await?
}

#[derive(Debug, Clone, Default)]
pub struct Missing {
    pub mods: Vec<PlanMod>,
    pub jars: Vec<PlanJar>,
}

impl Missing {
    pub fn is_empty(&self) -> bool {
        self.mods.is_empty() && self.jars.is_empty()
    }
    pub fn names(&self) -> Vec<String> {
        self.mods.iter().map(|m| m.name.clone()).chain(self.jars.iter().map(|j| j.name.clone())).collect()
    }
}

pub fn missing_of(plan: &Plan, idx: &ContentIndex, names: &HashSet<String>, ids: &HashSet<String>) -> Missing {
    let cached = |m: &PlanMod| m.cache.as_ref().and_then(|p| p.file_name()).is_some_and(|n| names.contains(&base(&n.to_string_lossy())));
    Missing { mods: plan.mods.iter().filter(|m| !idx.has_project(m.source, &m.project_id) && !cached(m)).cloned().collect(), jars: jars_to_copy(&plan.jars, names, ids) }
}

pub async fn missing(state: &AppState, inst: &Instance, plan: &Plan) -> Missing {
    if inst.loader.kind == LoaderKind::Vanilla {
        return Missing::default();
    }
    let (names, ids) = installed(state, &inst.id).await;
    let idx = ContentIndex::load(&state.paths, &inst.id);
    missing_of(plan, &idx, &names, &ids)
}

pub async fn run_missing(state: AppState, task: TaskHandle, id: String, plan: Plan, launcher: &str) -> AppResult<()> {
    if state.game.is_running(&id) {
        return Err(AppError::Invalid("Bitte beende zuerst das Spiel – Mods werden nur bei geschlossenem Spiel übernommen.".into()));
    }
    let inst = state.instances.get(&id)?;
    let m = missing(&state, &inst, &plan).await;
    if m.is_empty() {
        task.message("Keine fehlenden Mods");
        return Ok(());
    }
    task.stage("Lege Snapshot an …", Some(0.0));
    crate::content::snapshots::create(&state, &id, &format!("Vor Übernahme aus {launcher}"), false, None).await?;
    let mut warnings = Vec::new();
    let o = install(&state, &task, &inst, &m.mods, 0.1, 0.9, &mut warnings).await?;
    let mut jars = m.jars.clone();
    jars.extend(o.fallback.iter().cloned());
    let copied = copy_jars(&state, &id, &jars).await?;
    let mut parts = Vec::new();
    if !o.installed.is_empty() {
        parts.push(if o.installed.len() == 1 { "1 Mod installiert".to_string() } else { format!("{} Mods installiert", o.installed.len()) });
    }
    if !copied.is_empty() {
        parts.push(if copied.len() == 1 { "1 Mod-Datei übernommen".to_string() } else { format!("{} Mod-Dateien übernommen", copied.len()) });
    }
    let mut msg = if parts.is_empty() { "Keine Mods übernommen".to_string() } else { parts.join(", ") };
    if !o.locked.is_empty() {
        msg.push_str(&format!(" · {} gesperrte CurseForge-Dateien bitte selbst herunterladen", o.locked.len()));
    }
    if !o.failed.is_empty() {
        let names: Vec<&str> = o.failed.iter().map(|f| f.name.as_str()).collect();
        msg.push_str(&format!(" · nicht verfügbar: {}", names.join(", ")));
    }
    task.message(msg);
    state.content.emit_changed(&id);
    Ok(())
}
