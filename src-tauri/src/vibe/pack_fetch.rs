//! Geteiltes Vibe-Pack laden und als temporäres `.vlpack` bereitstellen – per Share-Code
//! (`/packs/<code>/download`) oder über einen Spiel-Link (`/play-links/<link>/pack`, Freigabe über den Link).
use super::packs::{build_vlpack, check_overrides, image_mime, valid_code};
use super::{api_error, check_api_url, ensure, Feature};
use crate::error::{AppError, AppResult};
use crate::instance::{PackSource, PackSourceKind};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone)]
pub enum PackOrigin {
    Code { code: String, version_id: Option<String> },
    PlayLink { link: String },
}

pub struct Fetched {
    pub vlpack: PathBuf,
    pub name: String,
    pub source: PackSource,
    pub code: String,
    files: Vec<PathBuf>,
}

impl Drop for Fetched {
    fn drop(&mut self) {
        for p in &self.files {
            let _ = std::fs::remove_file(p);
        }
    }
}

fn tmp_path(state: &AppState, ext: &str) -> PathBuf {
    let dir = state.paths.tmp();
    let _ = std::fs::create_dir_all(&dir);
    dir.join(format!("vibe-{}.{ext}", uuid::Uuid::new_v4().simple()))
}

fn ok_version(v: &str) -> bool {
    !v.is_empty() && v.len() <= 64 && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn download_url(base: &str, origin: &PackOrigin) -> AppResult<String> {
    match origin {
        PackOrigin::Code { code, version_id } => {
            if !valid_code(code) {
                return Err(AppError::Invalid("Ungültiger Pack-Code".into()));
            }
            let mut url = format!("{base}/api/v1/packs/{code}/download");
            if let Some(v) = version_id.as_deref().filter(|v| ok_version(v)) {
                url.push_str(&format!("?version={v}"));
            }
            Ok(url)
        }
        PackOrigin::PlayLink { link } => {
            let link = link.trim().to_ascii_lowercase();
            if !crate::play::valid_code(&link) {
                return Err(AppError::Invalid("Ungültiger Spiel-Link".into()));
            }
            Ok(format!("{base}/api/v1/play-links/{link}/pack"))
        }
    }
}

fn bearer(state: &AppState, token: Option<String>) -> Option<String> {
    token.filter(|t| !t.is_empty()).or_else(|| super::tokens_get(state).map(|t| t.access_token)).filter(|t| !t.is_empty())
}

async fn get(state: &AppState, url: url::Url, token: Option<&str>, secs: u64) -> AppResult<reqwest::Response> {
    let mut rb = state.net.client.get(url).timeout(Duration::from_secs(secs));
    if let Some(t) = token {
        rb = rb.bearer_auth(t);
    }
    Ok(rb.send().await?)
}

/// Manifest, Overrides und Icon laden und als `.vlpack` zusammensetzen.
pub async fn fetch(state: &AppState, task: Option<&TaskHandle>, origin: &PackOrigin, token: Option<String>) -> AppResult<Fetched> {
    let base = match origin {
        PackOrigin::Code { .. } => ensure(state, Feature::Sharing)?,
        PackOrigin::PlayLink { .. } => ensure(state, Feature::Any)?,
    };
    let token = bearer(state, token);
    if let Some(t) = task {
        t.stage("Lade Pack-Informationen …", None);
    }
    let url = check_api_url(&base, &download_url(&base, origin)?)?;
    let r = get(state, url, token.as_deref(), 30).await?;
    let status = r.status().as_u16();
    let body = r.text().await?;
    if !(200..300).contains(&status) {
        return Err(api_error(status, &body));
    }
    let dl: Value = serde_json::from_str(&body)?;
    let pack = &dl["pack"];
    let version = &dl["version"];
    let mut manifest = dl["manifest"].clone();
    if !manifest.is_object() {
        return Err(AppError::msg("Der Vibe-Server hat kein gültiges Manifest geliefert"));
    }
    let code = pack["code"].as_str().map(str::to_string).or_else(|| match origin {
        PackOrigin::Code { code, .. } => Some(code.clone()),
        PackOrigin::PlayLink { .. } => None,
    });
    let code = code.filter(|c| valid_code(c)).ok_or_else(|| AppError::msg("Der Vibe-Server hat keinen gültigen Pack-Code geliefert"))?;
    let name = pack["name"].as_str().unwrap_or("Geteiltes Pack").to_string();
    if let Some(t) = task {
        t.check()?;
    }

    let overrides = tmp_path(state, "zip");
    let vlpack = tmp_path(state, "vlpack");
    let out = Fetched {
        vlpack: vlpack.clone(),
        name: name.clone(),
        code: code.clone(),
        source: PackSource {
            kind: PackSourceKind::Vibe,
            project_id: Some(code),
            version_id: version["id"].as_str().map(str::to_string),
            name: Some(name.clone()),
            version_name: version["version"].as_str().map(str::to_string),
        },
        files: vec![overrides.clone(), vlpack.clone()],
    };

    let mut has_overrides = false;
    if let Some(ourl) = version["overrides"]["url"].as_str() {
        if let Some(t) = task {
            t.stage("Lade Overrides …", Some(0.05));
        }
        let r = get(state, check_api_url(&base, ourl)?, token.as_deref(), 600).await?;
        if !r.status().is_success() {
            return Err(AppError::msg(format!("Overrides konnten nicht geladen werden (HTTP {})", r.status().as_u16())));
        }
        let bytes = r.bytes().await?;
        tokio::fs::write(&overrides, &bytes).await?;
        let p = overrides.clone();
        tokio::task::spawn_blocking(move || check_overrides(&p)).await??;
        has_overrides = true;
    }
    if let Some(t) = task {
        t.check()?;
    }

    let mut icon: Option<Vec<u8>> = None;
    if let Some(u) = pack["iconUrl"].as_str().and_then(|i| check_api_url(&base, i).ok()) {
        if let Ok(r) = get(state, u, None, 20).await {
            if r.status().is_success() {
                if let Ok(b) = r.bytes().await {
                    if b.len() <= 1024 * 1024 && image_mime(&b).is_some() {
                        icon = Some(b.to_vec());
                    }
                }
            }
        }
    }

    manifest["name"] = Value::String(name);
    manifest["icon"] = if icon.is_some() { Value::String("icon.png".into()) } else { Value::Null };
    let (vp, op) = (vlpack, overrides);
    let mtext = serde_json::to_string_pretty(&manifest)?;
    tokio::task::spawn_blocking(move || build_vlpack(&vp, &mtext, has_overrides.then_some(op.as_path()), icon.as_deref())).await??;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls() {
        let b = "https://vibe.axolite.app";
        assert_eq!(
            download_url(b, &PackOrigin::Code { code: "AB12CD34".into(), version_id: Some("01J-x".into()) }).unwrap(),
            "https://vibe.axolite.app/api/v1/packs/AB12CD34/download?version=01J-x"
        );
        assert_eq!(download_url(b, &PackOrigin::Code { code: "AB12CD34".into(), version_id: Some("../x".into()) }).unwrap(), "https://vibe.axolite.app/api/v1/packs/AB12CD34/download");
        assert!(download_url(b, &PackOrigin::Code { code: "a/b".into(), version_id: None }).is_err());
        assert_eq!(download_url(b, &PackOrigin::PlayLink { link: "K3X9Q2".into() }).unwrap(), "https://vibe.axolite.app/api/v1/play-links/k3x9q2/pack");
        assert!(download_url(b, &PackOrigin::PlayLink { link: "k3x9q0".into() }).is_err());
    }
}
