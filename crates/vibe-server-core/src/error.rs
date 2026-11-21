//! Gemeinsamer Fehlertyp. Wird ans Frontend als `{ kind, message }` serialisiert.
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Msg(String),
    #[error("Nicht gefunden: {0}")]
    NotFound(String),
    #[error("Ungültige Eingabe: {0}")]
    Invalid(String),
    #[error("Abgebrochen")]
    Cancelled,
    #[error("Nicht konfiguriert: {0}")]
    NotConfigured(String),
    #[error("Authentifizierung fehlgeschlagen: {0}")]
    Auth(String),
    #[error("{0}")]
    Unreachable(String),
    #[error("{0}")]
    OfflineAvailable(String),
    #[error("{0}")]
    Access(String),
    #[error("Netzwerkfehler: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Dateifehler: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON-Fehler: {0}")]
    Json(#[from] serde_json::Error),
    #[error("ZIP-Fehler: {0}")]
    Zip(#[from] zip::result::ZipError),
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Msg(s.into())
    }
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::Msg(_) => "error",
            AppError::NotFound(_) => "not_found",
            AppError::Invalid(_) => "invalid",
            AppError::Cancelled => "cancelled",
            AppError::NotConfigured(_) => "not_configured",
            AppError::Auth(_) => "auth",
            AppError::Unreachable(_) => "network",
            AppError::OfflineAvailable(_) => "offline_available",
            AppError::Access(_) => "access",
            AppError::Http(_) => "network",
            AppError::Io(_) => "io",
            AppError::Json(_) => "json",
            AppError::Zip(_) => "zip",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}


impl From<tokio::task::JoinError> for AppError {
    fn from(e: tokio::task::JoinError) -> Self {
        AppError::Msg(format!("Hintergrundaufgabe fehlgeschlagen: {e}"))
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// Kontext an Fehler hängen: `.ctx("Version laden")?`
pub trait Ctx<T> {
    fn ctx(self, what: &str) -> AppResult<T>;
}
impl<T, E: std::fmt::Display> Ctx<T> for Result<T, E> {
    fn ctx(self, what: &str) -> AppResult<T> {
        self.map_err(|e| AppError::Msg(format!("{what}: {e}")))
    }
}
impl<T> Ctx<T> for Option<T> {
    fn ctx(self, what: &str) -> AppResult<T> {
        self.ok_or_else(|| AppError::Msg(what.to_string()))
    }
}
