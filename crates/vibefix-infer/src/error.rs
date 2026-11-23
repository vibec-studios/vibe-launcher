use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{path}: {source}")]
    Io { path: PathBuf, source: std::io::Error },
    #[error("ungültiges JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{what} hat Version {found}, diese vibefix-infer-Version unterstützt nur {supported}; bitte vibefix-infer aktualisieren")]
    Version { what: &'static str, found: u32, supported: &'static str },
    #[error("ungültiges VibeFix-Paket: {0}")]
    Package(String),
    #[error("Prüfsumme von {0} stimmt nicht mit config.json überein")]
    Checksum(&'static str),
    #[error("Tensor {name}: {problem}")]
    Tensor { name: String, problem: String },
}

impl Error {
    pub fn io(path: &Path, source: std::io::Error) -> Self {
        Error::Io { path: path.to_path_buf(), source }
    }

    pub fn tensor(name: &str, problem: impl Into<String>) -> Self {
        Error::Tensor { name: name.to_owned(), problem: problem.into() }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
