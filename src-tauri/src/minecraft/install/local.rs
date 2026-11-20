use super::{asset_items, extract_natives, link_client_jar, materialize_assets, read_asset_index, vanilla_items, Prepared};
use crate::error::AppResult;
use crate::instance::{Instance, LoaderKind};
use crate::minecraft::meta::{self, Env, Resolved};
use crate::net::Net;
use crate::paths::Paths;
use crate::state::AppState;
use crate::tasks::SubProgress;
use futures::StreamExt;
use std::path::PathBuf;

pub(super) async fn missing_files(paths: &Paths, r: &Resolved, env: &Env) -> AppResult<usize> {
    let v = vanilla_items(paths, r, env);
    let mut items = v.items;
    let local_only = r.libraries.iter().filter_map(|l| l.artifact(&paths.libraries())).filter(|a| a.url.is_empty()).filter(|a| !a.path.is_file()).count();
    if let Some(p) = v.index_path.as_ref() {
        if !p.is_file() {
            return Ok(local_only + 1);
        }
        items.extend(asset_items(paths, &read_asset_index(p).await?));
    }
    let checks: Vec<bool> = futures::stream::iter(items.into_iter().map(|i| async move { Net::is_valid(&i).await })).buffer_unordered(32).collect().await;
    Ok(local_only + checks.iter().filter(|ok| !**ok).count())
}

fn loader_ready(paths: &Paths, inst: &Instance, mc: &str, version_id: &str) -> bool {
    let lv = inst.loader.version.as_deref().unwrap_or("").trim();
    match inst.loader.kind {
        LoaderKind::Vanilla => version_id == mc,
        LoaderKind::Fabric => version_id == format!("fabric-loader-{lv}-{mc}"),
        LoaderKind::Quilt => version_id == format!("quilt-loader-{lv}-{mc}"),
        kind => {
            let spec = crate::minecraft::forge::ForgeSpec { neoforge: kind == LoaderKind::Neoforge, mc, version: lv };
            crate::minecraft::forge::installed_locally(paths, &spec).as_deref() == Some(version_id)
        }
    }
}

pub(super) async fn resolve_local(paths: &Paths, inst: &Instance, env: &Env) -> AppResult<Option<(Resolved, Resolved)>> {
    let Some(version_id) = inst.version_id.clone().filter(|v| !v.is_empty()) else { return Ok(None) };
    let mc = inst.mc_version.trim();
    if !loader_ready(paths, inst, mc, &version_id) {
        return Ok(None);
    }
    let vanilla = meta::merge(&meta::load_chain(paths, mc)?, env);
    let resolved = if version_id == mc { vanilla.clone() } else { meta::merge(&meta::load_chain(paths, &version_id)?, env) };
    if resolved.base_id != mc {
        return Ok(None);
    }
    if missing_files(paths, &vanilla, env).await? + missing_files(paths, &resolved, env).await? > 0 {
        return Ok(None);
    }
    Ok(Some((vanilla, resolved)))
}

pub(super) async fn prepare(state: &AppState, inst: &Instance, sp: &SubProgress) -> AppResult<Option<Prepared>> {
    let paths = &state.paths;
    let env = Env::current();
    sp.message("Spieldateien werden geprüft …");
    let Some((vanilla, resolved)) = resolve_local(paths, inst, &env).await? else { return Ok(None) };
    sp.message("Java wird geprüft …");
    let major = meta::required_java(&vanilla);
    let component = vanilla.java.as_ref().and_then(|j| j.component.clone());
    let java = crate::minecraft::java::resolve(state, inst, major, component.as_deref(), false, &sp.sub(0.0, 0.6)).await?;
    sp.check()?;
    let game_dir = paths.game_dir(&inst.id);
    tokio::fs::create_dir_all(&game_dir).await?;
    let v = vanilla_items(paths, &vanilla, &env);
    let game_assets = match (&vanilla.asset_index, &v.index_path) {
        (Some(a), Some(p)) => materialize_assets(paths, &a.id, &read_asset_index(p).await?, &game_dir).await?,
        _ => paths.assets(),
    };
    sp.message("Abschluss …");
    let natives_dir = paths.natives_dir(&resolved.id);
    let (r2, libs, nd, p2) = (resolved.clone(), paths.libraries(), natives_dir.clone(), paths.clone());
    let client_jar = tokio::task::spawn_blocking(move || -> AppResult<PathBuf> {
        extract_natives(&r2, &libs, &nd, false)?;
        link_client_jar(&p2, &r2)
    })
    .await??;
    sp.progress(1.0);
    tracing::info!("Instanz {}: Schnellstart mit vorhandenen Dateien", inst.id);
    Ok(Some(Prepared { resolved, java, game_assets, client_jar, log_config: v.log_config, natives_dir }))
}

#[cfg(test)]
mod tests;
