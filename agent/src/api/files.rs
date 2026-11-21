use super::auth::Authed;
use super::body::{self, MIB};
use super::error::{ApiError, ApiResult};
use crate::fsguard;
use crate::roles::Perm;
use crate::state::Ctx;
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use vibe_server_core::server::server_dir;

pub const UPLOAD_LIMIT: u64 = 512 * MIB;

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct PathQuery {
    path: String,
}

#[derive(Serialize)]
pub struct Entry {
    name: String,
    dir: bool,
    size: u64,
    modified: i64,
}

#[derive(Serialize)]
pub struct Listing {
    path: String,
    entries: Vec<Entry>,
}

fn base(ctx: &Ctx, id: &str) -> ApiResult<std::path::PathBuf> {
    ctx.core.servers.get(id)?;
    let b = server_dir(&ctx.core.paths, id);
    std::fs::create_dir_all(&b)?;
    Ok(b)
}

fn mtime(m: &std::fs::Metadata) -> i64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub async fn list(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Query(q): Query<PathQuery>) -> ApiResult<Json<Listing>> {
    a.server(Perm::FilesRead, &id)?;
    let dir = fsguard::resolve(&base(&ctx, &id)?, &q.path)?;
    if !dir.is_dir() {
        return Err(ApiError::not_found(q.path));
    }
    let mut entries: Vec<Entry> = std::fs::read_dir(&dir)?
        .flatten()
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            Some(Entry { name: e.file_name().to_string_lossy().to_string(), dir: m.is_dir(), size: if m.is_file() { m.len() } else { 0 }, modified: mtime(&m) })
        })
        .collect();
    entries.sort_by(|x, y| y.dir.cmp(&x.dir).then_with(|| x.name.to_lowercase().cmp(&y.name.to_lowercase())));
    Ok(Json(Listing { path: fsguard::clean_rel(&q.path)?.join("/"), entries }))
}

pub async fn read(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Query(q): Query<PathQuery>) -> ApiResult<axum::response::Response> {
    a.server(Perm::FilesRead, &id)?;
    let p = fsguard::resolve(&base(&ctx, &id)?, &q.path)?;
    if !p.is_file() {
        return Err(ApiError::not_found(q.path));
    }
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "datei".into());
    body::file_response(&p, &name).await
}

pub async fn write(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Query(q): Query<PathQuery>, data: Body) -> ApiResult<StatusCode> {
    a.server(Perm::FilesWrite, &id)?;
    let p = fsguard::resolve_writable(&base(&ctx, &id)?, &q.path)?;
    if p.is_dir() {
        return Err(ApiError::invalid("Ziel ist ein Ordner."));
    }
    if p.file_name().is_some_and(|n| n == "server.properties") && ctx.core.server_mgr.is_active(&id) {
        return Err(ApiError::server_running());
    }
    let n = body::to_file(data, &p, UPLOAD_LIMIT).await?;
    a.audit(&ctx, "files.write", Some(&id), true, Some(format!("{} ({n} B)", q.path)));
    Ok(StatusCode::NO_CONTENT)
}

pub async fn mkdir(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Json(q): Json<PathQuery>) -> ApiResult<StatusCode> {
    a.server(Perm::FilesWrite, &id)?;
    let p = fsguard::resolve_writable(&base(&ctx, &id)?, &q.path)?;
    std::fs::create_dir_all(&p)?;
    a.audit(&ctx, "files.mkdir", Some(&id), true, Some(q.path));
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct RenameReq {
    from: String,
    to: String,
}

pub async fn rename(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Json(r): Json<RenameReq>) -> ApiResult<StatusCode> {
    a.server(Perm::FilesWrite, &id)?;
    let b = base(&ctx, &id)?;
    let from = fsguard::resolve_writable(&b, &r.from)?;
    let to = fsguard::resolve_writable(&b, &r.to)?;
    if !from.exists() {
        return Err(ApiError::not_found(r.from));
    }
    if to.exists() {
        return Err(ApiError::new(StatusCode::CONFLICT, "conflict", "Das Ziel existiert schon."));
    }
    if let Some(p) = to.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::rename(&from, &to)?;
    a.audit(&ctx, "files.rename", Some(&id), true, Some(format!("{} -> {}", r.from, r.to)));
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Query(q): Query<PathQuery>) -> ApiResult<StatusCode> {
    a.server(Perm::FilesWrite, &id)?;
    let p = fsguard::resolve_writable(&base(&ctx, &id)?, &q.path)?;
    let meta = std::fs::symlink_metadata(&p).map_err(|_| ApiError::not_found(q.path.clone()))?;
    if meta.is_dir() {
        std::fs::remove_dir_all(&p)?;
    } else {
        std::fs::remove_file(&p)?;
    }
    a.audit(&ctx, "files.delete", Some(&id), true, Some(q.path));
    Ok(StatusCode::NO_CONTENT)
}
