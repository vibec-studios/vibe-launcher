//! Cosmetics: `.vibey`-Assets (per SHA-256, unveränderlich) und Vorschaubilder mit Platten-Cache, eigene
//! Bundles lesen und Einreichungen hochladen (`POST /api/v1/cosmetics/submissions`, multipart).
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::vibe::{self, Feature};
use base64::Engine;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Maximalgröße einer `.vibey`-Datei (wie Backend und Client, SPEC §5).
pub const MAX_BUNDLE_BYTES: u64 = 2 * 1024 * 1024;
/// Vorschaubilder höchstens 1 MiB
const MAX_THUMB_BYTES: usize = 1024 * 1024;
const THUMB_TTL: Duration = Duration::from_secs(6 * 3600);

fn assets_dir(state: &AppState) -> PathBuf {
    super::data_dir(state).join("assets")
}
fn thumbs_dir(state: &AppState) -> PathBuf {
    super::data_dir(state).join("thumbs")
}

/// `.vibey`-Bundle per SHA-256: aus dem Cache oder vom Backend (Prüfsumme wird geprüft). Liefert den JSON-Text.
pub async fn asset(state: &AppState, hash: &str) -> AppResult<String> {
    if !super::valid_sha256(hash) {
        return Err(AppError::Invalid("Ungültige Asset-Prüfsumme".into()));
    }
    let path = assets_dir(state).join(format!("{hash}.vibey"));
    if let Ok(b) = tokio::fs::read(&path).await {
        if super::sha256_bytes(&b) == hash {
            let _ = filetime_touch(&path);
            return String::from_utf8(b).map_err(|_| AppError::msg("Asset ist kein UTF-8"));
        }
        let _ = tokio::fs::remove_file(&path).await;
    }
    let base = vibe::ensure(state, Feature::Any)?;
    let url = format!("{base}/api/v1/cosmetics/assets/{hash}");
    let r = state.net.client.get(&url).timeout(Duration::from_secs(60)).send().await?;
    let status = r.status().as_u16();
    if !(200..300).contains(&status) {
        let body = r.text().await.unwrap_or_default();
        return Err(vibe::api_error(status, &body));
    }
    let bytes = r.bytes().await?;
    if bytes.len() as u64 > MAX_BUNDLE_BYTES * 2 {
        return Err(AppError::msg("Asset zu groß"));
    }
    if super::sha256_bytes(&bytes) != hash {
        return Err(AppError::msg("Prüfsumme des Assets stimmt nicht"));
    }
    tokio::fs::create_dir_all(assets_dir(state)).await?;
    let tmp = path.with_extension("part");
    tokio::fs::write(&tmp, &bytes).await?;
    let _ = tokio::fs::rename(&tmp, &path).await;
    prune_assets(state);
    String::from_utf8(bytes.to_vec()).map_err(|_| AppError::msg("Asset ist kein UTF-8"))
}

fn filetime_touch(path: &Path) -> std::io::Result<()> {
    let f = std::fs::OpenOptions::new().append(true).open(path)?;
    f.set_modified(SystemTime::now())
}

/// Cache klein halten: höchstens 400 Assets, älteste (zuletzt benutzt) zuerst weg.
fn prune_assets(state: &AppState) {
    let dir = assets_dir(state);
    let Ok(rd) = std::fs::read_dir(&dir) else { return };
    let mut files: Vec<(SystemTime, PathBuf)> = rd
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "vibey"))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    if files.len() <= 400 {
        return;
    }
    files.sort_by_key(|(t, _)| *t);
    let n = files.len() - 400;
    for (_, p) in files.into_iter().take(n) {
        let _ = std::fs::remove_file(p);
    }
}

/// Vorschaubild (relativ zur Backend-Adresse oder absolut unter ihr) als `data:`-URL. `None` = keins vorhanden.
/// `token`: für Bilder, die nur der Einreicher sehen darf (eigene Einreichungen).
pub async fn thumbnail(state: &AppState, url: &str, token: Option<&str>) -> AppResult<Option<String>> {
    let base = vibe::ensure(state, Feature::Any)?;
    let abs = super::resolve_url(&base, url)?;
    let key = super::sha256_bytes(abs.as_bytes());
    let path = thumbs_dir(state).join(format!("{key}.png"));
    let fresh = std::fs::metadata(&path).ok().and_then(|m| m.modified().ok()).is_some_and(|t| t.elapsed().unwrap_or_default() < THUMB_TTL);
    if fresh {
        if let Ok(b) = tokio::fs::read(&path).await {
            return Ok(Some(png_data_url(&b)));
        }
    }
    let mut rb = state.net.client.get(&abs).timeout(Duration::from_secs(30));
    if let Some(t) = token.filter(|t| !t.is_empty()) {
        rb = rb.bearer_auth(t);
    }
    let r = rb.send().await;
    let r = match r {
        Ok(r) => r,
        // offline: alter Cache ist besser als nichts
        Err(e) => {
            return match tokio::fs::read(&path).await {
                Ok(b) => Ok(Some(png_data_url(&b))),
                Err(_) => Err(e.into()),
            }
        }
    };
    let status = r.status().as_u16();
    if status == 404 {
        return Ok(None);
    }
    if !(200..300).contains(&status) {
        let body = r.text().await.unwrap_or_default();
        return Err(vibe::api_error(status, &body));
    }
    let bytes = r.bytes().await?;
    if bytes.len() > MAX_THUMB_BYTES || crate::vibey_client::cosmetics::png_size(&bytes).is_none() {
        return Ok(None);
    }
    tokio::fs::create_dir_all(thumbs_dir(state)).await?;
    let _ = tokio::fs::write(&path, &bytes).await;
    Ok(Some(png_data_url(&bytes)))
}

fn png_data_url(b: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b))
}

/// Breite/Höhe aus dem IHDR einer PNG-Datei (None = kein PNG).
pub fn png_size(b: &[u8]) -> Option<(u32, u32)> {
    const MAGIC: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if b.len() < 24 || b[..8] != MAGIC || &b[12..16] != b"IHDR" {
        return None;
    }
    let u = |o: usize| u32::from_be_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]);
    Some((u(16), u(20)))
}

/// Eigene `.vibey`-Datei lesen (für Vorschau und Prüfung vor dem Hochladen).
pub async fn read_bundle(path: &Path) -> AppResult<String> {
    let meta = tokio::fs::metadata(path).await.map_err(|_| AppError::NotFound(path.display().to_string()))?;
    if !meta.is_file() {
        return Err(AppError::Invalid("Keine Datei".into()));
    }
    if meta.len() > MAX_BUNDLE_BYTES {
        return Err(AppError::Invalid(format!("Datei größer als {} KiB", MAX_BUNDLE_BYTES / 1024)));
    }
    let b = tokio::fs::read(path).await?;
    String::from_utf8(b).map_err(|_| AppError::Invalid("Datei ist kein gültiges UTF-8".into()))
}

/// Eigenes Vorschaubild lesen: PNG (≤ 1 MiB) als data:-URL plus Größe.
pub async fn read_png(path: &Path) -> AppResult<(String, u32, u32)> {
    let meta = tokio::fs::metadata(path).await.map_err(|_| AppError::NotFound(path.display().to_string()))?;
    if meta.len() as usize > MAX_THUMB_BYTES {
        return Err(AppError::Invalid("Bild zu groß (max. 1 MiB)".into()));
    }
    let b = tokio::fs::read(path).await?;
    let (w, h) = png_size(&b).ok_or_else(|| AppError::Invalid("Keine PNG-Datei".into()))?;
    Ok((png_data_url(&b), w, h))
}

/// Einreichung hochladen. `thumbnail_png` = Base64 eines PNG (optional, z. B. aus der 3D-Vorschau).
pub async fn submit(state: &AppState, token: &str, bundle: &Path, name: &str, description: &str, thumbnail_png: Option<&str>) -> AppResult<serde_json::Value> {
    let base = vibe::ensure(state, Feature::Any)?;
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(AppError::Invalid("Name: 1 bis 80 Zeichen".into()));
    }
    let description = description.trim();
    if description.chars().count() > 500 {
        return Err(AppError::Invalid("Beschreibung: höchstens 500 Zeichen".into()));
    }
    if token.is_empty() {
        return Err(AppError::Auth("Nicht bei Vibe angemeldet".into()));
    }
    let text = read_bundle(bundle).await?;
    let file_name = bundle
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| n.ends_with(".vibey"))
        .map(|n| crate::paths::sanitize_file_name(&n))
        .unwrap_or_else(|| "cosmetic.vibey".into());
    let mut form = reqwest::multipart::Form::new()
        .text("name", name.to_string())
        .text("description", description.to_string())
        .part("bundle", reqwest::multipart::Part::bytes(text.into_bytes()).file_name(file_name).mime_str("application/vnd.vibey+json")?);
    if let Some(b64) = thumbnail_png.filter(|s| !s.is_empty()) {
        let b64 = b64.strip_prefix("data:image/png;base64,").unwrap_or(b64);
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|_| AppError::Invalid("Vorschaubild ist kein gültiges Base64".into()))?;
        if bytes.len() > MAX_THUMB_BYTES {
            return Err(AppError::Invalid("Vorschaubild zu groß (max. 1 MiB)".into()));
        }
        // Backend: PNG ≤ 256×256 (SUBMISSION_THUMB_MAX_PX), ≤ 1 MB
        match png_size(&bytes) {
            Some((w, h)) if (1..=256).contains(&w) && (1..=256).contains(&h) => {}
            Some((w, h)) => return Err(AppError::Invalid(format!("Vorschaubild darf höchstens 256×256 Pixel groß sein (ist {w}×{h})"))),
            None => return Err(AppError::Invalid("Vorschaubild ist kein PNG".into())),
        }
        form = form.part("thumbnail", reqwest::multipart::Part::bytes(bytes).file_name("thumbnail.png").mime_str("image/png")?);
    }
    let url = format!("{base}/api/v1/cosmetics/submissions");
    let r = state.net.client.post(url).bearer_auth(token).multipart(form).timeout(Duration::from_secs(120)).send().await?;
    let status = r.status().as_u16();
    let body = r.text().await?;
    if !(200..300).contains(&status) {
        return Err(vibe::api_error(status, &body));
    }
    Ok(serde_json::from_str(&body)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png() {
        let mut b = vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
        b.extend_from_slice(b"IHDR");
        b.extend_from_slice(&256u32.to_be_bytes());
        b.extend_from_slice(&128u32.to_be_bytes());
        assert_eq!(png_size(&b), Some((256, 128)));
        assert_eq!(png_size(b"GIF89a................."), None);
        assert!(png_data_url(&b).starts_with("data:image/png;base64,iVBOR"));
    }

    #[tokio::test]
    async fn bundle_limits() {
        let dir = std::env::temp_dir().join(format!("vibey-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ok = dir.join("a.vibey");
        std::fs::write(&ok, r#"{"format":"vibey"}"#).unwrap();
        assert!(read_bundle(&ok).await.unwrap().contains("vibey"));
        let big = dir.join("b.vibey");
        std::fs::write(&big, vec![b'a'; (MAX_BUNDLE_BYTES + 1) as usize]).unwrap();
        assert!(read_bundle(&big).await.is_err());
        let bin = dir.join("c.vibey");
        std::fs::write(&bin, [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_bundle(&bin).await.is_err());
        assert!(read_bundle(&dir.join("fehlt.vibey")).await.is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
