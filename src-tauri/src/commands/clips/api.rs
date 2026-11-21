use super::*;

pub(super) fn dirs_for(state: &AppState, instance_id: Option<String>) -> AppResult<Vec<(String, PathBuf)>> {
    let ids: Vec<String> = match instance_id {
        Some(id) => {
            state.instances.get(&id)?;
            vec![id]
        }
        None => state.instances.list().into_iter().map(|i| i.id).collect(),
    };
    let root = state.paths.instances();
    Ok(ids.into_iter().filter_map(|id| clips_dir_in(&root, &id).ok().map(|d| (id, d))).collect())
}

/// Clip-Ordner einer vorhandenen Instanz (geprüft).
pub(crate) fn instance_clips_dir(state: &AppState, instance_id: &str) -> AppResult<PathBuf> {
    state.instances.get(instance_id)?;
    clips_dir_in(&state.paths.instances(), instance_id)
}

/// Prüft, dass `<id>.json` existiert und (nach Auflösen von Links) im Instanzordner liegt.
pub(crate) fn checked_clip(state: &AppState, instance_id: &str, id: &str) -> AppResult<PathBuf> {
    if !valid_id(id) {
        return Err(AppError::Invalid("Clip-ID".into()));
    }
    let dir = instance_clips_dir(state, instance_id)?;
    // Nur prüfen; weiter mit dem nicht kanonischen Pfad (kanonische Windows-Pfade mit Präfix taugen nicht fürs Frontend)
    checked_file(&state.paths.instances(), &dir, &format!("{id}.json"))?;
    Ok(dir)
}

/// Clips aller Instanzen (oder einer), neueste zuerst.
#[tauri::command]
pub async fn clips_list(state: State<'_, AppState>, instance_id: Option<String>) -> AppResult<Vec<Clip>> {
    let dirs = dirs_for(&state, instance_id)?;
    tokio::task::spawn_blocking(move || scan(&dirs, Duration::from_millis(200)))
        .await
        .map_err(|e| AppError::msg(e.to_string()))
}

/// Nur `kept`, `title` (leer = entfernen) und `tags` (leer = entfernen) ändern. Gibt den neu gelesenen Clip zurück.
#[tauri::command]
pub async fn clip_update(
    state: State<'_, AppState>,
    instance_id: String,
    id: String,
    kept: Option<bool>,
    title: Option<String>,
    tags: Option<Vec<String>>,
) -> AppResult<Clip> {
    let dir = checked_clip(&state, &instance_id, &id)?;
    tokio::task::spawn_blocking(move || -> AppResult<Clip> {
        apply_edit(&dir, &id, ClipEdit { kept, title, tags })?;
        match parse_clip(&instance_id, &dir, &id) {
            Parsed::Ok(c) => Ok(*c),
            _ => Err(AppError::NotFound("Clip".into())),
        }
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

/// Auf Wunsch des Nutzers löschen (JSON zuerst, dann MP4 und JPG).
#[tauri::command]
pub async fn clip_delete(state: State<'_, AppState>, instance_id: String, id: String) -> AppResult<()> {
    let dir = checked_clip(&state, &instance_id, &id)?;
    let left = tokio::task::spawn_blocking(move || delete_clip(&dir, &id))
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
    if !left.is_empty() {
        tracing::warn!("Clip-Dateien gesperrt, das Spiel räumt sie später auf: {left:?}");
    }
    Ok(())
}

/// Clip-Ordner öffnen; mit `id` das Video im Explorer markieren.
#[tauri::command]
pub async fn clip_open_folder(state: State<'_, AppState>, instance_id: String, id: Option<String>) -> AppResult<()> {
    let dir = instance_clips_dir(&state, &instance_id)?;
    if let Some(id) = id {
        if !valid_id(&id) {
            return Err(AppError::Invalid("Clip-ID".into()));
        }
        let root = state.paths.instances();
        let file = checked_file(&root, &dir, &format!("{id}.mp4")).or_else(|_| checked_file(&root, &dir, &format!("{id}.json")))?;
        #[cfg(windows)]
        {
            let s = file.to_string_lossy();
            let s = s.strip_prefix(r"\\?\").unwrap_or(&s);
            std::process::Command::new("explorer").arg(format!("/select,{s}")).spawn()?;
            return Ok(());
        }
        #[cfg(not(windows))]
        {
            return crate::util::open_in_explorer(file.parent().unwrap_or(&dir));
        }
    }
    std::fs::create_dir_all(&dir)?;
    crate::util::open_in_explorer(&dir)
}
