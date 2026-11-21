use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use vibe_server_core::error::AppError;

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
    pub kind: &'static str,
    pub retry_after: Option<u64>,
}

pub type ApiResult<T> = Result<T, ApiError>;

impl ApiError {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        let kind = match code {
            "not_found" => "not_found",
            "unauthorized" | "pairing_failed" | "forbidden" | "path_denied" => "access",
            "upstream" => "network",
            "not_configured" => "not_configured",
            "internal" => "error",
            _ => "invalid",
        };
        ApiError { status, code, message: message.into(), kind, retry_after: None }
    }
    pub fn unauthorized() -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "unauthorized", "Nicht angemeldet oder Token ungültig.")
    }
    pub fn forbidden(perm: &str) -> Self {
        Self::new(StatusCode::FORBIDDEN, "forbidden", format!("Dafür fehlt das Recht „{perm}“."))
    }
    pub fn not_found(what: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", format!("Nicht gefunden: {}", what.into()))
    }
    pub fn invalid(msg: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "invalid", msg)
    }
    pub fn path_denied() -> Self {
        Self::new(StatusCode::FORBIDDEN, "path_denied", "Dieser Pfad liegt außerhalb des Server-Ordners oder ist geschützt.")
    }
    pub fn server_running() -> Self {
        Self::new(StatusCode::CONFLICT, "server_running", "Bitte den Server zuerst stoppen.")
    }
    pub fn too_large(limit_mb: u64) -> Self {
        Self::new(StatusCode::PAYLOAD_TOO_LARGE, "too_large", format!("Die Datei ist zu groß (höchstens {limit_mb} MiB)."))
    }
    pub fn rate_limited(secs: u64) -> Self {
        let mut e = Self::new(StatusCode::TOO_MANY_REQUESTS, "rate_limited", format!("Zu viele Anfragen – bitte {secs} s warten."));
        e.retry_after = Some(secs);
        e
    }
}

impl From<AppError> for ApiError {
    fn from(e: AppError) -> Self {
        let msg = e.to_string();
        let (status, code) = match &e {
            AppError::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
            AppError::Invalid(m) if m.contains("zuerst stoppen") || m.contains("vor dem Wiederherstellen stoppen") || m.contains("Server läuft") => {
                (StatusCode::CONFLICT, "server_running")
            }
            AppError::Invalid(m) if m.contains("Port") && m.contains("verwendet") => (StatusCode::CONFLICT, "conflict"),
            AppError::Invalid(_) => (StatusCode::BAD_REQUEST, "invalid"),
            AppError::Cancelled => (StatusCode::CONFLICT, "conflict"),
            AppError::NotConfigured(_) => (StatusCode::FAILED_DEPENDENCY, "not_configured"),
            AppError::Auth(_) => (StatusCode::UNAUTHORIZED, "unauthorized"),
            AppError::Access(_) => (StatusCode::FORBIDDEN, "forbidden"),
            AppError::Unreachable(_) | AppError::Http(_) => (StatusCode::BAD_GATEWAY, "upstream"),
            _ => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        };
        ApiError { status, code, message: msg, kind: e.kind(), retry_after: None }
    }
}

impl From<std::io::Error> for ApiError {
    fn from(e: std::io::Error) -> Self {
        AppError::from(e).into()
    }
}

impl From<crate::fsguard::PathError> for ApiError {
    fn from(_: crate::fsguard::PathError) -> Self {
        ApiError::path_denied()
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = json!({ "error": { "code": self.code, "message": self.message, "kind": self.kind } });
        let mut r = (self.status, Json(body)).into_response();
        if let Some(s) = self.retry_after {
            if let Ok(v) = HeaderValue::from_str(&s.to_string()) {
                r.headers_mut().insert("retry-after", v);
            }
        }
        r
    }
}

pub fn error_json(e: &ApiError) -> serde_json::Value {
    json!({ "code": e.code, "message": e.message, "kind": e.kind })
}
