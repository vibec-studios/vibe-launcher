use crate::content::world_preview::mods::{self, MapSource, Overview, TileQuery, Waypoint};
use crate::error::{AppError, AppResult};
use crate::platform::servers::read_servers;
use crate::state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::LazyLock;
use tauri::State;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

static TILE_LIMIT: Semaphore = Semaphore::const_new(2);
static SESSIONS: LazyLock<Mutex<HashMap<String, CancellationToken>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
const MAX_SESSIONS: usize = 64;

fn game_dir(state: &AppState, instance_id: &str) -> AppResult<PathBuf> {
    state.instances.get(instance_id)?;
    Ok(state.paths.game_dir(instance_id))
}

fn session(id: &str) -> AppResult<CancellationToken> {
    if id.is_empty() || id.len() > 64 {
        return Err(AppError::Invalid("Kartensitzung".into()));
    }
    let mut sessions = SESSIONS.lock();
    if sessions.len() >= MAX_SESSIONS && !sessions.contains_key(id) {
        sessions.retain(|_, token| !token.is_cancelled());
        if sessions.len() >= MAX_SESSIONS {
            let oldest = sessions.keys().next().cloned();
            if let Some(oldest) = oldest {
                sessions.remove(&oldest);
            }
        }
    }
    Ok(sessions.entry(id.to_string()).or_default().clone())
}

#[tauri::command]
pub async fn world_map_sources(
    state: State<'_, AppState>,
    instance_id: String,
) -> AppResult<Vec<MapSource>> {
    let game = game_dir(&state, &instance_id)?;
    tokio::task::spawn_blocking(move || {
        let servers = read_servers(&game.join("servers.dat")).unwrap_or_default();
        Ok(mods::list_sources(&game, &servers))
    })
    .await?
}

#[tauri::command]
pub async fn world_map_overview(
    state: State<'_, AppState>,
    instance_id: String,
    source: String,
    dimension: String,
) -> AppResult<Option<Overview>> {
    let game = game_dir(&state, &instance_id)?;
    tokio::task::spawn_blocking(move || mods::overview(&game, &source, &dimension)).await?
}

#[tauri::command]
pub async fn world_map_waypoints(
    state: State<'_, AppState>,
    instance_id: String,
    world: String,
    dimension: String,
) -> AppResult<Vec<Waypoint>> {
    let game = game_dir(&state, &instance_id)?;
    tokio::task::spawn_blocking(move || Ok(mods::world_waypoints(&game, &world, &dimension, None)))
        .await?
}

#[derive(Serialize)]
pub struct MapTile {
    png: String,
    lod: u32,
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn world_map_tile(
    state: State<'_, AppState>,
    instance_id: String,
    source: String,
    layer: String,
    x: i32,
    z: i32,
    lod: u32,
    session: String,
) -> AppResult<Option<MapTile>> {
    let game = game_dir(&state, &instance_id)?;
    let cache = state.paths.cache();
    let token = self::session(&session)?;
    let permit = tokio::select! {
        _ = token.cancelled() => return Err(AppError::Cancelled),
        result = TILE_LIMIT.acquire() => result.map_err(|_| AppError::Cancelled)?,
    };
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        if token.is_cancelled() {
            return Err(AppError::Cancelled);
        }
        let query = TileQuery {
            game: &game,
            cache: &cache,
            source: &source,
            layer: &layer,
            x,
            z,
            lod,
        };
        Ok(mods::tile(&query, &token)?.map(|png| MapTile {
            png: STANDARD.encode(png),
            lod,
        }))
    })
    .await?
}

#[tauri::command]
pub fn world_map_cancel(session: String) {
    if let Some(token) = SESSIONS.lock().remove(&session) {
        token.cancel();
    }
}
