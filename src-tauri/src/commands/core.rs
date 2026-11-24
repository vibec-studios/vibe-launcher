//! Instanzen, Einstellungen, Aufgaben, System. OWNER: Integrator (Haupt-Agent).
use crate::error::{AppError, AppResult};
use crate::events;
use crate::instance::{CreateInstance, Instance, InstancePatch};
use crate::settings::Settings;
use crate::state::AppState;
use crate::tasks::TaskInfo;
use serde::Serialize;
use tauri::State;

// ---------------------------------------------------------------- Instanzen

#[tauri::command]
pub async fn instances_list(state: State<'_, AppState>) -> AppResult<Vec<Instance>> {
    Ok(state.instances.list())
}

#[tauri::command]
pub async fn instance_get(state: State<'_, AppState>, id: String) -> AppResult<Instance> {
    state.instances.get(&id)
}

#[tauri::command]
pub async fn instance_create(state: State<'_, AppState>, req: CreateInstance) -> AppResult<Instance> {
    if req.custom_loader.is_some() && !state.settings().custom_loaders {
        return Err(AppError::Invalid("Eigene Loader sind ausgeschaltet (Einstellungen → Spiel → Experimentell).".into()));
    }
    state.instances.create(req)
}

#[tauri::command]
pub async fn instance_update(state: State<'_, AppState>, id: String, patch: InstancePatch) -> AppResult<Instance> {
    if patch.mc_version.is_some() || patch.loader.is_some() {
        let lock = state.content.lock(&id);
        let _guard = lock.lock().await;
        crate::content::migration::guard(&state, &id)?;
        return state.instances.patch(&id, patch);
    }
    state.instances.patch(&id, patch)
}

#[tauri::command]
pub async fn instance_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    crate::content::migration::guard(&state, &id)?;
    if state.game.is_running(&id) {
        return Err(AppError::Invalid("Die Instanz läuft gerade".into()));
    }
    if let Ok(inst) = state.instances.get(&id) {
        crate::bedrock::guard_idle(&state.paths, &inst)?;
    }
    let store = state.instances.clone();
    let gone = id.clone();
    tokio::task::spawn_blocking(move || store.delete(&id)).await??;
    crate::storage::after_instance_delete(&state, &gone);
    Ok(())
}

#[tauri::command]
pub async fn instance_duplicate(state: State<'_, AppState>, id: String, name: Option<String>) -> AppResult<Instance> {
    crate::bedrock::guard_idle(&state.paths, &state.instances.get(&id)?)?;
    let store = state.instances.clone();
    let inst = tokio::task::spawn_blocking(move || store.duplicate(&id, name)).await??;
    crate::storage::adopt_instance(&state, &inst.id);
    Ok(inst)
}

#[tauri::command]
pub async fn instance_set_icon(state: State<'_, AppState>, id: String, path: Option<String>) -> AppResult<Instance> {
    match path {
        Some(p) => state.instances.set_icon_from_file(&id, std::path::Path::new(&p)),
        None => state.instances.modify(&id, |i| i.icon = None),
    }
}

/// Ordner der Instanz öffnen. `sub` relativ zum Spielordner (z. B. "mods", "saves").
#[tauri::command]
pub async fn instance_open_folder(state: State<'_, AppState>, id: String, sub: Option<String>) -> AppResult<()> {
    state.instances.get(&id)?;
    let base = state.paths.game_dir(&id);
    let dir = match sub.as_deref() {
        Some(s) if !s.is_empty() => crate::util::safe_join(&base, s).ok_or_else(|| AppError::Invalid("Pfad".into()))?,
        _ => base,
    };
    std::fs::create_dir_all(&dir)?;
    crate::util::open_in_explorer(&dir)
}

// ---------------------------------------------------------------- Einstellungen

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> AppResult<Settings> {
    Ok(state.settings())
}

#[tauri::command]
pub async fn settings_set(state: State<'_, AppState>, settings: Settings) -> AppResult<Settings> {
    let mut s = settings;
    s.max_memory_mb = s.max_memory_mb.max(512);
    s.min_memory_mb = s.min_memory_mb.clamp(256, s.max_memory_mb);
    s.concurrent_downloads = s.concurrent_downloads.clamp(1, 64);
    if s.update_channel != "dev" {
        s.update_channel = "release".into();
    }
    if !crate::settings::LANGUAGES.contains(&s.language.as_str()) {
        s.language = "en".into();
    }
    s.appearance.sanitize();
    // Eigenes App-Icon nur aus dem eigenen Ordner (dorthin kopiert `app_icon_import`)
    let icon_dir = state.paths.root.join("app-icon");
    if s.appearance.app_icon_image.as_deref().is_some_and(|p| !std::path::Path::new(p).starts_with(&icon_dir)) {
        s.appearance.app_icon_image = None;
    }
    s.sanitize_discord(&icon_dir);
    s.sanitize_mode();
    s.sanitize_notices();
    s.save(&state.paths.settings_file())?;
    let icon_key = |a: &crate::settings::Appearance| (a.app_icon.clone(), a.app_icon_color.clone(), a.app_icon_image.clone());
    let icon_changed = icon_key(&state.settings().appearance) != icon_key(&s.appearance);
    if state.settings().prefer_dgpu && !s.prefer_dgpu {
        if let Err(e) = crate::platform::gpupref::revert(&state.paths) {
            tracing::warn!("GPU-Vorgaben nicht zurücksetzbar: {e}");
        }
    }
    state.net.set_concurrency(s.concurrent_downloads as usize);
    *state.settings.write() = s.clone();
    crate::vibe::on_settings_changed(&state);
    events::emit(&state.app, events::SETTINGS_CHANGED, &s);
    if icon_changed {
        crate::platform::app_icon::apply(&state.app, &s.appearance);
    }
    Ok(s)
}

/// Eigenes Bild fürs App-Icon (bzw. mit `slot` = "discord" für den Discord-Status) übernehmen; gibt den gespeicherten Pfad zurück.
#[tauri::command]
pub async fn app_icon_import(state: State<'_, AppState>, path: String, slot: Option<String>) -> AppResult<String> {
    let root = state.paths.root.clone();
    let prefix = if slot.as_deref() == Some("discord") { "discord" } else { "custom" };
    let p = tokio::task::spawn_blocking(move || crate::platform::app_icon::import_image(&root, std::path::Path::new(&path), prefix))
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
    Ok(p.to_string_lossy().to_string())
}

/// Vorschau des App-Icons als data:-URL (PNG).
#[tauri::command]
pub async fn app_icon_preview(state: State<'_, AppState>, motif: String, color: String, image: Option<String>, size: Option<u32>) -> AppResult<String> {
    use base64::Engine;
    let icon_dir = state.paths.root.join("app-icon");
    let image = image.filter(|p| std::path::Path::new(p).starts_with(&icon_dir));
    let size = size.unwrap_or(128).clamp(16, 256);
    let png = tokio::task::spawn_blocking(move || {
        let spec = crate::platform::app_icon::IconSpec::new(&motif, &color, image.as_deref());
        crate::platform::app_icon::png_bytes(&spec, size)
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))??;
    Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)))
}

/// Eigenes Hintergrundbild/-video in `<daten>/backgrounds/` kopieren (dort deckt der Asset-Scope es ab).
/// `slot`: "image" oder "video". Ältere Dateien desselben Slots werden entfernt. Gibt den neuen Pfad zurück.
#[tauri::command]
pub async fn appearance_import_background(state: State<'_, AppState>, path: String, slot: String) -> AppResult<String> {
    const IMAGE: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"];
    const VIDEO: &[&str] = &["mp4", "webm", "gif", "webp"];
    const MAX_BYTES: u64 = 300 * 1024 * 1024;
    let src = std::path::PathBuf::from(&path);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    let allowed = match slot.as_str() {
        "image" => IMAGE,
        "video" => VIDEO,
        _ => return Err(AppError::Invalid("Unbekannter Hintergrund-Slot".into())),
    };
    if !allowed.contains(&ext.as_str()) {
        return Err(AppError::Invalid(format!("Dateityp .{ext} wird nicht unterstützt")));
    }
    let meta = std::fs::metadata(&src)?;
    if !meta.is_file() {
        return Err(AppError::Invalid("Keine Datei".into()));
    }
    if meta.len() > MAX_BYTES {
        return Err(AppError::Invalid("Datei ist zu groß (max. 300 MB)".into()));
    }
    let dir = state.paths.root.join("backgrounds");
    let target = dir.join(format!("{slot}-{}.{ext}", crate::util::now_ms()));
    let prefix = format!("{slot}-");
    tokio::task::spawn_blocking(move || -> AppResult<String> {
        std::fs::create_dir_all(&dir)?;
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                if e.file_name().to_string_lossy().starts_with(&prefix) {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
        std::fs::copy(&src, &target)?;
        Ok(target.to_string_lossy().into_owned())
    })
    .await?
}

// ---------------------------------------------------------------- Aufgaben

#[tauri::command]
pub async fn tasks_list(state: State<'_, AppState>) -> AppResult<Vec<TaskInfo>> {
    Ok(state.tasks.list())
}

#[tauri::command]
pub async fn task_cancel(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    Ok(state.tasks.cancel(&id))
}

#[tauri::command]
pub async fn tasks_clear(state: State<'_, AppState>) -> AppResult<()> {
    state.tasks.clear_finished();
    Ok(())
}

// ---------------------------------------------------------------- System

#[derive(Serialize, Clone)]
pub struct SystemInfo {
    pub version: String,
    pub data_dir: String,
    pub os: String,
    pub arch: String,
    pub total_memory_mb: u64,
    pub curseforge_available: bool,
    pub msa_available: bool,
}

#[tauri::command]
pub async fn system_info(state: State<'_, AppState>) -> AppResult<SystemInfo> {
    let s = state.settings();
    Ok(SystemInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        data_dir: state.paths.root.to_string_lossy().to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        total_memory_mb: crate::settings::system_memory_mb(),
        curseforge_available: s.curseforge_key().is_some(),
        msa_available: s.msa_client().is_some(),
    })
}

/// Beliebigen Pfad im Explorer öffnen (nur innerhalb des Datenordners).
#[tauri::command]
pub async fn open_path(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let p = std::path::PathBuf::from(&path);
    let canon = p.canonicalize().map_err(|_| AppError::NotFound(path.clone()))?;
    let root = state.paths.root.canonicalize().unwrap_or(state.paths.root.clone());
    if !canon.starts_with(&root) {
        return Err(AppError::Invalid("Pfad außerhalb des Launcher-Ordners".into()));
    }
    crate::util::open_in_explorer(&canon)
}

/// Datenordner öffnen.
#[tauri::command]
pub async fn open_data_dir(state: State<'_, AppState>) -> AppResult<()> {
    crate::util::open_in_explorer(&state.paths.root)
}

// ---------------------------------------------------------------- Launcher-Updates

/// Nach einem Launcher-Update im eingestellten Kanal suchen. `None` = aktuell.
#[tauri::command]
pub async fn update_check(state: State<'_, AppState>) -> AppResult<Option<crate::updater::UpdateInfo>> {
    crate::updater::check(&state).await
}

#[tauri::command]
pub async fn update_blockers(state: State<'_, AppState>) -> AppResult<crate::updater::guard::UpdateBlockers> {
    Ok(crate::updater::guard::collect(&state))
}

/// Gefundenes Update herunterladen und installieren (Task). Der Launcher startet danach neu.
#[tauri::command]
pub async fn update_install(state: State<'_, AppState>, force: Option<bool>) -> AppResult<String> {
    if state.pending_update.0.lock().is_none() {
        return Err(AppError::Invalid("Kein Update gefunden – bitte erneut suchen".into()));
    }
    crate::updater::guard::ensure_allowed(&crate::updater::guard::collect(&state), force.unwrap_or(false))?;
    let st = state.inner().clone();
    Ok(state.tasks.spawn("update", "Launcher-Update", None, move |task| async move { crate::updater::install(&st, &task).await }))
}
