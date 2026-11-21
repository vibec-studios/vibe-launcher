use super::{install, local, perf, provider, ContentKind, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{Instance, LoaderKind};
use crate::state::AppState;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuickMod {
    Spark,
    Replaymod,
}

impl QuickMod {
    fn details(self) -> (&'static str, &'static str, &'static str) {
        match self {
            Self::Spark => ("l6YH9Als", "spark", "spark"),
            Self::Replaymod => ("Nv2fQJo5", "replaymod", "ReplayMod"),
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum QuickModStatus {
    Unavailable,
    Installed,
    Disabled { file: String },
    Available { version_id: String, version: String },
}

pub async fn status(state: &AppState, inst: &Instance, tool: QuickMod) -> AppResult<QuickModStatus> {
    use QuickModStatus::*;
    if inst.is_bedrock() || inst.loader.kind == LoaderKind::Vanilla {
        return Ok(Unavailable);
    }
    let (project, mod_id, _) = tool.details();
    let (files, index) = local::scan(state, &inst.id, ContentKind::Mod).await?;
    let matching = files.into_iter().filter(|file| {
        file.meta.mod_id.as_deref().is_some_and(|id| id.eq_ignore_ascii_case(mod_id))
            || file.meta.provides.iter().any(|id| id.eq_ignore_ascii_case(mod_id))
            || index.files.get(&file.key).is_some_and(|entry| entry.source == Source::Modrinth && entry.project_id == project)
    });
    if let Some(file) = matching.max_by_key(|file| file.enabled) {
        return Ok(if file.enabled { Installed } else { Disabled { file: file.file_name } });
    }
    let (versions, preferred, _) = provider::versions_for(
        state, Source::Modrinth, project, Some(&inst.mc_version), Some(inst.loader.kind),
    ).await?;
    Ok(match provider::pick_best(&versions, preferred.as_deref()) {
        Some(version) => Available { version_id: version.id, version: version.version_number },
        None => Unavailable,
    })
}

pub fn start(state: &AppState, instance_id: String, tool: QuickMod) -> AppResult<String> {
    let (_, _, title) = tool.details();
    let guard = state.content.launch_gate(&instance_id).try_lock_owned()
        .map_err(|_| AppError::Invalid("Diese Instanz wird gerade für den Start vorbereitet oder geändert.".into()))?;
    let inst = state.instances.get(&instance_id)?;
    if state.game.is_running(&instance_id) {
        return Err(AppError::Invalid("Beende zuerst alle Spielsitzungen dieser Instanz.".into()));
    }
    let state = state.clone();
    Ok(state.tasks.clone().spawn("content", format!("{title} einrichten"), Some(instance_id.clone()), move |task| async move {
        let _guard = guard;
        let status = status(&state, &inst, tool).await?;
        task.check()?;
        match status {
            QuickModStatus::Installed => Ok(()),
            QuickModStatus::Unavailable => Err(AppError::Invalid(format!("{title} ist für diese Spielversion und diesen Mod-Loader nicht verfügbar."))),
            QuickModStatus::Disabled { file } => {
                local::set_enabled(&state, &instance_id, ContentKind::Mod, &file, true).await?;
                Ok(())
            }
            QuickModStatus::Available { version_id, .. } => {
                let (project, _, _) = tool.details();
                perf::backup(&state, &task, &instance_id, &format!("Vor {title}")).await;
                task.check()?;
                install::run_install_with(state, task, instance_id, Source::Modrinth, project.into(), Some(version_id), false).await
            }
        }
    }))
}
