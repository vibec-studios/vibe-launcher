use super::error::{ApiError, ApiResult};
use axum::body::Body;
use futures::StreamExt;
use std::path::Path;
use tokio::io::AsyncWriteExt;

pub const MIB: u64 = 1024 * 1024;

pub async fn to_file(body: Body, dest: &Path, limit: u64) -> ApiResult<u64> {
    if let Some(p) = dest.parent() {
        tokio::fs::create_dir_all(p).await?;
    }
    let tmp = dest.with_extension(format!("{}.part", dest.extension().and_then(|e| e.to_str()).unwrap_or("upload")));
    let mut f = tokio::fs::File::create(&tmp).await?;
    let mut stream = body.into_data_stream();
    let mut total = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                drop(f);
                let _ = tokio::fs::remove_file(&tmp).await;
                return Err(ApiError::invalid(format!("Upload abgebrochen: {e}")));
            }
        };
        total += chunk.len() as u64;
        if total > limit {
            drop(f);
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(ApiError::too_large(limit / MIB));
        }
        f.write_all(&chunk).await?;
    }
    f.flush().await?;
    drop(f);
    tokio::fs::rename(&tmp, dest).await?;
    Ok(total)
}

pub async fn file_response(path: &Path, download_name: &str) -> ApiResult<axum::response::Response> {
    let f = tokio::fs::File::open(path).await.map_err(|_| ApiError::not_found(download_name.to_string()))?;
    let len = f.metadata().await.map(|m| m.len()).unwrap_or(0);
    let stream = tokio_util::io::ReaderStream::new(f);
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let disp = format!("attachment; filename=\"{}\"", download_name.replace(['"', '\\', '\r', '\n'], "_"));
    Ok(axum::response::Response::builder()
        .header("content-type", mime.as_ref())
        .header("content-length", len)
        .header("content-disposition", disp)
        .body(Body::from_stream(stream))
        .map_err(|e| ApiError::from(vibe_server_core::error::AppError::msg(e.to_string())))?)
}
