use super::auth::Authed;
use super::body::{self, MIB};
use super::error::{ApiError, ApiResult};
use crate::roles::Perm;
use crate::state::Ctx;
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use vibe_server_core::server::extras::{self, ExtrasInfo};
use vibe_server_core::server::plugins::{self, AddonList, AddonProject, AddonSearch, AddonSource, AddonUpdate};
use vibe_server_core::server::server_dir;

pub async fn list(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<Json<AddonList>> {
    a.server(Perm::ServersRead, &id)?;
    let s = ctx.core.servers.get(&id)?;
    Ok(Json(plugins::list(&ctx.core, &s).await?))
}

#[derive(Deserialize)]
pub struct SearchQuery {
    #[serde(default = "default_source")]
    source: AddonSource,
    #[serde(default, alias = "q")]
    query: String,
    #[serde(default)]
    sort: Option<String>,
    #[serde(default)]
    offset: u32,
}

fn default_source() -> AddonSource {
    AddonSource::Modrinth
}

pub async fn search(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Query(q): Query<SearchQuery>) -> ApiResult<Json<AddonSearch>> {
    a.server(Perm::ServersRead, &id)?;
    let s = ctx.core.servers.get(&id)?;
    Ok(Json(plugins::search(&ctx.core, &s, q.source, &q.query, q.sort.as_deref().unwrap_or("relevance"), q.offset).await?))
}

pub async fn hangar_project(State(ctx): State<Ctx>, a: Authed, Path(project): Path<String>) -> ApiResult<Json<AddonProject>> {
    a.require(Perm::ServersRead)?;
    Ok(Json(plugins::hangar_project(&ctx.core, &project).await?))
}

#[derive(Deserialize)]
pub struct InstallReq {
    source: AddonSource,
    project: String,
    #[serde(default)]
    version: Option<String>,
}

pub async fn install(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Json(r): Json<InstallReq>) -> ApiResult<Json<Vec<String>>> {
    a.server(Perm::ServersManage, &id)?;
    let s = ctx.core.servers.get(&id)?;
    let files = match (&r.version, r.source) {
        (Some(v), AddonSource::Modrinth) if !v.trim().is_empty() => plugins::install_modrinth_version(&ctx.core, &s, v.trim()).await?,
        _ => plugins::install(&ctx.core, &s, r.source, &r.project).await?,
    };
    a.audit(&ctx, "addons.install", Some(&id), true, Some(format!("{:?} {}", r.source, r.project)));
    Ok(Json(files))
}

#[derive(Deserialize)]
pub struct UploadQuery {
    filename: String,
}

pub async fn upload(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Query(q): Query<UploadQuery>, data: Body) -> ApiResult<Json<String>> {
    a.server(Perm::ServersManage, &id)?;
    let s = ctx.core.servers.get(&id)?;
    let folder = s.addon_dir().ok_or_else(|| ApiError::invalid("Vanilla-Server haben keine Plugins oder Mods."))?;
    let name = vibe_server_core::paths::sanitize_file_name(q.filename.rsplit(['/', '\\']).next().unwrap_or_default());
    if !name.to_ascii_lowercase().ends_with(".jar") {
        return Err(ApiError::invalid("Nur .jar-Dateien sind erlaubt."));
    }
    let dest = server_dir(&ctx.core.paths, &id).join(folder).join(&name);
    body::to_file(data, &dest, 256 * MIB).await?;
    a.audit(&ctx, "addons.upload", Some(&id), true, Some(name.clone()));
    Ok(Json(name))
}

pub async fn updates(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<Json<Vec<AddonUpdate>>> {
    a.server(Perm::ServersRead, &id)?;
    let s = ctx.core.servers.get(&id)?;
    Ok(Json(plugins::updates(&ctx.core, &s).await?))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct UpdateReq {
    files: Option<Vec<String>>,
}

pub async fn apply_updates(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, body: Option<Json<UpdateReq>>) -> ApiResult<Json<usize>> {
    a.server(Perm::ServersManage, &id)?;
    let s = ctx.core.servers.get(&id)?;
    let n = plugins::apply_updates(&ctx.core, &s, body.and_then(|b| b.0.files)).await?;
    a.audit(&ctx, "addons.update", Some(&id), true, Some(n.to_string()));
    Ok(Json(n))
}

#[derive(Deserialize)]
pub struct EnabledReq {
    enabled: bool,
}

pub async fn set_enabled(State(ctx): State<Ctx>, a: Authed, Path((id, file)): Path<(String, String)>, Json(r): Json<EnabledReq>) -> ApiResult<Json<String>> {
    a.server(Perm::ServersManage, &id)?;
    let s = ctx.core.servers.get(&id)?;
    let out = plugins::set_enabled(&ctx.core, &s, &file, r.enabled)?;
    a.audit(&ctx, "addons.enabled", Some(&id), true, Some(format!("{file}={}", r.enabled)));
    Ok(Json(out))
}

pub async fn remove(State(ctx): State<Ctx>, a: Authed, Path((id, file)): Path<(String, String)>) -> ApiResult<StatusCode> {
    a.server(Perm::ServersManage, &id)?;
    let s = ctx.core.servers.get(&id)?;
    plugins::remove(&ctx.core, &s, &file)?;
    a.audit(&ctx, "addons.remove", Some(&id), true, Some(file));
    Ok(StatusCode::NO_CONTENT)
}

pub async fn extras(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<Json<ExtrasInfo>> {
    a.server(Perm::ServersRead, &id)?;
    let s = ctx.core.servers.get(&id)?;
    Ok(Json(extras::info(&ctx.core, &s).await))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct ExtrasReq {
    voice: Option<bool>,
    bedrock: Option<bool>,
}

pub async fn set_extras(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Json(r): Json<ExtrasReq>) -> ApiResult<Json<ExtrasInfo>> {
    a.server(Perm::ServersManage, &id)?;
    let out = extras::set(&ctx.core, &id, r.voice, r.bedrock).await?;
    a.audit(&ctx, "server.extras", Some(&id), true, Some(format!("voice={:?} bedrock={:?}", r.voice, r.bedrock)));
    Ok(Json(out))
}
