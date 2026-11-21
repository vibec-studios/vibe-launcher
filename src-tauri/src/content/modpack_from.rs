use super::import::{self, PackPlan};
use super::modpack::{self, ModpackPreview, NewOrigin, PackRecord, Target};
use super::{packwiz, ProjectVersion, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{Instance, PackSource, PackSourceKind};
use crate::net::DownloadItem;
use crate::state::AppState;
use crate::tasks::TaskHandle;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PackInput {
    File { path: String },
    Url { url: String },
    Vibe {
        code: String,
        #[serde(default)]
        version_id: Option<String>,
        #[serde(default)]
        link: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct RemoteUpdate {
    pub location: String,
    pub name: Option<String>,
    pub current_version: Option<String>,
    pub latest_version: Option<String>,
}

struct Prepared {
    target: Target,
    origin: NewOrigin,
    cleanup: Option<PathBuf>,
}

fn record_for(state: &AppState, inst: &Instance) -> (PackRecord, bool) {
    if let Some(r) = modpack::load_record(state, &inst.id) {
        return (r, false);
    }
    if let Some(r) = modpack::record_or_fallback(state, inst) {
        return r;
    }
    (PackRecord { mc_version: inst.mc_version.clone(), loader: Some(inst.loader.clone()), ..Default::default() }, true)
}

fn synthetic_version(rec: &PackRecord, id: String, number: String, plan: &PackPlan) -> ProjectVersion {
    ProjectVersion {
        source: rec.source.unwrap_or(Source::Modrinth),
        id,
        project_id: rec.project_id.clone().unwrap_or_default(),
        name: plan.name.clone(),
        version_number: number,
        game_versions: vec![plan.mc_version.clone()],
        loaders: vec![plan.loader.kind.as_str().to_string()],
        release_type: "release".into(),
        date: chrono::Utc::now().to_rfc3339(),
        downloads: 0,
        files: vec![],
        dependencies: vec![],
        changelog: None,
    }
}

fn short(h: &str) -> String {
    h.chars().take(10).collect()
}

fn is_http(s: &str) -> bool {
    let s = s.trim();
    s.starts_with("https://") || s.starts_with("http://")
}

async fn download_zip(state: &AppState, url: &str) -> AppResult<PathBuf> {
    let u = url::Url::parse(url.trim()).map_err(|_| AppError::Invalid("Ungültiger Link".into()))?;
    let ext = Path::new(u.path()).extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).filter(|e| ["mrpack", "zip", "vlpack"].contains(&e.as_str())).unwrap_or_else(|| "zip".into());
    let dest = state.paths.tmp().join("packs").join(format!("{}.{ext}", uuid::Uuid::new_v4()));
    state.net.download_all(vec![DownloadItem::new(u.to_string(), dest.clone())], None).await?;
    Ok(dest)
}

async fn from_packwiz(state: &AppState, rec: &PackRecord, location: &str) -> AppResult<Prepared> {
    let zip = state.paths.tmp().join("packs").join(format!("packwiz-{}.zip", uuid::Uuid::new_v4()));
    let loaded = match packwiz::load(state, location, &zip).await {
        Ok(l) => l,
        Err(e) => {
            let _ = tokio::fs::remove_file(&zip).await;
            return Err(e);
        }
    };
    let number = loaded.plan.version_name.clone().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| short(&loaded.index_hash));
    let version = synthetic_version(rec, format!("packwiz:{}", short(&loaded.index_hash)), number, &loaded.plan);
    let origin = NewOrigin { source: None, project_id: None, version_id: Some(loaded.index_hash.clone()), remote: Some(loaded.location.clone()), remote_hash: Some(loaded.index_hash.clone()) };
    let target = modpack::finish_target(state, version, loaded.plan, loaded.zip).await;
    match target {
        Ok(target) => Ok(Prepared { target, origin, cleanup: Some(zip) }),
        Err(e) => {
            let _ = tokio::fs::remove_file(&zip).await;
            Err(e)
        }
    }
}

async fn from_archive(state: &AppState, rec: &PackRecord, path: PathBuf, cleanup: Option<PathBuf>) -> AppResult<Prepared> {
    let res = async {
        let p = path.clone();
        let plan = tokio::task::spawn_blocking(move || import::analyze(&p)).await??;
        let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Datei".into());
        let number = plan.version_name.clone().filter(|v| !v.trim().is_empty()).unwrap_or(stem);
        let version = synthetic_version(rec, "file".into(), number, &plan);
        modpack::finish_target(state, version, plan, path.clone()).await
    }
    .await;
    match res {
        Ok(target) => {
            let origin = NewOrigin { source: rec.source, project_id: rec.project_id.clone(), version_id: None, remote: None, remote_hash: None };
            Ok(Prepared { target, origin, cleanup })
        }
        Err(e) => {
            if let Some(c) = &cleanup {
                let _ = tokio::fs::remove_file(c).await;
            }
            Err(e)
        }
    }
}

async fn from_vibe(state: &AppState, rec: &PackRecord, code: &str, version_id: Option<String>, link: Option<String>) -> AppResult<Prepared> {
    use crate::vibe::pack_fetch::{fetch, PackOrigin};
    let origin = match link {
        Some(link) => PackOrigin::PlayLink { link },
        None => PackOrigin::Code { code: code.to_string(), version_id },
    };
    let f = fetch(state, None, &origin, None).await?;
    if !f.code.eq_ignore_ascii_case(code) {
        return Err(AppError::Invalid("Der Spiel-Link gehört zu einem anderen Modpack".into()));
    }
    let keep = state.paths.tmp().join("packs").join(format!("vibe-{}.vlpack", uuid::Uuid::new_v4().simple()));
    if let Some(dir) = keep.parent() {
        tokio::fs::create_dir_all(dir).await?;
    }
    tokio::fs::copy(&f.vlpack, &keep).await?;
    let p = keep.clone();
    let plan = match tokio::task::spawn_blocking(move || import::analyze(&p)).await? {
        Ok(p) => p,
        Err(e) => {
            let _ = tokio::fs::remove_file(&keep).await;
            return Err(e);
        }
    };
    let vid = f.source.version_id.clone();
    let number = f.source.version_name.clone().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| vid.clone().unwrap_or_default());
    let version = synthetic_version(rec, vid.clone().unwrap_or_else(|| "vibe".into()), number, &plan);
    match modpack::finish_target(state, version, plan, keep.clone()).await {
        Ok(target) => Ok(Prepared {
            target,
            origin: NewOrigin { source: rec.source, project_id: Some(f.code.clone()), version_id: vid, remote: None, remote_hash: None },
            cleanup: Some(keep),
        }),
        Err(e) => {
            let _ = tokio::fs::remove_file(&keep).await;
            Err(e)
        }
    }
}

async fn prepare(state: &AppState, rec: &PackRecord, input: &PackInput) -> AppResult<Prepared> {
    match input {
        PackInput::Vibe { code, version_id, link } => from_vibe(state, rec, code, version_id.clone(), link.clone()).await,
        PackInput::Url { url } if !is_http(url) => Err(AppError::Invalid("Bitte einen Link angeben, der mit https:// beginnt".into())),
        PackInput::Url { url } if packwiz::looks_like_packwiz(url) => from_packwiz(state, rec, url).await,
        PackInput::Url { url } => {
            let zip = download_zip(state, url).await?;
            from_archive(state, rec, zip.clone(), Some(zip)).await
        }
        PackInput::File { path } if packwiz::looks_like_packwiz(path) => from_packwiz(state, rec, path).await,
        PackInput::File { path } => from_archive(state, rec, PathBuf::from(path), None).await,
    }
}

async fn cleanup(p: &Option<PathBuf>) {
    if let Some(p) = p {
        let _ = tokio::fs::remove_file(p).await;
    }
}

fn java_instance(state: &AppState, instance_id: &str) -> AppResult<Instance> {
    let inst = state.instances.get(instance_id)?;
    if inst.bedrock.is_some() {
        return Err(AppError::Invalid("Bedrock-Instanzen können nicht aus einem Modpack aktualisiert werden".into()));
    }
    Ok(inst)
}

pub async fn preview(state: &AppState, instance_id: &str, input: PackInput) -> AppResult<ModpackPreview> {
    let inst = java_instance(state, instance_id)?;
    let (rec, legacy) = record_for(state, &inst);
    let p = prepare(state, &rec, &input).await?;
    let res = modpack::preview_target(state, inst, rec, legacy, p.target).await;
    cleanup(&p.cleanup).await;
    res
}

pub async fn run_update(state: AppState, task: TaskHandle, instance_id: String, input: PackInput) -> AppResult<()> {
    let inst = java_instance(&state, &instance_id)?;
    let (rec, legacy) = record_for(&state, &inst);
    task.stage("Lade das Modpack …", None);
    let p = prepare(&state, &rec, &input).await?;
    let res = modpack::apply_target(state, task, inst, rec, legacy, p.target, p.origin).await;
    cleanup(&p.cleanup).await;
    res
}

pub async fn check_remote(state: &AppState, instance_id: &str) -> AppResult<Option<RemoteUpdate>> {
    let Some(rec) = modpack::load_record(state, instance_id) else { return Ok(None) };
    let (Some(location), Some(hash)) = (rec.remote.clone(), rec.remote_hash.clone()) else { return Ok(None) };
    let r = packwiz::remote(state, &location).await?;
    if r.index_hash.is_empty() || r.index_hash.eq_ignore_ascii_case(&hash) {
        return Ok(None);
    }
    Ok(Some(RemoteUpdate { location, name: r.name, current_version: rec.version_number.clone(), latest_version: r.version }))
}

pub(super) fn apply_source(src: &mut Option<PackSource>, remote: Option<&str>, version_id: Option<String>, version_name: &str, pack_name: &str) {
    if let Some(loc) = remote {
        *src = Some(PackSource { kind: PackSourceKind::Packwiz, project_id: Some(loc.to_string()), version_id, name: Some(pack_name.to_string()), version_name: Some(version_name.to_string()) });
        return;
    }
    match src.as_mut() {
        Some(s) => {
            if s.kind == PackSourceKind::Packwiz {
                s.kind = PackSourceKind::Local;
                s.project_id = None;
            }
            s.version_id = version_id;
            s.version_name = Some(version_name.to_string());
        }
        None => {
            *src = Some(PackSource { kind: PackSourceKind::Local, project_id: None, version_id: None, name: Some(pack_name.to_string()), version_name: Some(version_name.to_string()) });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src(kind: PackSourceKind) -> Option<PackSource> {
        Some(PackSource { kind, project_id: Some("p".into()), version_id: Some("v1".into()), name: Some("Pack".into()), version_name: Some("1.0".into()) })
    }

    #[test]
    fn source_after_update() {
        let mut s = src(PackSourceKind::Modrinth);
        apply_source(&mut s, None, Some("v2".into()), "2.0", "Pack");
        let s = s.unwrap();
        assert_eq!((s.kind, s.project_id.as_deref(), s.version_id.as_deref(), s.version_name.as_deref()), (PackSourceKind::Modrinth, Some("p"), Some("v2"), Some("2.0")));

        let mut s = src(PackSourceKind::Local);
        apply_source(&mut s, Some("https://x/pack.toml"), Some("h".into()), "3.0", "Pack");
        let s = s.unwrap();
        assert_eq!((s.kind, s.project_id.as_deref(), s.version_id.as_deref()), (PackSourceKind::Packwiz, Some("https://x/pack.toml"), Some("h")));

        let mut s = src(PackSourceKind::Packwiz);
        apply_source(&mut s, None, None, "4.0", "Pack");
        let s = s.unwrap();
        assert_eq!((s.kind, s.project_id.as_deref()), (PackSourceKind::Local, None));

        let mut none = None;
        apply_source(&mut none, None, None, "1.0", "Neu");
        assert_eq!(none.unwrap().name.as_deref(), Some("Neu"));
    }

    #[test]
    fn input_json() {
        let a: PackInput = serde_json::from_str(r#"{"kind":"url","url":"https://x/pack.toml"}"#).unwrap();
        assert!(matches!(a, PackInput::Url { .. }));
        let b: PackInput = serde_json::from_str(r#"{"kind":"file","path":"C:/a.mrpack"}"#).unwrap();
        assert!(matches!(b, PackInput::File { .. }));
        let c: PackInput = serde_json::from_str(r#"{"kind":"vibe","code":"AB12CD34","version_id":null,"link":"k3x9q2"}"#).unwrap();
        assert!(matches!(c, PackInput::Vibe { link: Some(_), .. }));
        assert!(!is_http("file:///etc/passwd"));
    }
}
