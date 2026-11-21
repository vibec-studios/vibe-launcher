//! Screenshots hochladen (`POST /api/v1/screenshots`, multipart), geschützte Bilder des Backends als data-URL laden
//! und Instanz-Manifeste für die Cloud-Sicherung (`/api/v1/cloud-settings`) erzeugen bzw. wiederherstellen.
//! Die Cloud-Sicherung enthält nur Datei-Referenzen, nie Dateien oder Overrides.
use super::packs::{build_vlpack, tmp_path, TmpFiles};
use super::{api_error, check_api_url, ensure, Feature};
use crate::content::import::{self, ImportOptions};
use crate::content::{export, ExportOptions, PackFormat};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::Path;
use std::time::Duration;

const MAX_IMAGE: usize = 8 * 1024 * 1024;
const CONTENT_DIRS: [&str; 3] = ["mods", "resourcepacks", "shaderpacks"];

fn image_type(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else {
        None
    }
}

pub async fn upload_screenshot(state: &AppState, path: &str, visibility: &str, token: &str) -> AppResult<Value> {
    let base = ensure(state, Feature::Social)?;
    let file = crate::commands::screenshots::checked(state, path)?;
    let vis = match visibility {
        v @ ("private" | "friends" | "link") => v.to_string(),
        _ => return Err(AppError::Invalid("Ungültige Sichtbarkeit".into())),
    };
    let bytes = tokio::fs::read(&file).await?;
    if bytes.len() > MAX_IMAGE {
        return Err(AppError::Msg("shot:too_large".into()));
    }
    let mime = image_type(&bytes).ok_or_else(|| AppError::Msg("shot:format".into()))?;
    let name = file.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "screenshot.png".into());
    let form = reqwest::multipart::Form::new()
        .text("visibility", vis)
        .part("file", reqwest::multipart::Part::bytes(bytes).file_name(name).mime_str(mime)?);
    let r = state
        .net
        .client
        .post(format!("{base}/api/v1/screenshots"))
        .bearer_auth(token)
        .multipart(form)
        .timeout(Duration::from_secs(120))
        .send()
        .await?;
    let status = r.status().as_u16();
    let body = r.text().await?;
    match status {
        200..=299 => Ok(serde_json::from_str(&body)?),
        409 => Err(AppError::Msg("shot:quota".into())),
        413 => Err(AppError::Msg("shot:too_large".into())),
        415 => Err(AppError::Msg("shot:format".into())),
        _ => Err(api_error(status, &body)),
    }
}

pub async fn image(state: &AppState, url: &str, token: Option<&str>) -> AppResult<String> {
    let base = ensure(state, Feature::Social)?;
    let u = check_api_url(&base, url)?;
    let mut rb = state.net.client.get(u).timeout(Duration::from_secs(30));
    if let Some(t) = token.filter(|t| !t.is_empty()) {
        rb = rb.bearer_auth(t);
    }
    let r = rb.send().await?;
    let status = r.status().as_u16();
    if !(200..300).contains(&status) {
        let body = r.text().await.unwrap_or_default();
        return Err(api_error(status, &body));
    }
    let bytes = r.bytes().await?;
    if bytes.len() > MAX_IMAGE {
        return Err(AppError::msg("Bild zu groß"));
    }
    let mime = image_type(&bytes).ok_or_else(|| AppError::msg("Kein Bild"))?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

#[derive(Debug, Clone, Serialize)]
pub struct CloudInstance {
    pub id: String,
    pub manifest: Value,
}

fn manifest_of(vlpack: &Path) -> AppResult<Value> {
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(std::fs::File::open(vlpack)?))?;
    let mut f = zip.by_name("vlpack.json").map_err(|_| AppError::msg("Export unvollständig (vlpack.json fehlt)"))?;
    let mut s = String::new();
    f.read_to_string(&mut s)?;
    let mut v: Value = serde_json::from_str(&s)?;
    if let Some(o) = v.as_object_mut() {
        o.remove("overrides");
        o.insert("icon".into(), Value::Null);
    }
    Ok(v)
}

async fn manifest_for(state: &AppState, task: &TaskHandle, instance_id: &str) -> AppResult<Value> {
    let inst = state.instances.get(instance_id)?;
    let vlpack = tmp_path(state, "vlpack");
    let _cleanup = TmpFiles(vec![vlpack.clone()]);
    let include: Vec<String> = export::entries(state, instance_id)
        .await?
        .into_iter()
        .filter(|e| e.is_dir && CONTENT_DIRS.contains(&e.path.as_str()))
        .map(|e| e.path)
        .collect();
    let eo = ExportOptions {
        format: PackFormat::Vlpack,
        dest: vlpack.to_string_lossy().into_owned(),
        name: inst.name.clone(),
        version: "1.0.0".into(),
        author: super::identity(state).map(|i| i.name),
        description: None,
        include,
    };
    export::run_export(state.clone(), task.clone(), instance_id.to_string(), eo).await?;
    let p = vlpack.clone();
    tokio::task::spawn_blocking(move || manifest_of(&p)).await?
}

pub async fn manifests(state: &AppState, ids: Vec<String>) -> AppResult<Vec<CloudInstance>> {
    ensure(state, Feature::Any)?;
    if ids.len() > 100 {
        return Err(AppError::Invalid("Höchstens 100 Instanzen".into()));
    }
    let task = state.tasks.create("export", "Instanzliste für die Cloud vorbereiten", None);
    let mut out = Vec::new();
    let mut res: AppResult<()> = Ok(());
    for (n, id) in ids.iter().enumerate() {
        task.stage(format!("Instanz {} von {} …", n + 1, ids.len()), Some(n as f64 / ids.len().max(1) as f64));
        match manifest_for(state, &task, id).await {
            Ok(manifest) => out.push(CloudInstance { id: id.clone(), manifest }),
            Err(AppError::Cancelled) => {
                res = Err(AppError::Cancelled);
                break;
            }
            Err(e) => tracing::warn!("Cloud-Manifest für {id} fehlgeschlagen: {e}"),
        }
    }
    task.finish(match &res {
        Ok(()) => Ok(()),
        Err(_) => Err(AppError::Cancelled),
    });
    res.map(|_| out)
}

pub async fn restore(state: AppState, task: TaskHandle, manifest: Value) -> AppResult<()> {
    if !manifest.is_object() || manifest["format_version"].as_u64() != Some(1) {
        return Err(AppError::Invalid("Ungültiges Manifest".into()));
    }
    let name = manifest["name"].as_str().unwrap_or("Instanz").to_string();
    let mut m = manifest;
    m["icon"] = Value::Null;
    let vlpack = tmp_path(&state, "vlpack");
    let _cleanup = TmpFiles(vec![vlpack.clone()]);
    let text = serde_json::to_string_pretty(&m)?;
    let p = vlpack.clone();
    tokio::task::spawn_blocking(move || build_vlpack(&p, &text, None, None)).await??;
    task.check()?;
    let sub = task.sub(0.0, 1.0);
    import::run_import(&state, &task, &vlpack, ImportOptions { name: Some(name), ..Default::default() }, sub).await?;
    Ok(())
}
