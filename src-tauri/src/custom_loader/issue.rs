use crate::error::AppError;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PackIssue {
    pub code: &'static str,
    pub message: String,
    pub params: BTreeMap<String, String>,
}

impl PackIssue {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        PackIssue { code, message: message.into(), params: BTreeMap::new() }
    }

    pub fn with(mut self, key: &str, value: impl ToString) -> Self {
        self.params.insert(key.to_string(), value.to_string());
        self
    }
}

impl std::fmt::Display for PackIssue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl From<PackIssue> for AppError {
    fn from(i: PackIssue) -> Self {
        AppError::Msg(i.message)
    }
}

impl From<std::io::Error> for PackIssue {
    fn from(e: std::io::Error) -> Self {
        PackIssue::new("io", format!("Das Pack konnte nicht gelesen werden: {e}")).with("detail", e)
    }
}

impl From<zip::result::ZipError> for PackIssue {
    fn from(e: zip::result::ZipError) -> Self {
        PackIssue::new("not_zip", format!("Die Datei ist kein gültiges ZIP-Archiv: {e}")).with("detail", e)
    }
}

pub type PackResult<T> = Result<T, PackIssue>;
