//! Automatische Inhalte-Updates vor dem Spielstart und Hintergrundprüfung (Update-Badges).
use super::index::{self, ContentIndex};
use super::{install, ContentKind, ContentUpdate};
use crate::error::AppResult;
use crate::instance::Instance;
use crate::minecraft::LogLevel;
use crate::settings::Settings;
use crate::state::AppState;
use crate::tasks::TaskHandle;
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Zeitlimit, damit ein langsames Netz den Start nicht blockiert.
const LIMIT: Duration = Duration::from_secs(120);
/// Update-Zähler höchstens alle 30 Minuten neu ermitteln.
const COUNT_TTL: Duration = Duration::from_secs(30 * 60);

/// Ist Auto-Update für diese Instanz aktiv? Instanz-Einstellung > global; Modpack-Instanzen nur explizit.
pub fn enabled_for(settings: &Settings, inst: &Instance) -> bool {
    match inst.auto_update_content {
        Some(v) => v,
        None => {
            let is_pack = inst.source.as_ref().is_some_and(|s| s.project_id.is_some());
            settings.auto_update_content && !is_pack
        }
    }
}

/// Updates (ohne fixierte Inhalte) einspielen. Gibt die aktualisierten Dateien zurück.
async fn apply_all(state: &AppState, inst: &Instance, task: &TaskHandle) -> AppResult<Option<Vec<ContentUpdate>>> {
    let prepare = async {
        let updates: Vec<ContentUpdate> = install::check_updates(state, &inst.id).await?.into_iter().filter(|u| !u.manual).collect();
        if updates.is_empty() {
            return Ok(None);
        }
        task.check()?;
        let idx = ContentIndex::load(&state.paths, &inst.id);
        let roots = updates.iter().map(|u| (u.source, u.project_id.clone(), Some(u.new_version.id.clone()))).collect();
        let mut warnings = Vec::new();
        let planned = install::plan(state, inst, &idx, roots, &mut warnings).await?;
        Ok::<_, crate::error::AppError>(Some((updates, planned, warnings)))
    };
    let Some(prepared) = crate::minecraft::prelaunch::skippable(task, crate::minecraft::prelaunch::STEP_AUTO_UPDATE, prepare).await else { return Ok(None) };
    let Some((updates, planned, warnings)) = prepared? else { return Ok(Some(vec![])) };
    install::apply(state, inst, planned, &task.sub(0.0, 0.05)).await?;
    for w in warnings {
        tracing::warn!("Auto-Update {}: {w}", inst.id);
    }
    Ok(Some(updates))
}

/// Hook vor dem Spielstart (aus `minecraft::launch`). Schlägt nie fehl – Probleme landen im Log.
pub async fn before_launch(state: &AppState, id: &str, task: &TaskHandle) {
    let Ok(inst) = state.instances.get(id) else { return };
    // Abhängigkeits-Check: nur Warnung im Log, der Start geht weiter
    super::deps::warn_before_launch(state, id).await;
    if !enabled_for(&state.settings(), &inst) {
        return;
    }
    let log = |msg: String| state.game.launcher_line(id, LogLevel::Launcher, msg);
    task.stage("Mods werden aktualisiert …", None);
    log("Auto-Update: suche nach Updates für Mods, Resourcepacks und Shader …".into());
    match tokio::time::timeout(LIMIT, apply_all(state, &inst, task)).await {
        Ok(Ok(None)) => log("Auto-Update übersprungen".into()),
        Ok(Ok(Some(list))) if list.is_empty() => log("Auto-Update: alles aktuell".into()),
        Ok(Ok(Some(list))) => {
            let names: Vec<String> =
                list.iter().map(|u| format!("{} ({} → {})", u.file_name, u.current_version.clone().unwrap_or_else(|| "?".into()), u.new_version.version_number)).collect();
            log(format!("Auto-Update: {} aktualisiert: {}", list.len(), names.join(", ")));
            state.content.update_counts.lock().insert(id.to_string(), 0);
        }
        Ok(Err(crate::error::AppError::Cancelled)) => log("Auto-Update abgebrochen".into()),
        Ok(Err(e)) => log(format!("Auto-Update übersprungen: {e}")),
        Err(_) => log("Auto-Update übersprungen: Zeitlimit überschritten".into()),
    }
}

/// Anzahl verfügbarer Updates je Instanz (gecacht, im Hintergrund ermittelt).
pub async fn update_counts(state: &AppState) -> HashMap<String, u32> {
    static LAST: parking_lot::Mutex<Option<Instant>> = parking_lot::Mutex::new(None);
    static RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    let stale = LAST.lock().map_or(true, |t| t.elapsed() > COUNT_TTL);
    if stale && !RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        let st = state.clone();
        tauri::async_runtime::spawn(async move {
            for inst in st.instances.list() {
                match install::check_updates(&st, &inst.id).await {
                    Ok(list) => {
                        let pack = super::modpack::check(&st, &inst.id).await.ok().flatten().is_some() as u32;
                        st.content.update_counts.lock().insert(inst.id.clone(), list.len() as u32 + pack);
                    }
                    Err(e) => tracing::debug!("Update-Prüfung {} fehlgeschlagen: {e}", inst.id),
                }
            }
            *LAST.lock() = Some(Instant::now());
            RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
            crate::events::emit(&st.app, crate::events::CONTENT_CHANGED, &serde_json::json!({ "instance_id": null }));
        });
    }
    state.content.update_counts.lock().clone()
}

/// Version eines Inhalts fixieren/lösen.
pub async fn set_pinned(state: &AppState, instance_id: &str, kind: ContentKind, file_name: &str, pinned: bool) -> AppResult<super::ContentItem> {
    let key = index::key(kind.folder(), file_name);
    {
        let lock = state.content.lock(instance_id);
        let _g = lock.lock().await;
        let mut idx = ContentIndex::load(&state.paths, instance_id);
        if pinned {
            idx.pinned.insert(key.clone());
        } else {
            idx.pinned.remove(&key);
        }
        idx.save(&state.paths, instance_id)?;
    }
    state.content.update_counts.lock().remove(instance_id);
    let (scanned, idx) = super::local::scan(state, instance_id, kind).await?;
    state.content.emit_changed(instance_id);
    let s = scanned.iter().find(|s| s.key == key).ok_or_else(|| crate::error::AppError::NotFound(file_name.to_string()))?;
    Ok(super::local::to_item(s, &idx, kind, &super::local::icons_dir(state)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instance::{Loader, LoaderKind, PackSource, PackSourceKind};

    fn inst(source: Option<PackSource>, own: Option<bool>) -> Instance {
        serde_json::from_value(serde_json::json!({
            "id": "x", "name": "x", "icon": null, "accent": null, "group": null, "mc_version": "1.21.1",
            "loader": Loader { kind: LoaderKind::Fabric, version: None }, "source": source, "created_at": 0,
            "auto_update_content": own
        }))
        .unwrap()
    }

    #[test]
    fn effective_setting() {
        let mut s = Settings::default();
        let pack = Some(PackSource { kind: PackSourceKind::Modrinth, project_id: Some("p".into()), version_id: None, name: None, version_name: None });
        assert!(!enabled_for(&s, &inst(None, None)));
        s.auto_update_content = true;
        assert!(enabled_for(&s, &inst(None, None)));
        assert!(!enabled_for(&s, &inst(pack.clone(), None)), "Modpacks nur explizit");
        assert!(enabled_for(&s, &inst(pack, Some(true))));
        assert!(!enabled_for(&s, &inst(None, Some(false))));
    }
}
