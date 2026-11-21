//! Commands der Vibe-Dienste (siehe `vibe/`). Alle respektieren `settings.vibe` – ist der Hauptschalter
//! aus, schlagen Netzwerk-Commands mit `not_configured` fehl, ohne eine Verbindung aufzubauen.
use crate::error::AppResult;
use crate::state::AppState;
use crate::vibe::{self, packs, ws, Feature, HttpRequest, HttpResponse, JoinResult, VibeIdentity, VibeTokens};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

#[derive(Serialize)]
pub struct VibeStatus {
    pub enabled: bool,
    /// Backend-Adresse (immer das offizielle Backend; nur Debug-Builds: Env `VIBE_API_URL`)
    pub api_url: String,
    pub gateway_url: String,
    /// Minecraft-Account, mit dem angemeldet wird (None = keiner)
    pub identity: Option<VibeIdentity>,
    /// Gespeicherte Vibe-Anmeldung für diesen Account + diese Adresse vorhanden
    pub logged_in: bool,
}

#[tauri::command]
pub async fn vibe_status(state: State<'_, AppState>) -> AppResult<VibeStatus> {
    let api_url = vibe::api_base(&state);
    Ok(VibeStatus {
        enabled: state.settings().vibe.enabled,
        gateway_url: ws::gateway_url(&api_url),
        api_url,
        identity: vibe::identity(&state),
        logged_in: vibe::tokens_get(&state).is_some(),
    })
}

/// Ankündigungen des Backends (Banner). Hauptschalter aus -> `not_configured`, ohne Verbindung.
#[tauri::command]
pub async fn vibe_announcements(state: State<'_, AppState>, lang: String) -> AppResult<Vec<vibe::announcements::Announcement>> {
    vibe::announcements::fetch(&state, &lang).await
}

/// Tokens des aktiven Accounts (für den TokenStore des SDK).
#[tauri::command]
pub async fn vibe_tokens_get(state: State<'_, AppState>) -> AppResult<Option<VibeTokens>> {
    if !state.settings().vibe.enabled {
        return Ok(None);
    }
    Ok(vibe::tokens_get(&state))
}

#[tauri::command]
pub async fn vibe_tokens_set(state: State<'_, AppState>, tokens: Option<VibeTokens>) -> AppResult<()> {
    vibe::tokens_set(&state, tokens)
}

/// Login-Schritt 2: Mojang-`join` mit der `serverId` des Backends. Liefert den Minecraft-Namen.
#[tauri::command]
pub async fn vibe_mojang_join(state: State<'_, AppState>, server_id: String) -> AppResult<JoinResult> {
    vibe::mojang_join(&state, &server_id).await
}

/// HTTP-Anfrage ans Vibe-Backend (fetch-Ersatz des SDK).
#[tauri::command]
pub async fn vibe_http(state: State<'_, AppState>, request: HttpRequest) -> AppResult<HttpResponse> {
    vibe::http(&state, request).await
}

#[tauri::command]
pub async fn vibe_ws_open(state: State<'_, AppState>, id: String, url: String) -> AppResult<()> {
    ws::open(&state, id, url)
}

#[tauri::command]
pub async fn vibe_ws_send(id: String, data: String) -> AppResult<()> {
    ws::send(&id, data)
}

#[tauri::command]
pub async fn vibe_ws_close(id: String, code: Option<u16>, reason: Option<String>) -> AppResult<()> {
    ws::close(&id, code, reason);
    Ok(())
}

/// Instanz als geteiltes Pack hochladen (bzw. neue Version, wenn `options.code` gesetzt). Liefert `Pack`.
#[tauri::command]
pub async fn vibe_pack_share(state: State<'_, AppState>, instance_id: String, token: String, options: packs::ShareOptions) -> AppResult<Value> {
    packs::share(&state, &instance_id, &token, options).await
}

/// Zuletzt geteilter Code einer Instanz (falls vorhanden).
#[tauri::command]
pub async fn vibe_pack_link(state: State<'_, AppState>, instance_id: String) -> AppResult<Option<packs::ShareLink>> {
    Ok(packs::share_link(&state, &instance_id))
}

/// Geteiltes Pack per Code importieren. Gibt die Task-ID zurück (neue Instanz über `TaskInfo.instance_id`).
#[tauri::command]
pub async fn vibe_pack_install(state: State<'_, AppState>, code: String, version_id: Option<String>, token: Option<String>) -> AppResult<String> {
    vibe::ensure(&state, Feature::Sharing)?;
    let st = state.inner().clone();
    let title = format!("Pack {code} importieren");
    Ok(state.tasks.spawn("import", title, None, move |task| packs::install(st, task, code, version_id, token)))
}

/// Lokalen Screenshot zu Vibe hochladen (`visibility`: private | friends | link). Liefert `Screenshot`.
#[tauri::command]
pub async fn vibe_screenshot_upload(state: State<'_, AppState>, path: String, visibility: String, token: String) -> AppResult<Value> {
    vibe::media::upload_screenshot(&state, &path, &visibility, &token).await
}

/// Bild vom Vibe-Backend (z. B. Screenshot eines Freundes) als data-URL.
#[tauri::command]
pub async fn vibe_image(state: State<'_, AppState>, url: String, token: Option<String>) -> AppResult<String> {
    vibe::media::image(&state, &url, token.as_deref()).await
}

/// Manifeste (nur Datei-Referenzen) der gewählten Instanzen für die Cloud-Sicherung.
#[tauri::command]
pub async fn vibe_cloud_manifests(state: State<'_, AppState>, instance_ids: Vec<String>) -> AppResult<Vec<vibe::media::CloudInstance>> {
    vibe::media::manifests(&state, instance_ids).await
}

/// Instanz aus einem Cloud-Manifest anlegen. Gibt die Task-ID zurück.
#[tauri::command]
pub async fn vibe_cloud_restore_instance(state: State<'_, AppState>, manifest: Value) -> AppResult<String> {
    vibe::ensure(&state, Feature::Any)?;
    let name = manifest["name"].as_str().unwrap_or("Instanz").to_string();
    let st = state.inner().clone();
    Ok(state.tasks.spawn("import", format!("{name} aus der Cloud wiederherstellen"), None, move |task| vibe::media::restore(st, task, manifest)))
}
