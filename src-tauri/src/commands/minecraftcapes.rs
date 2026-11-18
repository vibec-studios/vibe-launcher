//! MinecraftCapes: Cape/Ohren des eigenen Accounts (nur lesen) und Mod-Schalter je Instanz.
use crate::content::{install, modrinth as mr, Source};
use crate::error::{AppError, AppResult};
use crate::minecraftcapes::{self as mc, McProfile, ModStatus};
use crate::state::AppState;
use tauri::State;

/// MinecraftCapes-Profil eines Accounts (`account_id = None` -> aktiver Account).
/// Fragt nur die UUID des eigenen Accounts ab; ist die Einstellung aus, gibt es keine Anfrage.
#[tauri::command]
pub async fn mccapes_profile(state: State<'_, AppState>, account_id: Option<String>) -> AppResult<McProfile> {
    if !state.settings().minecraftcapes {
        return Err(AppError::NotConfigured("MinecraftCapes ist in den Einstellungen ausgeschaltet".into()));
    }
    let accounts = state.auth.list();
    let acc = match account_id.as_deref() {
        Some(id) => accounts.iter().find(|a| a.id == id),
        None => accounts.iter().find(|a| a.active).or(accounts.first()),
    }
    .ok_or_else(|| AppError::NotFound("Account".into()))?;
    let ident = mc::identifier(&acc.uuid, &acc.username).ok_or_else(|| AppError::Invalid("Account ohne gültige UUID".into()))?;
    mc::fetch(&state, &acc.id, &ident).await
}

/// Status der Mod in allen Instanzen (installiert, passende Version, Grund für „nicht unterstützt“).
#[tauri::command]
pub async fn mccapes_mod_status(state: State<'_, AppState>) -> AppResult<Vec<ModStatus>> {
    let st = state.inner().clone();
    let instances = st.instances.list();
    // Versionsliste einmal vorab laden (danach aus dem Cache), statt parallel je Instanz
    let _ = mr::raw_versions(&st, mc::MOD_PROJECT_ID).await;
    let all = futures::future::join_all(instances.iter().map(|i| mc::status(&st, i))).await;
    Ok(all)
}

/// Mod ein- (Task-ID) oder ausschalten (deinstalliert, `None`).
#[tauri::command]
pub async fn mccapes_mod_set(state: State<'_, AppState>, instance_id: String, enabled: bool) -> AppResult<Option<String>> {
    let inst = state.instances.get(&instance_id)?;
    if !enabled {
        mc::uninstall(&state, &inst).await?;
        return Ok(None);
    }
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(Some(state.tasks.spawn("content", "MinecraftCapes installieren", Some(instance_id), move |task| {
        install::run_install(st, task, iid, Source::Modrinth, mc::MOD_PROJECT_ID.to_string(), None)
    })))
}
