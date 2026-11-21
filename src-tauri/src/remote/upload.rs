use super::http::{self, base_url, check_path, send_error};
use super::tls::{self, Pinned};
use super::{store, vibe, RemoteAgent, Via};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::state::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::io::AsyncReadExt;

pub const EV_UPLOAD: &str = "remote://upload";
const INLINE_MAX: u64 = 8 * 1024 * 1024;
const READ_BUF: usize = 256 * 1024;
const LONG_TIMEOUT_S: u64 = 60 * 60;

#[derive(Clone, Serialize)]
struct ProgressEv {
    id: String,
    sent: u64,
    total: u64,
}

pub struct Progress {
    app: AppHandle,
    id: Option<String>,
    total: u64,
}

impl Progress {
    pub fn new(app: AppHandle, id: Option<String>, total: u64) -> Self {
        Progress { app, id, total }
    }

    fn emit(&self, sent: u64) {
        if let Some(id) = &self.id {
            events::emit(&self.app, EV_UPLOAD, &ProgressEv { id: id.clone(), sent, total: self.total });
        }
    }
}

fn file_stream(file: tokio::fs::File, progress: Arc<Progress>) -> reqwest::Body {
    let s = futures::stream::unfold((file, 0u64, progress), |(mut f, sent, p)| async move {
        let mut buf = vec![0u8; READ_BUF];
        match f.read(&mut buf).await {
            Ok(0) => None,
            Ok(n) => {
                buf.truncate(n);
                let sent = sent + n as u64;
                p.emit(sent);
                Some((Ok::<_, std::io::Error>(buf), (f, sent, p)))
            }
            Err(e) => Some((Err(e), (f, sent, p))),
        }
    });
    reqwest::Body::wrap_stream(s)
}

fn split_query(path: &str) -> (&str, &str) {
    match path.split_once('?') {
        Some((p, q)) => (p, q),
        None => (path, ""),
    }
}

async fn direct(state: &AppState, agent: &RemoteAgent, m: reqwest::Method, path: &str, file: &Path, content_type: &str, progress: Arc<Progress>) -> AppResult<Value> {
    let address = agent.address.clone().ok_or_else(|| AppError::Invalid("Adresse fehlt".into()))?;
    let base = base_url(&address)?;
    let token = store::load_token(&state.paths, &agent.key)?;
    let pin = Pinned::new(agent.fingerprint.as_deref());
    let client = tls::client(Arc::clone(&pin), LONG_TIMEOUT_S);
    let f = tokio::fs::File::open(file).await?;
    let res = client
        .request(m, format!("{base}/api/v1{path}"))
        .bearer_auth(token)
        .header("X-Vibe-Api", "1")
        .header(reqwest::header::CONTENT_TYPE, content_type)
        .header(reqwest::header::CONTENT_LENGTH, progress.total)
        .body(file_stream(f, Arc::clone(&progress)))
        .send()
        .await
        .map_err(|e| send_error(e, Some(&pin), &address))?;
    http::read(res).await
}

async fn via_vibe(state: &AppState, agent: &RemoteAgent, m: reqwest::Method, path: &str, file: &Path, content_type: &str, progress: Arc<Progress>) -> AppResult<Value> {
    let total = progress.total;
    if total <= INLINE_MAX {
        let bytes = tokio::fs::read(file).await?;
        let res = vibe::builder_with(state, m, &vibe::proxy_path(&agent.id, path), 300)?
            .header(reqwest::header::CONTENT_TYPE, content_type)
            .body(bytes)
            .send()
            .await
            .map_err(|e| send_error(e, None, "Vibe"))?;
        progress.emit(total);
        return http::read(res).await;
    }
    let (p, q) = split_query(path);
    let start = vibe::call(
        state,
        reqwest::Method::POST,
        &format!("/api/v1/agents/{}/uploads", agent.id),
        Some(json!({ "method": m.as_str(), "path": p.trim_start_matches('/'), "query": q, "contentType": content_type, "size": total })),
    )
    .await?;
    let uid = start["uploadId"].as_str().ok_or_else(|| AppError::Msg("Vibe hat keine Upload-ID geliefert.".into()))?.to_string();
    let chunk = start["chunkSize"].as_u64().filter(|c| *c > 0).unwrap_or(INLINE_MAX) as usize;
    let base = format!("/api/v1/agents/{}/uploads/{uid}", agent.id);
    let r = send_chunks(state, &base, file, chunk, &progress).await;
    if let Err(e) = r {
        let _ = vibe::call(state, reqwest::Method::DELETE, &base, None).await;
        return Err(e);
    }
    let res = vibe::builder_with(state, reqwest::Method::POST, &format!("{base}/complete"), 330)?
        .send()
        .await
        .map_err(|e| send_error(e, None, "Vibe"))?;
    http::read(res).await
}

async fn send_chunks(state: &AppState, base: &str, file: &Path, chunk: usize, progress: &Progress) -> AppResult<()> {
    let mut f = tokio::fs::File::open(file).await?;
    let mut offset = 0u64;
    loop {
        let mut buf = vec![0u8; chunk];
        let mut n = 0;
        while n < chunk {
            let r = f.read(&mut buf[n..]).await?;
            if r == 0 {
                break;
            }
            n += r;
        }
        if n == 0 {
            return Ok(());
        }
        buf.truncate(n);
        let res = vibe::builder_with(state, reqwest::Method::PUT, &format!("{base}?offset={offset}"), 300)?
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .body(buf)
            .send()
            .await
            .map_err(|e| send_error(e, None, "Vibe"))?;
        http::read(res).await?;
        offset += n as u64;
        progress.emit(offset);
        if n < chunk {
            return Ok(());
        }
    }
}

pub async fn upload(state: &AppState, agent: &RemoteAgent, method: &str, path: &str, file: &Path, content_type: &str, progress: Progress) -> AppResult<Value> {
    check_path(path)?;
    let m = http::method(method)?;
    if !matches!(m, reqwest::Method::POST | reqwest::Method::PUT) {
        return Err(AppError::Invalid("Hochladen geht nur mit POST oder PUT.".into()));
    }
    let meta = tokio::fs::metadata(file).await.map_err(|_| AppError::NotFound("Die Datei wurde nicht gefunden.".into()))?;
    if !meta.is_file() {
        return Err(AppError::Invalid("Das ist keine Datei.".into()));
    }
    let progress = Arc::new(Progress { total: meta.len(), ..progress });
    match agent.via {
        Via::Direct => direct(state, agent, m, path, file, content_type, progress).await,
        Via::Vibe => via_vibe(state, agent, m, path, file, content_type, progress).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_query() {
        assert_eq!(split_query("/servers/import?format=mrpack&name=A"), ("/servers/import", "format=mrpack&name=A"));
        assert_eq!(split_query("/servers/x/addons/upload"), ("/servers/x/addons/upload", ""));
    }
}
