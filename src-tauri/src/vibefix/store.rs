use super::manifest::{check_bytes, parse_manifest, safe_name, Manifest, ModelError, FILES};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const CURRENT: &str = "current.json";
const STATE: &str = "state.json";
const MANIFEST: &str = "manifest.json";
const SIGNATURE: &str = "manifest.json.sig";
const STAGING: &str = ".staging-";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct CheckState {
    pub checked_at: Option<i64>,
    pub failed_at: Option<i64>,
    pub remote_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Current {
    version: String,
}

pub struct Package {
    pub manifest: Manifest,
    pub config: Vec<u8>,
    pub tokenizer: Vec<u8>,
    pub weights: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct Store {
    pub dir: PathBuf,
}

impl Store {
    pub fn new(root: &Path) -> Store {
        Store { dir: root.join("vibefix") }
    }

    pub fn current(&self) -> Option<String> {
        let data = std::fs::read(self.dir.join(CURRENT)).ok()?;
        let c: Current = serde_json::from_slice(&data).ok()?;
        safe_name(&c.version).then_some(c.version)
    }

    pub fn version_dir(&self, version: &str) -> PathBuf {
        self.dir.join(version)
    }

    pub fn state(&self) -> CheckState {
        std::fs::read(self.dir.join(STATE)).ok().and_then(|d| serde_json::from_slice(&d).ok()).unwrap_or_default()
    }

    pub fn save_state(&self, s: &CheckState) {
        if let Err(e) = crate::util::write_json_atomic(&self.dir.join(STATE), s) {
            tracing::warn!("VibeFix: Prüfstatus nicht gespeichert: {e}");
        }
    }

    pub fn read_package(&self, key: &[u8]) -> Result<Package, ModelError> {
        let version = self.current().ok_or(ModelError::Missing)?;
        read_dir_package(&self.version_dir(&version), key)
    }

    pub fn staging(&self) -> Result<PathBuf, ModelError> {
        let dir = self.dir.join(format!("{STAGING}{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    pub fn write_manifest(&self, staging: &Path, body: &[u8], sig: &[u8]) -> Result<(), ModelError> {
        std::fs::write(staging.join(MANIFEST), body)?;
        std::fs::write(staging.join(SIGNATURE), sig)?;
        Ok(())
    }

    pub fn activate(&self, staging: &Path, manifest: &Manifest, key: &[u8]) -> Result<(), ModelError> {
        let checked = read_dir_package(staging, key)?;
        if checked.manifest != *manifest {
            return Err(ModelError::Mismatch(MANIFEST.into()));
        }
        let target = self.version_dir(&manifest.version);
        if target.exists() {
            let old = self.dir.join(format!("{STAGING}old-{}", uuid::Uuid::new_v4().simple()));
            std::fs::rename(&target, &old)?;
        }
        std::fs::rename(staging, &target)?;
        crate::util::write_json_atomic(&self.dir.join(CURRENT), &Current { version: manifest.version.clone() }).map_err(|e| ModelError::Io(e.to_string()))?;
        self.cleanup();
        Ok(())
    }

    pub fn cleanup(&self) {
        let keep = self.current();
        let Ok(rd) = std::fs::read_dir(&self.dir) else { return };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !e.path().is_dir() || keep.as_deref() == Some(name.as_str()) {
                continue;
            }
            if let Err(err) = std::fs::remove_dir_all(e.path()) {
                tracing::warn!("VibeFix: alter Ordner {name} nicht gelöscht: {err}");
            }
        }
    }

    pub fn reset(&self) {
        let _ = std::fs::remove_file(self.dir.join(CURRENT));
        self.save_state(&CheckState::default());
        self.cleanup();
    }

    pub fn discard(&self, staging: &Path) {
        if staging.starts_with(&self.dir) {
            let _ = std::fs::remove_dir_all(staging);
        }
    }
}

pub fn read_dir_package(dir: &Path, key: &[u8]) -> Result<Package, ModelError> {
    let body = std::fs::read(dir.join(MANIFEST)).map_err(|_| ModelError::Missing)?;
    let sig = std::fs::read(dir.join(SIGNATURE)).map_err(|_| ModelError::Signature)?;
    let manifest = parse_manifest(&body, &sig, key)?;
    let mut data: Vec<Vec<u8>> = Vec::with_capacity(FILES.len());
    for name in FILES {
        let file = manifest.file(name).ok_or_else(|| ModelError::Invalid(name.into()))?;
        let bytes = std::fs::read(dir.join(name)).map_err(|_| ModelError::Mismatch(name.into()))?;
        check_bytes(file, &bytes)?;
        data.push(bytes);
    }
    let weights = data.pop().unwrap_or_default();
    let tokenizer = data.pop().unwrap_or_default();
    let config = data.pop().unwrap_or_default();
    Ok(Package { manifest, config, tokenizer, weights })
}
