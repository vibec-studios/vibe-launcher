//! OWNER: Auth-Agent. Skins & Capes (Profil bei Minecraft) und lokale Skin-Bibliothek.
use crate::auth::skins::{self, LibrarySkin, RawProfile, SkinProfile, SkinVariant};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::state::AppState;
use serde_json::json;
use std::future::Future;
use std::path::PathBuf;
use tauri::State;

pub(crate) fn texture_cache(st: &AppState) -> PathBuf {
    st.paths.cache().join("textures")
}

/// Profil-Aktion mit gültigem Token ausführen; bei 401 einmal neu anmelden (Refresh) und wiederholen.
pub(crate) async fn with_token<F, Fut>(st: &AppState, account_id: Option<&str>, f: F) -> AppResult<(String, RawProfile)>
where
    F: Fn(reqwest::Client, String) -> Fut,
    Fut: Future<Output = AppResult<RawProfile>>,
{
    let (id, token) = st.auth.mc_session(st, account_id).await?;
    match f(st.net.client.clone(), token).await {
        Err(AppError::Auth(_)) => {
            st.auth.refresh(st, &id, true).await?;
            let (_, token) = st.auth.mc_session(st, Some(&id)).await?;
            Ok((id, f(st.net.client.clone(), token).await?))
        }
        r => Ok((id, r?)),
    }
}

/// Ergebnis übernehmen: Account-Skin-URL aktualisieren, Events senden, Profil fürs Frontend bauen.
async fn finish(st: &AppState, id: &str, raw: RawProfile, changed: bool) -> SkinProfile {
    st.auth.set_skin_url(id, raw.active_skin().map(|s| s.url.clone()).filter(|u| !u.is_empty()));
    let profile = skins::build_profile(&st.net.client, &texture_cache(st), id, &raw).await;
    if changed {
        events::emit(&st.app, skins::SKINS_CHANGED, &json!({ "scope": "profile", "account_id": id }));
    }
    profile
}

fn library_changed(st: &AppState) {
    events::emit(&st.app, skins::SKINS_CHANGED, &json!({ "scope": "library" }));
}

async fn read_png(path: &str) -> AppResult<Vec<u8>> {
    let meta = tokio::fs::metadata(path).await.map_err(|_| AppError::NotFound(path.to_string()))?;
    if meta.len() > 512 * 1024 {
        return Err(AppError::Invalid("Die Skin-Datei ist zu groß (max. 512 KB).".into()));
    }
    let b = tokio::fs::read(path).await?;
    skins::validate_skin_png(&b)?;
    Ok(b)
}

// ------------------------------------------------------------------ Profil

/// Aktueller Skin + Capes eines Accounts (`account_id = None` -> aktiver Account).
#[tauri::command]
pub async fn skins_profile(state: State<'_, AppState>, account_id: Option<String>) -> AppResult<SkinProfile> {
    let st = state.inner().clone();
    let (id, raw) = with_token(&st, account_id.as_deref(), |c, t| async move { skins::fetch_profile(&c, &t).await }).await?;
    Ok(finish(&st, &id, raw, false).await)
}

/// Skin aus einer PNG-Datei setzen.
#[tauri::command]
pub async fn skin_upload_file(state: State<'_, AppState>, account_id: Option<String>, path: String, variant: SkinVariant) -> AppResult<SkinProfile> {
    let st = state.inner().clone();
    let png = read_png(&path).await?;
    let (id, raw) = with_token(&st, account_id.as_deref(), |c, t| {
        let png = png.clone();
        async move { skins::upload_skin(&c, &t, variant, png).await }
    })
    .await?;
    Ok(finish(&st, &id, raw, true).await)
}

/// Skin aus der Bibliothek setzen (`variant = None` -> Variante des Eintrags).
#[tauri::command]
pub async fn skin_apply_library(state: State<'_, AppState>, account_id: Option<String>, id: String, variant: Option<SkinVariant>) -> AppResult<SkinProfile> {
    apply_library(state.inner(), account_id, id, variant).await
}

/// Körper von `skin_apply_library`.
async fn apply_library(state: &AppState, account_id: Option<String>, id: String, variant: Option<SkinVariant>) -> AppResult<SkinProfile> {
    let st = state.clone();
    let (png, lib_variant) = st.auth.skins.bytes(&id)?;
    let variant = variant.unwrap_or(lib_variant);
    let (acc, mut raw) = with_token(&st, account_id.as_deref(), |c, t| {
        let png = png.clone();
        async move { skins::upload_skin(&c, &t, variant, png).await }
    })
    .await?;
    // Zugeordnetes Cape (z. B. aus der Modrinth App) mitsetzen, wenn der Account es besitzt
    if let Some(cape) = st.auth.skins.get(&id).ok().and_then(|s| s.cape_id) {
        let owned = raw.capes.iter().any(|c| c.id == cape);
        let active = raw.capes.iter().any(|c| c.id == cape && c.state.eq_ignore_ascii_case("ACTIVE"));
        if owned && !active {
            match with_token(&st, Some(&acc), |c, t| {
                let cape = cape.clone();
                async move { skins::set_cape(&c, &t, Some(&cape)).await }
            })
            .await
            {
                Ok((_, r)) => raw = r,
                Err(e) => tracing::warn!("Cape {cape} konnte nicht gesetzt werden: {e}"),
            }
        }
    }
    Ok(finish(&st, &acc, raw, true).await)
}

/// Variante (Classic/Slim) des aktuellen Skins ändern (lädt dieselbe Textur neu hoch).
#[tauri::command]
pub async fn skin_set_variant(state: State<'_, AppState>, account_id: Option<String>, variant: SkinVariant) -> AppResult<SkinProfile> {
    let st = state.inner().clone();
    let cache = texture_cache(&st);
    let (acc, raw) = with_token(&st, account_id.as_deref(), |c, t| {
        let cache = cache.clone();
        async move {
            let cur = skins::fetch_profile(&c, &t).await?;
            let url = cur.active_skin().map(|s| s.url.clone()).filter(|u| !u.is_empty()).ok_or_else(|| AppError::msg("Kein aktueller Skin"))?;
            let png = skins::fetch_texture(&c, &cache, &url).await?;
            skins::upload_skin(&c, &t, variant, png).await
        }
    })
    .await?;
    Ok(finish(&st, &acc, raw, true).await)
}

/// Standard-Skin wiederherstellen.
#[tauri::command]
pub async fn skin_reset(state: State<'_, AppState>, account_id: Option<String>) -> AppResult<SkinProfile> {
    let st = state.inner().clone();
    let (id, raw) = with_token(&st, account_id.as_deref(), |c, t| async move { skins::reset_skin(&c, &t).await }).await?;
    Ok(finish(&st, &id, raw, true).await)
}

/// Cape aktivieren (`cape_id = None` -> Cape ausblenden).
#[tauri::command]
pub async fn cape_set(state: State<'_, AppState>, account_id: Option<String>, cape_id: Option<String>) -> AppResult<SkinProfile> {
    let st = state.inner().clone();
    let (id, raw) = with_token(&st, account_id.as_deref(), |c, t| {
        let cape = cape_id.clone();
        async move { skins::set_cape(&c, &t, cape.as_deref()).await }
    })
    .await?;
    Ok(finish(&st, &id, raw, true).await)
}

// ------------------------------------------------------------------ Bibliothek

#[tauri::command]
pub async fn skin_library_list(state: State<'_, AppState>) -> AppResult<Vec<LibrarySkin>> {
    let st = state.inner().clone();
    Ok(tokio::task::spawn_blocking(move || st.auth.skins.list()).await?)
}

/// PNG-Datei in die Bibliothek aufnehmen (Name: Dateiname, falls leer).
#[tauri::command]
pub async fn skin_library_add_file(state: State<'_, AppState>, path: String, name: Option<String>, variant: Option<SkinVariant>) -> AppResult<LibrarySkin> {
    let png = read_png(&path).await?;
    let name = name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| std::path::Path::new(&path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default());
    let skin = state.auth.skins.add(&png, &name, variant.unwrap_or_default(), Some("file".into()))?;
    library_changed(&state);
    Ok(skin)
}

#[tauri::command]
pub async fn skin_library_add_data(state: State<'_, AppState>, png: String, name: String, variant: SkinVariant) -> AppResult<LibrarySkin> {
    let bytes = skins::decode_png_payload(&png)?;
    let skin = state.auth.skins.add(&bytes, &name, variant, Some("editor".into()))?;
    library_changed(&state);
    Ok(skin)
}

/// Aktuellen Skin eines Accounts in die Bibliothek speichern.
#[tauri::command]
pub async fn skin_library_add_current(state: State<'_, AppState>, account_id: Option<String>) -> AppResult<LibrarySkin> {
    let st = state.inner().clone();
    let (_, raw) = with_token(&st, account_id.as_deref(), |c, t| async move { skins::fetch_profile(&c, &t).await }).await?;
    let cur = raw.active_skin().filter(|s| !s.url.is_empty()).ok_or_else(|| AppError::msg("Dieser Account hat keinen Skin"))?;
    let png = skins::fetch_texture(&st.net.client, &texture_cache(&st), &cur.url).await?;
    let variant = SkinVariant::from_api(cur.variant.as_deref().unwrap_or("classic"));
    let skin = st.auth.skins.add(&png, &raw.name, variant, Some(format!("account:{}", raw.name)))?;
    library_changed(&st);
    Ok(skin)
}

/// Skin eines Spielers per Name importieren (Mojang-API).
#[tauri::command]
pub async fn skin_library_import_player(state: State<'_, AppState>, name: String) -> AppResult<LibrarySkin> {
    let st = state.inner().clone();
    let p = skins::lookup_player(&st.net.client, &name).await?;
    let png = skins::fetch_texture(&st.net.client, &texture_cache(&st), &p.url).await?;
    let skin = st.auth.skins.add(&png, &p.name, p.variant, Some(format!("player:{}", p.name)))?;
    library_changed(&st);
    Ok(skin)
}

#[tauri::command]
pub async fn skin_library_rename(state: State<'_, AppState>, id: String, name: String) -> AppResult<LibrarySkin> {
    let s = state.auth.skins.modify(&id, |e| e.name = name)?;
    library_changed(&state);
    Ok(s)
}

#[tauri::command]
pub async fn skin_library_set_variant(state: State<'_, AppState>, id: String, variant: SkinVariant) -> AppResult<LibrarySkin> {
    let s = state.auth.skins.modify(&id, |e| e.variant = variant)?;
    library_changed(&state);
    Ok(s)
}

#[tauri::command]
pub async fn skin_library_remove(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.auth.skins.remove(&id)?;
    library_changed(&state);
    Ok(())
}

/// Skin-PNG an einen Zielpfad kopieren (Pfad aus dem Speichern-Dialog).
#[tauri::command]
pub async fn skin_library_export(state: State<'_, AppState>, id: String, path: String) -> AppResult<()> {
    let src = state.auth.skins.path(&id)?;
    tokio::fs::copy(&src, &path).await?;
    Ok(())
}

/// Skin-Datei im Explorer markieren.
#[tauri::command]
pub async fn skin_library_reveal(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let p = state.auth.skins.path(&id)?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer").arg(format!("/select,{}", p.display())).spawn()?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        crate::util::open_in_explorer(p.parent().unwrap_or(&p))
    }
}

// ------------------------------------------------------------------ Import aus anderen Launchern

/// Installierte Launcher (Modrinth App, NoRisk, Lunar) nach gespeicherten Skins durchsuchen (nur lesend).
#[tauri::command]
pub async fn skin_import_scan(state: State<'_, AppState>) -> AppResult<crate::auth::skin_import::ImportScan> {
    Ok(crate::auth::skin_import::scan(&state).await)
}

/// Ausgewählte Skins (`keys`, sonst alle neuen) in die Bibliothek übernehmen.
#[tauri::command]
pub async fn skin_import_run(state: State<'_, AppState>, keys: Option<Vec<String>>) -> AppResult<crate::auth::skin_import::ImportResult> {
    let r = crate::auth::skin_import::import(&state, keys).await?;
    if r.imported > 0 {
        library_changed(&state);
    }
    Ok(r)
}

#[tauri::command]
pub async fn skin_import_set_auto(state: State<'_, AppState>, enabled: bool) -> AppResult<()> {
    crate::auth::skin_import::set_auto(&state, enabled)
}
