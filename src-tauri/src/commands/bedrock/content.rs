use super::*;

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
