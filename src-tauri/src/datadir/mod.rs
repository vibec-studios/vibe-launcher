pub mod mover;

use crate::error::{AppError, AppResult};
use crate::instance::BedrockProfile;
use crate::paths::location::{self, Pointer};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use crate::util::diskspace::{self, MB};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Clone, Serialize)]
pub struct Preview {
    pub current: String,
    pub default: String,
    pub locked: bool,
    pub portable: bool,
    pub target: Option<String>,
    pub size: u64,
    pub free: Option<u64>,
    pub enough: bool,
    pub problem: Option<String>,
    pub busy: Vec<String>,
    pub bedrock_warning: bool,
}

fn busy(state: &AppState) -> Vec<String> {
    let b = crate::updater::guard::collect(state);
    let mut out = Vec::new();
    if b.games > 0 {
        out.push("Minecraft läuft".to_string());
    }
    if b.servers > 0 {
        out.push("Ein lokaler Server läuft".to_string());
    }
    if b.bedrock_swap {
        out.push("Minecraft Bedrock hat ein Profil eingetauscht".to_string());
    }
    out.extend(b.tasks);
    out
}

fn bedrock_warning(state: &AppState, target: &Path) -> bool {
    state.instances.list().iter().filter_map(|i| i.bedrock.as_ref()).filter(|b| b.profile == BedrockProfile::Isolated).any(|b| {
        crate::bedrock::target(b.channel).is_ok_and(|t| crate::bedrock::swap::check_same_volume(target, &t.base).is_err())
    })
}

pub fn needed_bytes(size: u64) -> u64 {
    size + size / 20 + 256 * MB
}

pub async fn preview(state: &AppState, target: Option<String>) -> AppResult<Preview> {
    let current = state.paths.root.clone();
    let locked = location::fixed_root().is_some();
    let size = {
        let c = current.clone();
        tokio::task::spawn_blocking(move || mover::tally(&c).1).await?
    };
    let mut p = Preview {
        current: current.to_string_lossy().to_string(),
        default: location::default_root().to_string_lossy().to_string(),
        locked,
        portable: crate::paths::portable::active(),
        target: target.clone(),
        size,
        free: None,
        enough: true,
        problem: None,
        busy: busy(state),
        bedrock_warning: false,
    };
    let Some(t) = target.map(PathBuf::from) else { return Ok(p) };
    if let Err(e) = mover::validate_target(&current, &t) {
        p.problem = Some(e.to_string());
        return Ok(p);
    }
    if let Some((_, free)) = diskspace::free_bytes(&t) {
        p.free = Some(free);
        p.enough = free >= needed_bytes(size);
    }
    p.bedrock_warning = bedrock_warning(state, &t);
    Ok(p)
}

pub fn start(state: &AppState, target: String) -> AppResult<String> {
    if crate::paths::portable::active() {
        return Err(AppError::Invalid("Im portablen Modus liegt der Datenordner immer neben dem Launcher (Ordner VibeData) und kann hier nicht geändert werden.".into()));
    }
    if location::env_override().is_some() {
        return Err(AppError::Invalid("Der Datenordner ist über VIBE_LAUNCHER_HOME festgelegt und kann hier nicht geändert werden.".into()));
    }
    let st = state.clone();
    Ok(state.tasks.spawn("datadir", "Speicherort ändern", None, move |task| async move { run(&st, &task, PathBuf::from(target)).await }))
}

async fn run(state: &AppState, task: &TaskHandle, target: PathBuf) -> AppResult<()> {
    let p = preview(state, Some(target.to_string_lossy().to_string())).await?;
    if let Some(e) = p.problem {
        return Err(AppError::Invalid(e));
    }
    let others: Vec<String> = p.busy.into_iter().filter(|b| b != "Speicherort ändern").collect();
    if !others.is_empty() {
        return Err(AppError::Invalid(format!("Bitte erst beenden bzw. abwarten: {}", others.join(", "))));
    }
    if !p.enough {
        return Err(AppError::Invalid(format!(
            "Am neuen Ort ist nicht genug Platz frei: gebraucht werden etwa {}, frei sind {}.",
            diskspace::gb_text(needed_bytes(p.size)),
            diskspace::gb_text(p.free.unwrap_or(0))
        )));
    }
    let current = state.paths.root.clone();
    let total = p.size.max(1);
    task.stage("Dateien werden kopiert …", Some(0.0));
    let (src, dst, t2) = (current.clone(), target.clone(), task.clone());
    let created = !target.exists();
    let copied = tokio::task::spawn_blocking(move || {
        let done = AtomicU64::new(0);
        let r = mover::copy_all(
            &src,
            &dst,
            &|n| {
                let d = done.fetch_add(n, Ordering::Relaxed) + n;
                t2.progress(d as f64 / total as f64 * 0.95);
            },
            &|| t2.is_cancelled(),
        );
        r.and_then(|copied| {
            if mover::tally(&dst) != copied {
                return Err(AppError::msg("Die Kopie ist unvollständig."));
            }
            mover::rewrite_paths(&dst, &src, &dst);
            Ok(copied)
        })
    })
    .await?;
    if let Err(e) = copied {
        let dst = target.clone();
        let _ = tokio::task::spawn_blocking(move || mover::rollback(&dst, created)).await;
        return Err(match e {
            AppError::Cancelled => AppError::Cancelled,
            e => AppError::msg(format!("Verschieben abgebrochen, am alten Ort ist alles unverändert: {e}")),
        });
    }
    let default = location::default_root();
    let root = if mover::is_inside(&target, &default) && mover::is_inside(&default, &target) { None } else { Some(target.clone()) };
    if let Err(e) = location::write(&default, &Pointer { root, cleanup_from: Some(current) }) {
        let dst = target.clone();
        let _ = tokio::task::spawn_blocking(move || mover::rollback(&dst, created)).await;
        return Err(AppError::msg(format!("Neuer Speicherort konnte nicht gespeichert werden: {e}")));
    }
    task.stage("Fertig – der Launcher startet neu …", Some(1.0));
    tokio::time::sleep(std::time::Duration::from_millis(900)).await;
    state.app.restart();
}

pub fn on_startup(paths: &crate::paths::Paths) {
    if location::fixed_root().is_some() {
        return;
    }
    let default = location::default_root();
    let mut ptr = location::read(&default);
    let Some(old) = ptr.cleanup_from.take() else { return };
    let current = paths.root.clone();
    std::thread::spawn(move || {
        if let Err(e) = mover::cleanup_old(&old, &current, &default) {
            tracing::warn!("Alter Datenordner {old:?} nicht vollständig entfernt: {e}");
        }
        if let Err(e) = location::write(&default, &ptr) {
            tracing::warn!("Speicherort-Datei nicht aktualisierbar: {e}");
        }
    });
}
