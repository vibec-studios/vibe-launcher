use super::{Plan, PlanJar, PlanMod};
use crate::content::index::ContentIndex;
use crate::content::{install, local, missing, ContentKind, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{Instance, LoaderKind};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;

#[derive(Debug, Clone, Default, Serialize)]
pub struct Outcome {
    pub installed: usize,
    pub locked: usize,
    pub jars: usize,
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
    for m in mods {
        task.check()?;
        if m.source == Source::Curseforge {
            if let Err(e) = crate::content::curseforge::key(state) {
                warnings.push(format!("{}: {e}", m.name));
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
            Err(e) => warnings.push(format!("{}: {e}", m.name)),
        }
    }
    out.installed = all.iter().filter(|p| p.file.url.is_some()).count();
    let locked = install::apply(state, inst, all, &task.sub(from, to)).await?;
    out.locked = locked.len();
    if !locked.is_empty() {
        missing::watch(state, &inst.id, missing::WATCH_FOR);
    }
    disable(state, &inst.id, mods);
    Ok(out)
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

pub async fn copy_jars(state: &AppState, id: &str, jars: &[PlanJar]) -> AppResult<usize> {
    let (names, ids) = installed(state, id).await;
    let todo = jars_to_copy(jars, &names, &ids);
    let dst = state.paths.game_dir(id).join("mods");
    let n = todo.len();
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        std::fs::create_dir_all(&dst)?;
        for j in &todo {
            if j.name.contains(['/', '\\']) || j.name.starts_with('.') {
                continue;
            }
            std::fs::copy(&j.path, dst.join(&j.name)).map_err(|e| AppError::msg(format!("{} konnte nicht kopiert werden: {e}", j.name)))?;
        }
        Ok(())
    })
    .await??;
    Ok(n)
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
    Missing { mods: plan.mods.iter().filter(|m| !idx.has_project(m.source, &m.project_id)).cloned().collect(), jars: jars_to_copy(&plan.jars, names, ids) }
}

pub async fn missing(state: &AppState, inst: &Instance, plan: &Plan) -> Missing {
    if inst.loader.kind == LoaderKind::Vanilla {
        return Missing::default();
    }
    let (names, ids) = installed(state, &inst.id).await;
    let idx = ContentIndex::load(&state.paths, &inst.id);
    missing_of(plan, &idx, &names, &ids)
}

pub async fn run_missing(state: AppState, task: TaskHandle, id: String, plan: Plan) -> AppResult<()> {
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
    crate::content::snapshots::create(&state, &id, "Vor Übernahme aus NoRisk Client", false, None).await?;
    let mut warnings = Vec::new();
    let o = install(&state, &task, &inst, &m.mods, 0.1, 0.9, &mut warnings).await?;
    let jars = copy_jars(&state, &id, &m.jars).await?;
    let mut msg = format!("{} Mods installiert, {jars} lokale JARs übernommen", o.installed);
    if o.locked > 0 {
        msg.push_str(&format!(" · {} gesperrte CurseForge-Dateien bitte selbst herunterladen", o.locked));
    }
    if let Some(w) = warnings.first() {
        msg.push_str(&format!(" – Hinweis: {w}"));
    }
    task.message(msg);
    state.content.emit_changed(&id);
    Ok(())
}
