//! Minecraft Bedrock: Status, Instanzen anlegen/übernehmen, Add-ons, Welten, Sicherungen, CurseForge.
use crate::bedrock::{self, cf, game, packs, swap, worlds};
use crate::content::worldbackup::WorldBackup;
use crate::content::{SearchResult, SortOrder};
use crate::error::{AppError, AppResult};
use crate::instance::{BedrockChannel, BedrockOptions, BedrockProfile, Instance};
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

fn bedrock_inst(state: &AppState, id: &str) -> AppResult<Instance> {
    let i = state.instances.get(id)?;
    bedrock::options(&i)?;
    Ok(i)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(f).await?
}

#[tauri::command]
pub async fn bedrock_status(state: State<'_, AppState>) -> AppResult<game::Status> {
    let st = state.inner().clone();
    blocking(move || Ok(game::status(&st))).await
}

/// Was beim Übernehmen bestehender Daten kopiert würde.
#[derive(Debug, Serialize)]
pub struct HomeSummary {
    pub worlds: usize,
    pub packs: usize,
    pub size: u64,
}

#[tauri::command]
pub async fn bedrock_home_summary(state: State<'_, AppState>, channel: BedrockChannel) -> AppResult<HomeSummary> {
    let paths = state.paths.clone();
    blocking(move || {
        let t = bedrock::target(channel)?;
        if bedrock::swapper(&paths, &t).active_instance().is_some() {
            return Err(AppError::Invalid(bedrock::SWAPPED_MSG.into()));
        }
        let loc = bedrock::DataLoc { base: t.base.clone(), layout: t.layout, live: true };
        let size = t.layout.slots(&t.base).iter().map(|s| bedrock::dir_size(&bedrock::slot_path(&t.base, s))).sum();
        Ok(HomeSummary { worlds: worlds::list(&loc, false).len(), packs: packs::list(&loc.packs_dir(), false).len(), size })
    })
    .await
}

/// Neue Bedrock-Instanz. `adopt`: bestehende Bedrock-Daten in das neue (eigene) Profil kopieren –
/// läuft als Aufgabe; das Original bleibt unverändert.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn bedrock_create(
    state: State<'_, AppState>,
    name: String,
    channel: BedrockChannel,
    profile: BedrockProfile,
    adopt: Option<bool>,
    icon: Option<String>,
    accent: Option<String>,
    group: Option<String>,
) -> AppResult<Instance> {
    let t = bedrock::target(channel)?;
    let adopt = adopt.unwrap_or(false) && profile == BedrockProfile::Isolated;
    if adopt {
        if game::adopting(channel) {
            return Err(AppError::Invalid("Es wird schon eine Übernahme ausgeführt.".into()));
        }
        if bedrock::swapper(&state.paths, &t).load_journal().is_some() {
            return Err(AppError::Invalid("Gerade ist ein anderes Bedrock-Profil eingetauscht. Bitte das Spiel schließen und kurz warten.".into()));
        }
        if game::game_running(channel) {
            return Err(AppError::Invalid(swap::RUNNING_MSG.into()));
        }
    }
    let inst = state.instances.create_bedrock(&name, BedrockOptions { channel, profile }, icon, accent, group)?;
    if adopt {
        game::set_adopting(channel, true);
        let st = state.inner().clone();
        let app = state.app.clone();
        let (iid, name) = (inst.id.clone(), inst.name.clone());
        let done_id = iid.clone();
        state.tasks.spawn("import", format!("Bedrock-Daten werden in „{name}“ übernommen"), Some(inst.id.clone()), move |task| async move {
            let r = blocking(move || {
                let total: u64 = t.layout.slots(&t.base).iter().map(|s| bedrock::dir_size(&bedrock::slot_path(&t.base, s))).sum();
                let done = std::sync::atomic::AtomicU64::new(0);
                let on = |n: u64| {
                    let d = done.fetch_add(n, std::sync::atomic::Ordering::Relaxed) + n;
                    if total > 0 {
                        task.progress(d as f64 / total as f64);
                    }
                };
                let dest = bedrock::profile_dir(&st.paths, &iid);
                if dest.exists() && std::fs::read_dir(&dest).map(|mut r| r.next().is_some()).unwrap_or(false) {
                    return Err(AppError::msg("Das Profil der neuen Instanz ist nicht leer"));
                }
                let _ = std::fs::remove_dir(&dest);
                swap::copy_slots(&t.base, t.layout, &dest, &on, &|| task.is_cancelled()).map(|_| ())
            })
            .await;
            game::set_adopting(channel, false);
            crate::events::emit(&app, crate::events::CONTENT_CHANGED, &serde_json::json!({ "instance_id": done_id }));
            r
        });
    }
    Ok(inst)
}

#[tauri::command]
pub async fn bedrock_packs(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<packs::BedrockPack>> {
    let inst = bedrock_inst(&state, &instance_id)?;
    let paths = state.paths.clone();
    blocking(move || bedrock::with_data(&paths, &inst, |loc| Ok(packs::list(&loc.packs_dir(), true)))).await
}

#[tauri::command]
pub async fn bedrock_pack_remove(state: State<'_, AppState>, instance_id: String, pack_id: String) -> AppResult<()> {
    let inst = bedrock_inst(&state, &instance_id)?;
    let paths = state.paths.clone();
    blocking(move || {
        bedrock::with_data_idle(&paths, &inst, |loc| {
            let p = packs::resolve(&loc.packs_dir(), &pack_id)?;
            bedrock::discard(&p)
        })
    })
    .await
}

#[tauri::command]
pub async fn bedrock_pack_export(state: State<'_, AppState>, instance_id: String, pack_id: String, dest: String) -> AppResult<()> {
    let inst = bedrock_inst(&state, &instance_id)?;
    let paths = state.paths.clone();
    blocking(move || {
        let dir = bedrock::with_data(&paths, &inst, |loc| packs::resolve(&loc.packs_dir(), &pack_id))?;
        packs::zip_dir(&dir, std::path::Path::new(&dest))
    })
    .await
}

/// Dateien (Drag & Drop / Dateiauswahl) importieren.
#[tauri::command]
pub async fn bedrock_import_files(state: State<'_, AppState>, instance_id: String, paths: Vec<String>) -> AppResult<packs::ImportResult> {
    bedrock_inst(&state, &instance_id)?;
    let mut all = packs::ImportResult::default();
    let mut errors = Vec::new();
    for p in paths {
        let name = std::path::Path::new(&p).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        match bedrock::import_file(&state, &instance_id, std::path::Path::new(&p), None).await {
            Ok(r) => {
                all.packs.extend(r.packs);
                all.worlds.extend(r.worlds);
                all.updated.extend(r.updated);
            }
            Err(e) => errors.push(format!("{name}: {e}")),
        }
    }
    crate::events::emit(&state.app, crate::events::CONTENT_CHANGED, &serde_json::json!({ "instance_id": instance_id }));
    if all.packs.is_empty() && all.worlds.is_empty() && !errors.is_empty() {
        return Err(AppError::Invalid(errors.join("\n")));
    }
    if !errors.is_empty() {
        tracing::warn!("Bedrock-Import teilweise fehlgeschlagen: {errors:?}");
    }
    Ok(all)
}

#[tauri::command]
pub async fn bedrock_worlds(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<worlds::BedrockWorld>> {
    let inst = bedrock_inst(&state, &instance_id)?;
    let paths = state.paths.clone();
    blocking(move || bedrock::with_data(&paths, &inst, |loc| Ok(worlds::list(loc, true)))).await
}

/// Kann die Instanz Welten importieren? (Es braucht einen Spielerordner.)
#[tauri::command]
pub async fn bedrock_can_import_worlds(state: State<'_, AppState>, instance_id: String) -> AppResult<bool> {
    let inst = bedrock_inst(&state, &instance_id)?;
    let paths = state.paths.clone();
    blocking(move || bedrock::with_data(&paths, &inst, |loc| Ok(worlds::import_dir(loc).is_some()))).await
}

#[tauri::command]
pub async fn bedrock_world_delete(state: State<'_, AppState>, instance_id: String, folder: String) -> AppResult<()> {
    let inst = bedrock_inst(&state, &instance_id)?;
    let paths = state.paths.clone();
    blocking(move || {
        bedrock::with_data_idle(&paths, &inst, |loc| {
            let w = worlds::find(loc, &folder)?;
            // Vorher sichern – Löschen soll nie endgültig sein
            worlds::backup_create(&paths, &inst.id, &w, true)?;
            bedrock::discard(&w)
        })
    })
    .await
}

#[tauri::command]
pub async fn bedrock_world_export(state: State<'_, AppState>, instance_id: String, folder: String, dest: String) -> AppResult<()> {
    let inst = bedrock_inst(&state, &instance_id)?;
    let paths = state.paths.clone();
    blocking(move || {
        let w = bedrock::with_data(&paths, &inst, |loc| worlds::find(loc, &folder))?;
        packs::zip_dir(&w, std::path::Path::new(&dest))
    })
    .await
}

/// Pack in einer Welt ein-/ausschalten (`pack_id` wie in `bedrock_packs`).
#[tauri::command]
pub async fn bedrock_world_pack_set(state: State<'_, AppState>, instance_id: String, folder: String, pack_id: String, enabled: bool) -> AppResult<()> {
    let inst = bedrock_inst(&state, &instance_id)?;
    let paths = state.paths.clone();
    blocking(move || {
        bedrock::with_data_idle(&paths, &inst, |loc| {
            let dir = packs::resolve(&loc.packs_dir(), &pack_id)?;
            let m = packs::read_pack_dir(&dir).ok_or_else(|| AppError::NotFound("Pack".into()))?;
            let w = worlds::find(loc, &folder)?;
            packs::set_world_pack(&w, m.kind, &m.uuid, &m.version, enabled)
        })
    })
    .await
}

#[tauri::command]
pub async fn bedrock_backups(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<WorldBackup>> {
    bedrock_inst(&state, &instance_id)?;
    let paths = state.paths.clone();
    blocking(move || Ok(worlds::backups_list(&paths, &instance_id))).await
}

#[tauri::command]
pub async fn bedrock_backup_create(state: State<'_, AppState>, instance_id: String, folder: String) -> AppResult<WorldBackup> {
    let inst = bedrock_inst(&state, &instance_id)?;
    let paths = state.paths.clone();
    blocking(move || {
        bedrock::with_data(&paths, &inst, |loc| {
            let w = worlds::find(loc, &folder)?;
            worlds::backup_create(&paths, &inst.id, &w, false)
        })
    })
    .await
}

#[tauri::command]
pub async fn bedrock_backup_restore(state: State<'_, AppState>, instance_id: String, backup_id: String) -> AppResult<()> {
    let inst = bedrock_inst(&state, &instance_id)?;
    let paths = state.paths.clone();
    blocking(move || bedrock::with_data_idle(&paths, &inst, |loc| worlds::backup_restore(&paths, &inst.id, loc, &backup_id))).await
}

#[tauri::command]
pub async fn bedrock_backup_delete(state: State<'_, AppState>, instance_id: String, backup_id: String) -> AppResult<()> {
    bedrock_inst(&state, &instance_id)?;
    let paths = state.paths.clone();
    blocking(move || worlds::backup_delete(&paths, &instance_id, &backup_id)).await
}

/// Ordner öffnen: `packs`, `worlds`, `backups` oder (leer) den Datenordner der Instanz.
#[tauri::command]
pub async fn bedrock_open_folder(state: State<'_, AppState>, instance_id: String, sub: Option<String>) -> AppResult<()> {
    let inst = bedrock_inst(&state, &instance_id)?;
    let dir = match sub.as_deref() {
        Some("backups") => worlds::backups_root(&state.paths, &instance_id),
        Some("packs") => bedrock::with_data(&state.paths, &inst, |l| Ok(l.packs_dir()))?,
        Some("worlds") => bedrock::with_data(&state.paths, &inst, |l| Ok(worlds::import_dir(l).unwrap_or_else(|| l.base.clone())))?,
        _ => bedrock::with_data(&state.paths, &inst, |l| Ok(l.base.clone()))?,
    };
    std::fs::create_dir_all(&dir)?;
    crate::util::open_in_explorer(&dir)
}

/// Offenen Profil-Tausch von Hand abschließen. `true`, wenn etwas zurückgetauscht wurde.
#[tauri::command]
pub async fn bedrock_recover(state: State<'_, AppState>, channel: BedrockChannel) -> AppResult<bool> {
    let st = state.inner().clone();
    blocking(move || game::recover(&st, channel)).await
}

/// Microsoft Store (Installationsseite) öffnen.
#[tauri::command]
pub async fn bedrock_open_store(channel: BedrockChannel) -> AppResult<()> {
    let url = bedrock::store_url(channel);
    #[cfg(windows)]
    {
        std::process::Command::new("explorer").arg(url).spawn()?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Err(AppError::Invalid("Minecraft Bedrock gibt es nur unter Windows.".into()))
    }
}

#[tauri::command]
pub async fn bedrock_cf_classes(state: State<'_, AppState>) -> AppResult<Vec<cf::CfClass>> {
    cf::classes(&state).await
}

#[tauri::command]
pub async fn bedrock_cf_search(
    state: State<'_, AppState>,
    query: String,
    class_id: Option<u32>,
    sort: Option<SortOrder>,
    offset: Option<u32>,
    limit: Option<u32>,
) -> AppResult<SearchResult> {
    cf::search(&state, &query, class_id, sort.unwrap_or(SortOrder::Relevance), offset.unwrap_or(0), limit.unwrap_or(20)).await
}

/// Add-on von CurseForge installieren (Aufgabe, gibt Task-ID zurück).
#[tauri::command]
pub async fn bedrock_cf_install(state: State<'_, AppState>, instance_id: String, project_id: String, file_id: Option<String>, title: Option<String>) -> AppResult<String> {
    let inst = bedrock_inst(&state, &instance_id)?;
    let st = state.inner().clone();
    let iid = inst.id.clone();
    Ok(state.tasks.spawn("content", format!("{} wird installiert", title.unwrap_or_else(|| "Add-on".into())), Some(inst.id.clone()), move |task| async move {
        cf::install(&st, &iid, &project_id, file_id.as_deref(), &task).await?;
        crate::events::emit(&st.app, crate::events::CONTENT_CHANGED, &serde_json::json!({ "instance_id": iid }));
        Ok(())
    }))
}
