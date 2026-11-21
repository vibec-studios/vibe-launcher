//! Installation einer Instanz: Vanilla (Versions-JSON, Client, Libraries, Natives, Assets, Logging),
//! Java, Mod-Loader. Bereits vorhandene Dateien werden schnell übersprungen.
use super::meta::{self, Env, Resolved};
use super::JavaInstall;
use crate::error::{AppError, AppResult, Ctx};
use crate::instance::{InstallState, LoaderKind};
use crate::net::DownloadItem;
use crate::state::AppState;
use crate::tasks::SubProgress;
use futures::StreamExt;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

mod local;

mod assets;
mod check;
mod vanilla;

use assets::*;
use vanilla::*;

/// Ergebnis der Installation – alles, was der Start braucht.
#[derive(Debug, Clone)]
pub struct Prepared {
    pub resolved: Resolved,
    pub java: JavaInstall,
    /// Wert für `${game_assets}`
    pub game_assets: PathBuf,
    /// Client-JAR für den Klassenpfad
    pub client_jar: PathBuf,
    /// Pfad zur Log4j-Konfiguration (falls vorhanden)
    pub log_config: Option<PathBuf>,
    pub natives_dir: PathBuf,
}

async fn do_install(state: &AppState, id: &str, sp: &SubProgress, force: bool, installed: bool) -> AppResult<Prepared> {
    let inst = state.instances.get(id)?;
    if installed && !force {
        match local::prepare(state, &inst, sp).await {
            Ok(Some(p)) => return Ok(p),
            Ok(None) => tracing::info!("Instanz {id}: lokale Dateien unvollständig, vollständige Prüfung"),
            Err(e) => tracing::info!("Instanz {id}: Schnellstart nicht möglich ({e}), vollständige Prüfung"),
        }
    }
    let mc = inst.mc_version.trim().to_string();
    let game_dir = state.paths.game_dir(id);
    tokio::fs::create_dir_all(&game_dir).await?;

    // 1. Vanilla-JSON
    sp.message(format!("Minecraft {mc} wird vorbereitet …"));
    sp.progress(0.0);
    meta::ensure_vanilla_json(state, &mc, force).await?;
    let env = Env::current();
    let vanilla_chain = meta::load_chain(&state.paths, &mc)?;
    let vanilla = meta::merge(&vanilla_chain, &env);
    sp.check()?;

    // 2. Java
    sp.message("Java wird geprüft …");
    let major = meta::required_java(&vanilla);
    let component = vanilla.java.as_ref().and_then(|j| j.component.clone());
    let java = super::java::resolve(state, &inst, major, component.as_deref(), force, &sp.sub(0.02, 0.15)).await?;
    sp.check()?;

    // 3. Vanilla-Dateien
    let (game_assets, log_config) = install_vanilla_files(state, &vanilla, &game_dir, force, &sp.sub(0.15, 0.75)).await?;

    // 4. Loader
    let loader_sp = sp.sub(0.75, 0.97);
    let version_id = match inst.loader.kind {
        LoaderKind::Vanilla => mc.clone(),
        kind => {
            let lv = inst.loader.version.clone().filter(|v| !v.trim().is_empty()).ctx("Loader-Version fehlt")?;
            sp.message(format!("{} {lv} wird installiert …", super::loaders::loader_name(kind)));
            match kind {
                LoaderKind::Fabric | LoaderKind::Quilt => super::loaders::install_fabric_like(state, kind, &mc, &lv, force).await?,
                _ => {
                    let spec = super::forge::ForgeSpec { neoforge: kind == LoaderKind::Neoforge, mc: &mc, version: &lv };
                    super::forge::install(state, spec, Path::new(&java.path), force, &loader_sp).await?
                }
            }
        }
    };
    sp.check()?;
    let resolved = if version_id == mc {
        vanilla
    } else {
        let chain = meta::load_chain(&state.paths, &version_id)?;
        let r = meta::merge(&chain, &env);
        if r.base_id != mc {
            return Err(AppError::msg(format!("Loader-Profil {version_id} passt nicht zu Minecraft {mc}.")));
        }
        sp.message("Loader-Bibliotheken werden geladen …");
        download(state, library_items(&r, &state.paths.libraries(), &env), force, &loader_sp).await?;
        r
    };
    sp.check()?;

    // 5. Natives + Client-JAR
    sp.message("Abschluss …");
    let natives_dir = state.paths.natives_dir(&resolved.id);
    let r2 = resolved.clone();
    let libs = state.paths.libraries();
    let nd = natives_dir.clone();
    let paths = state.paths.clone();
    let client_jar = tokio::task::spawn_blocking(move || -> AppResult<PathBuf> {
        extract_natives(&r2, &libs, &nd, force)?;
        link_client_jar(&paths, &r2)
    })
    .await??;
    sp.progress(1.0);
    Ok(Prepared { resolved, java, game_assets, client_jar, log_config, natives_dir })
}

/// Installation mit Status-Verwaltung der Instanz. `force` prüft alle Dateien per Hash.
pub async fn install_instance_opts(state: &AppState, id: &str, sp: &SubProgress, force: bool) -> AppResult<Prepared> {
    let inst = state.instances.get(id)?;
    // Loader-Version festlegen, falls offen (vor dem Statuswechsel: Loader-Änderung setzt den Status zurück)
    if inst.loader.kind != LoaderKind::Vanilla && inst.loader.version.as_deref().is_none_or_empty() {
        sp.message("Loader-Version wird bestimmt …");
        let v = super::loaders::default_loader_version(state, inst.loader.kind, &inst.mc_version).await?;
        state.instances.modify(id, |i| i.loader.version = Some(v))?;
    }
    let inst = state.instances.get(id)?;
    let quick = inst.install_state == InstallState::Installed && !force;
    let mut tried = false;
    let lock = match state.install_lock.try_lock() {
        Ok(g) if quick => {
            tried = true;
            match local::prepare(state, &inst, sp).await {
                Ok(Some(p)) => return Ok(p),
                Ok(None) => tracing::info!("Instanz {id}: lokale Dateien unvollständig, vollständige Prüfung"),
                Err(e) => tracing::info!("Instanz {id}: Schnellstart nicht möglich ({e}), vollständige Prüfung"),
            }
            g
        }
        Ok(g) => g,
        Err(_) => {
            sp.message("Warte auf eine andere Installation …");
            let cancel = sp.task.cancel_token();
            tokio::select! {
                g = state.install_lock.lock() => g,
                _ = cancel.cancelled() => return Err(AppError::Cancelled),
            }
        }
    };
    let before = state.instances.get(id)?.install_state;
    state.instances.modify(id, |i| i.install_state = InstallState::Installing)?;
    let res = do_install(state, id, sp, force, before == InstallState::Installed && !tried).await;
    drop(lock);
    match &res {
        Ok(p) => {
            let vid = p.resolved.id.clone();
            state.instances.modify(id, |i| {
                i.install_state = InstallState::Installed;
                i.version_id = Some(vid);
            })?;
        }
        Err(AppError::Cancelled) => {
            let restore = if before == InstallState::Installing { InstallState::NotInstalled } else { before };
            let _ = state.instances.modify(id, |i| i.install_state = restore);
        }
        Err(e) => {
            tracing::error!("Installation von {id} fehlgeschlagen: {e}");
            let _ = state.instances.modify(id, |i| i.install_state = InstallState::Failed);
        }
    }
    res
}

trait OptStrExt {
    fn is_none_or_empty(&self) -> bool;
}
impl OptStrExt for Option<&str> {
    fn is_none_or_empty(&self) -> bool {
        self.map(|s| s.trim().is_empty()).unwrap_or(true)
    }
}
