use super::auth::Authed;
use super::body::{self, MIB};
use super::error::{ApiError, ApiResult};
use crate::roles::Perm;
use crate::state::Ctx;
use axum::body::Body;
use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use vibe_server_core::model::{Loader, LoaderKind};
use vibe_server_core::server::modpack::{self, ImportOptions, PackFormat};

pub const LIMIT: u64 = 2048 * MIB;

#[derive(Deserialize)]
pub struct ImportQuery {
    format: PackFormat,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    server: Option<String>,
    #[serde(default)]
    mc_version: Option<String>,
    #[serde(default)]
    loader: Option<String>,
    #[serde(default)]
    loader_version: Option<String>,
    #[serde(default)]
    memory_mb: Option<u32>,
}

pub async fn import(State(ctx): State<Ctx>, a: Authed, Query(q): Query<ImportQuery>, data: Body) -> ApiResult<Json<Value>> {
    match &q.server {
        Some(id) => {
            a.server(Perm::ServersManage, id)?;
            ctx.core.servers.get(id)?;
            super::servers::ensure_stopped(&ctx, id)?;
        }
        None => {
            a.require(Perm::ServersManage)?;
            if !a.user.can_access("*") {
                return Err(ApiError::forbidden("servers.manage (*)"));
            }
        }
    }
    let loader = match q.loader.as_deref() {
        Some(l) => Some(Loader { kind: LoaderKind::parse(l).ok_or_else(|| ApiError::invalid(format!("Unbekannter Loader: {l}")))?, version: q.loader_version.clone() }),
        None => None,
    };
    let tmp = ctx.core.paths.tmp().join(format!("upload-{}.pack", uuid::Uuid::new_v4().simple()));
    body::to_file(data, &tmp, LIMIT).await?;
    let opts = ImportOptions { name: q.name.clone(), mc_version: q.mc_version.clone(), loader, memory_mb: q.memory_mb, server: q.server.clone() };
    let core = ctx.core.clone();
    let t2 = tmp.clone();
    let res = tokio::task::spawn_blocking(move || modpack::spawn_import(&core, t2, q.format, opts)).await.map_err(vibe_server_core::error::AppError::from)?;
    let (server, task_id) = match res {
        Ok(v) => v,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.into());
        }
    };
    a.audit(&ctx, "server.import", Some(&server.id), true, Some(format!("{:?}", q.format)));
    Ok(Json(json!({ "server": server, "task_id": task_id })))
}
