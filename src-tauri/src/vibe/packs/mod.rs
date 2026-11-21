//! Geteilte Modpacks: Instanz als `.vlpack` exportieren und hochladen (`POST /api/v1/packs`, multipart),
//! bzw. per Share-Code laden und wie eine `.vlpack`-Datei importieren.
//!
//! Die Overrides-ZIP (`overrides`-Feld) enthält den Inhalt von `overrides/` – also Pfade relativ zum
//! Spielordner (`config/…`, `mods/eigener-mod.jar`). Das Backend prüft die ZIP **nicht**; deshalb wird jede
//! heruntergeladene ZIP vor dem Import streng geprüft ([`check_overrides`]).
use super::{api_error, ensure, Feature};
use crate::content::import::{self, ImportOptions};
use crate::content::{export, ExportOptions, PackFormat};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

mod share;

pub use share::*;

/// Höchstens so viele Einträge / so viele Bytes (entpackt) in einer Overrides-ZIP.
const MAX_ENTRIES: usize = 100_000;
const MAX_UNPACKED: u64 = 8 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareOptions {
    /// public | unlisted | friends
    #[serde(default)]
    pub visibility: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub changelog: Option<String>,
    /// Vorhandenes Pack: neue Version hochladen statt neu anlegen
    #[serde(default)]
    pub code: Option<String>,
    /// Versionsnummer (Standard 1.0.0 bzw. Zeitstempel)
    #[serde(default)]
    pub version: Option<String>,
}

/// Merkt sich je Instanz den Share-Code (`instances/<id>/vibe-share.json`).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ShareLink {
    pub code: String,
    pub url: Option<String>,
}

fn link_file(state: &AppState, id: &str) -> PathBuf {
    state.paths.instance_dir(id).join("vibe-share.json")
}

pub fn share_link(state: &AppState, instance_id: &str) -> Option<ShareLink> {
    std::fs::read(link_file(state, instance_id)).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

pub fn valid_code(code: &str) -> bool {
    (4..=16).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_alphanumeric())
}

pub(super) fn tmp_path(state: &AppState, ext: &str) -> PathBuf {
    let dir = state.paths.tmp();
    let _ = std::fs::create_dir_all(&dir);
    dir.join(format!("vibe-{}.{ext}", uuid::Uuid::new_v4().simple()))
}

pub(super) struct TmpFiles(pub(super) Vec<PathBuf>);
impl Drop for TmpFiles {
    fn drop(&mut self) {
        for p in &self.0 {
            let _ = std::fs::remove_file(p);
        }
    }
}

// ------------------------------------------------------------------ Importieren

/// Geteiltes Pack per Code als neue Instanz importieren (Task). `token` optional (öffentliche Packs).
pub async fn install(state: AppState, task: TaskHandle, code: String, version_id: Option<String>, token: Option<String>) -> AppResult<()> {
    install_from(state, task, super::pack_fetch::PackOrigin::Code { code, version_id }, token).await
}

/// Pack (per Code oder Spiel-Link) als neue Instanz importieren.
pub async fn install_from(state: AppState, task: TaskHandle, origin: super::pack_fetch::PackOrigin, token: Option<String>) -> AppResult<()> {
    let f = super::pack_fetch::fetch(&state, Some(&task), &origin, token).await?;
    task.set_title(format!("{} importieren", f.name));
    task.check()?;
    let sub = task.sub(0.1, 1.0);
    import::run_import(&state, &task, &f.vlpack, ImportOptions { name: Some(f.name.clone()), source: Some(f.source.clone()), ..Default::default() }, sub).await?;
    Ok(())
}

/// Ist ein ZIP-Eintragsname als relativer Pfad im Spielordner sicher?
pub fn safe_entry_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 512 || name.contains('\0') || name.contains('\\') {
        return false;
    }
    if name.starts_with('/') || name.contains(':') {
        return false;
    }
    let trimmed = name.trim_end_matches('/');
    if trimmed.is_empty() {
        return false;
    }
    trimmed.split('/').all(|c| {
        !c.is_empty()
            && c != "."
            && c != ".."
            // Windows: Punkte/Leerzeichen am Ende werden abgeschnitten ("..." -> "..")
            && !c.ends_with('.')
            && !c.ends_with(' ')
            && !is_reserved_windows_name(c)
    })
}

fn is_reserved_windows_name(c: &str) -> bool {
    let stem = c.split('.').next().unwrap_or("").to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit())
}

/// Overrides-ZIP vom Backend prüfen (Zip-Slip, Symlinks, Größe). Fehler = Import abbrechen.
pub fn check_overrides(path: &Path) -> AppResult<()> {
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(std::fs::File::open(path)?)).map_err(|_| AppError::Invalid("Die Overrides des Packs sind keine gültige ZIP-Datei".into()))?;
    if zip.len() > MAX_ENTRIES {
        return Err(AppError::Invalid("Die Overrides des Packs enthalten zu viele Dateien".into()));
    }
    let mut total = 0u64;
    for i in 0..zip.len() {
        let f = zip.by_index_raw(i)?;
        let name = f.name().to_string();
        if !safe_entry_name(&name) || f.enclosed_name().is_none() {
            return Err(AppError::Invalid(format!("Das Pack enthält einen unsicheren Pfad und wurde nicht importiert: {name}")));
        }
        if f.is_symlink() {
            return Err(AppError::Invalid(format!("Das Pack enthält eine symbolische Verknüpfung und wurde nicht importiert: {name}")));
        }
        total = total.saturating_add(f.size());
        if total > MAX_UNPACKED {
            return Err(AppError::Invalid("Die Overrides des Packs sind zu groß".into()));
        }
    }
    Ok(())
}

/// `.vlpack` aus Manifest, geprüfter Overrides-ZIP und Icon zusammensetzen.
pub(super) fn build_vlpack(dest: &Path, manifest: &str, overrides: Option<&Path>, icon: Option<&[u8]>) -> AppResult<()> {
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut out = zip::ZipWriter::new(std::io::BufWriter::new(std::fs::File::create(dest)?));
    out.start_file("vlpack.json", opts)?;
    out.write_all(manifest.as_bytes())?;
    if let Some(b) = icon {
        out.start_file("icon.png", opts)?;
        out.write_all(b)?;
    }
    if let Some(p) = overrides {
        let mut zip = zip::ZipArchive::new(std::io::BufReader::new(std::fs::File::open(p)?))?;
        // Alte Uploads mit "overrides/"-Präfix tolerieren
        let prefixed = (0..zip.len()).all(|i| zip.name_for_index(i).is_some_and(|n| n.starts_with("overrides/")));
        for i in 0..zip.len() {
            let f = zip.by_index_raw(i)?;
            let name = f.name().to_string();
            let rel = if prefixed { name.trim_start_matches("overrides/").to_string() } else { name };
            if rel.is_empty() {
                continue;
            }
            out.raw_copy_file_rename(f, format!("overrides/{rel}"))?;
        }
    }
    out.finish()?;
    Ok(())
}

#[cfg(test)]
mod tests;
