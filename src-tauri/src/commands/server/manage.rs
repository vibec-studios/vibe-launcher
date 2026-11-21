use super::*;

#[derive(Serialize)]
pub struct ServerCreated {
    pub server: Server,
    pub task_id: String,
}

pub use server::ops::ServerAddresses;

#[tauri::command]
pub async fn servers_list(state: State<'_, AppState>) -> AppResult<Vec<Server>> {
    Ok(state.servers.list())
}

#[tauri::command]
pub async fn server_get(state: State<'_, AppState>, id: String) -> AppResult<Server> {
    state.servers.get(&id)
}

#[tauri::command]
pub async fn server_create(state: State<'_, AppState>, req: ServerCreate) -> AppResult<ServerCreated> {
    let mut req = req;
    if let Some(inst_id) = &req.from_instance {
        let inst = state.instances.get(inst_id)?;
        req.mc_version = inst.mc_version.clone();
        req.loader = inst.loader.clone();
    }
    let s = state.servers.create(&req)?;
    let from = req.from_instance.is_some().then(|| req.clone());
    let task_id = server::ops::spawn_install(&state, &s, false, from);
    Ok(ServerCreated { server: s, task_id })
}

#[tauri::command]
pub async fn server_mod_candidates(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<ServerModCandidate>> {
    state.instances.get(&instance_id)?;
    let dir = state.paths.game_dir(&instance_id).join("mods");
    let mut list = tokio::task::spawn_blocking(move || server::sides::candidates(&dir)).await?;
    // Genauere Einordnung aus den Inhalts-Metadaten (Modrinth client_side/server_side, mrpack env, Stores)
    if let Ok(infos) = crate::content::sides::classify(&state, &instance_id).await {
        for m in list.iter_mut() {
            let Some(info) = infos.iter().find(|i| i.kind == crate::content::ContentKind::Mod && i.file_name == m.file_name) else { continue };
            let side = match info.side {
                crate::content::Side::Client => server::sides::ModSide::Client,
                crate::content::Side::Both => server::sides::ModSide::Both,
                crate::content::Side::Server => server::sides::ModSide::Server,
                _ => continue,
            };
            m.side = side;
            m.server_ok = m.enabled && side != server::sides::ModSide::Client;
        }
    }
    Ok(list)
}

#[tauri::command]
pub async fn server_update(state: State<'_, AppState>, id: String, patch: ServerPatch) -> AppResult<Server> {
    server::ops::patch(&state, &id, patch)
}

#[tauri::command]
pub async fn server_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    server::ops::delete(&state, &id).await
}

#[tauri::command]
pub async fn server_set_icon(state: State<'_, AppState>, id: String, path: Option<String>) -> AppResult<Server> {
    let dir = server_dir(&state.paths, &id);
    state.servers.get(&id)?;
    let dest = dir.join("server-icon.png");
    match path {
        Some(p) => {
            let d2 = dest.clone();
            tokio::task::spawn_blocking(move || -> AppResult<()> {
                let img = image::open(&p).map_err(|e| AppError::Invalid(format!("Bild nicht lesbar: {e}")))?;
                img.resize_to_fill(64, 64, image::imageops::FilterType::Lanczos3)
                    .save_with_format(&d2, image::ImageFormat::Png)
                    .map_err(|e| AppError::msg(format!("Icon nicht speicherbar: {e}")))?;
                Ok(())
            })
            .await??;
            let p = dest.to_string_lossy().to_string();
            state.servers.modify(&id, |s| s.icon = Some(p))
        }
        None => {
            let _ = std::fs::remove_file(&dest);
            state.servers.modify(&id, |s| s.icon = None)
        }
    }
}
