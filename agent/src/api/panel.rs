use axum::body::Body;
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};

include!(concat!(env!("OUT_DIR"), "/panel_files.rs"));

fn find(path: &str) -> Option<&'static [u8]> {
    PANEL_FILES.iter().find(|(p, _)| *p == path).map(|(_, b)| *b)
}

fn respond(path: &str, bytes: &'static [u8]) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let cache = if path == "index.html" { "no-cache" } else { "public, max-age=3600" };
    Response::builder()
        .header("content-type", mime.as_ref())
        .header("cache-control", cache)
        .header("x-content-type-options", "nosniff")
        .header("x-frame-options", "DENY")
        .header("referrer-policy", "no-referrer")
        .header(
            "content-security-policy",
            "default-src 'self'; connect-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'",
        )
        .body(Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

pub async fn serve(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if path.starts_with("api/") {
        return super::error::ApiError::not_found("API-Endpunkt").into_response();
    }
    let path = if path.is_empty() { "index.html" } else { path };
    if path.split('/').any(|p| p == "..") {
        return StatusCode::BAD_REQUEST.into_response();
    }
    if let Some(b) = find(path) {
        return respond(path, b);
    }
    match find("index.html") {
        Some(b) if !path.contains('.') => respond("index.html", b),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}
