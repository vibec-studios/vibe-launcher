use super::*;

#[tauri::command]
pub async fn clip_set_trim(state: State<'_, AppState>, instance_id: String, id: String, trim: Option<TrimRange>) -> AppResult<Clip> {
    let dir = checked_clip(&state, &instance_id, &id)?;
    tokio::task::spawn_blocking(move || -> AppResult<Clip> {
        set_trim(&dir, &id, trim)?;
        match parse_clip(&instance_id, &dir, &id) {
            Parsed::Ok(c) => Ok(*c),
            _ => Err(AppError::NotFound("Clip".into())),
        }
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub async fn clip_export_available(state: State<'_, AppState>, instance_id: String, id: String) -> AppResult<bool> {
    let dir = checked_clip(&state, &instance_id, &id)?;
    Ok(ffmpeg_for(&state, &dir).is_some())
}

#[tauri::command]
pub async fn clip_export_trim(
    state: State<'_, AppState>,
    instance_id: String,
    id: String,
    in_ms: i64,
    out_ms: i64,
    delete_original: Option<bool>,
) -> AppResult<ClipExport> {
    let dir = checked_clip(&state, &instance_id, &id)?;
    let ffmpeg = ffmpeg_for(&state, &dir).ok_or_else(|| AppError::NotConfigured("FFmpeg".into()))?;
    let r = tokio::task::spawn_blocking(move || export(&dir, &instance_id, &id, TrimRange { in_ms, out_ms }, &ffmpeg, delete_original.unwrap_or(false)))
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
    crate::events::emit(&state.app, crate::events::CLIPS_CHANGED, &clips::ClipsChanged { instance_ids: vec![r.clip.instance_id.clone()] });
    Ok(r)
}
