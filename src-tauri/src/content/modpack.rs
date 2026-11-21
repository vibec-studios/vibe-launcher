//! Modpack-Updates: neue Pack-Versionen erkennen, Änderungen vorab zeigen und anwenden.
//!
//! Beim Import wird der Installationsstand in `instances/<id>/pack.json` festgehalten (Pack-Dateien und
//! SHA-1 der Overrides). Beim Update werden Pack-Dateien ausgetauscht, vom Nutzer hinzugefügte Inhalte
//! bleiben, und Overrides (Configs) werden nur überschrieben, wenn der Nutzer sie seit der Installation
//! nicht verändert hat – sonst bleibt seine Version (Konflikt-Hinweis).
use super::import::{self, ImportOptions, PackFile, PackPlan};
use super::index::{self, ContentIndex, IndexEntry};
use super::missing::{self, MissingEntry};
use super::{curseforge as cf, modrinth as mr, provider, *};
use crate::error::{AppError, AppResult};
use crate::instance::{Instance, Loader, PackSourceKind};
use crate::net::DownloadItem;
use crate::state::AppState;
use crate::tasks::TaskHandle;
use crate::util::safe_join;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct RecFile {
    pub sha1: Option<String>,
    /// "<quelle>|<projekt-id>", falls bekannt
    pub project: Option<String>,
}

/// Installationsstand eines Modpacks (`pack.json`).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct PackRecord {
    pub source: Option<Source>,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub version_number: Option<String>,
    pub mc_version: String,
    pub loader: Option<Loader>,
    /// Pack-Dateien (relativer Pfad -> Hash/Projekt)
    pub files: BTreeMap<String, RecFile>,
    /// Overrides (relativer Pfad -> SHA-1 wie installiert)
    pub overrides: BTreeMap<String, String>,
    pub installed_at: i64,
    pub remote: Option<String>,
    pub remote_hash: Option<String>,
}

fn record_path(state: &AppState, id: &str) -> PathBuf {
    state.paths.instance_dir(id).join("pack.json")
}

pub(super) fn load_record(state: &AppState, id: &str) -> Option<PackRecord> {
    std::fs::read(record_path(state, id)).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

fn proj_key(origin: &Option<(Source, String, String)>) -> Option<String> {
    origin.as_ref().map(|(s, p, _)| format!("{}|{p}", s.as_string()))
}

fn norm_rel(p: &str) -> String {
    p.replace('\\', "/").trim_start_matches("./").to_string()
}

/// Nach einem Import: Stand merken.
pub async fn record_after_import(state: &AppState, instance_id: &str, zip: &Path, plan: &PackPlan, files: &[PackFile], opts: &ImportOptions) -> AppResult<()> {
    let zp = zip.to_path_buf();
    let prefixes = plan.overrides.clone();
    let overrides = tokio::task::spawn_blocking(move || import::override_entries(&zp, &prefixes)).await??;
    let rec = PackRecord {
        source: opts.pack_source,
        project_id: opts.source.as_ref().and_then(|s| s.project_id.clone()),
        version_id: opts.source.as_ref().and_then(|s| s.version_id.clone()),
        version_number: opts.source.as_ref().and_then(|s| s.version_name.clone()).or(plan.version_name.clone()),
        mc_version: plan.mc_version.clone(),
        loader: Some(plan.loader.clone()),
        files: files.iter().map(|f| (norm_rel(&f.path), RecFile { sha1: f.sha1.clone(), project: proj_key(&f.origin) })).collect(),
        overrides: overrides.into_iter().map(|(k, (h, _))| (k, h)).collect(),
        installed_at: crate::util::now_ms(),
        remote: None,
        remote_hash: None,
    };
    crate::util::write_json_atomic(&record_path(state, instance_id), &rec)
}

/// Nach einer Snapshot-Wiederherstellung: Minecraft/Loader der Instanz an pack.json angleichen.
pub fn sync_instance_with_record(state: &AppState, instance_id: &str) -> AppResult<()> {
    let Some(rec) = load_record(state, instance_id) else { return Ok(()) };
    let Some(loader) = rec.loader.clone() else { return Ok(()) };
    let inst = state.instances.get(instance_id)?;
    if rec.mc_version.is_empty() || (inst.mc_version == rec.mc_version && inst.loader == loader) {
        return Ok(());
    }
    let (vid, vnum) = (rec.version_id.clone(), rec.version_number.clone());
    state.instances.modify(instance_id, |i| {
        i.mc_version = rec.mc_version.clone();
        i.loader = loader.clone();
        if let Some(s) = i.source.as_mut() {
            if vid.is_some() {
                s.version_id = vid.clone();
                s.version_name = vnum.clone();
            }
        }
    })?;
    Ok(())
}

/// Stand aus pack.json oder (ältere Instanzen) aus `instance.source`. `bool` = nur Fallback (ohne Datei-Liste).
pub(super) fn record_or_fallback(state: &AppState, inst: &Instance) -> Option<(PackRecord, bool)> {
    if let Some(r) = load_record(state, &inst.id).filter(|r| r.source.is_some() && r.project_id.is_some()) {
        return Some((r, false));
    }
    let src = inst.source.as_ref()?;
    let source = match src.kind {
        PackSourceKind::Modrinth => Source::Modrinth,
        PackSourceKind::Curseforge => Source::Curseforge,
        _ => return None,
    };
    let pid = src.project_id.clone()?;
    Some((
        PackRecord {
            source: Some(source),
            project_id: Some(pid),
            version_id: src.version_id.clone(),
            version_number: src.version_name.clone(),
            mc_version: inst.mc_version.clone(),
            loader: Some(inst.loader.clone()),
            ..Default::default()
        },
        true,
    ))
}

async fn pack_versions(state: &AppState, source: Source, project_id: &str) -> AppResult<Vec<ProjectVersion>> {
    let mut v: Vec<ProjectVersion> = match source {
        Source::Modrinth => mr::raw_versions(state, project_id).await?.into_iter().map(mr::convert_version).collect(),
        Source::Curseforge => {
            let files = cf::raw_files(state, project_id, None, None).await?;
            files.iter().filter(|f| f.is_server_pack != Some(true) && f.is_available != Some(false)).map(cf::convert_file).collect()
        }
        Source::Store(k) => super::store::versions(state, k, project_id).await?.0,
    };
    v.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(v)
}

#[derive(Debug, Clone, Serialize)]
pub struct ModpackUpdate {
    pub source: Source,
    pub project_id: String,
    pub current_version: Option<String>,
    pub current_version_id: Option<String>,
    pub latest: ProjectVersion,
}

/// Neuere Pack-Version vorhanden?
pub async fn check(state: &AppState, instance_id: &str) -> AppResult<Option<ModpackUpdate>> {
    let inst = state.instances.get(instance_id)?;
    let Some((rec, _)) = record_or_fallback(state, &inst) else { return Ok(None) };
    let (Some(source), Some(pid)) = (rec.source, rec.project_id.clone()) else { return Ok(None) };
    if source == Source::Curseforge && !cf::available(state) {
        return Ok(None);
    }
    let versions = pack_versions(state, source, &pid).await?;
    let current = rec.version_id.as_ref().and_then(|id| versions.iter().find(|v| &v.id == id));
    let only_release = current.map_or(true, |c| c.release_type == "release");
    let pool: Vec<ProjectVersion> = versions.iter().filter(|v| !only_release || v.release_type == "release").cloned().collect();
    let Some(latest) = provider::pick_best(&pool, None).or_else(|| versions.first().cloned()) else { return Ok(None) };
    let newer = match current {
        Some(c) => latest.id != c.id && latest.date > c.date,
        None => rec.version_id.as_deref() != Some(latest.id.as_str()),
    };
    Ok(newer.then(|| ModpackUpdate { source, project_id: pid, current_version: rec.version_number.clone(), current_version_id: rec.version_id.clone(), latest }))
}

// ------------------------------------------------------------------ Ziel laden + Vergleich

pub(super) struct Target {
    pub(super) version: ProjectVersion,
    pub(super) plan: PackPlan,
    pub(super) zip: PathBuf,
    pub(super) files: Vec<PackFile>,
    pub(super) missing: Vec<MissingEntry>,
    pub(super) overrides: BTreeMap<String, (String, u64)>,
}

async fn load_target(state: &AppState, source: Source, project_id: &str, version_id: Option<&str>) -> AppResult<Target> {
    let versions = pack_versions(state, source, project_id).await?;
    let version = match version_id {
        Some(v) => versions.iter().find(|x| x.id == v).cloned().ok_or_else(|| AppError::NotFound(format!("Pack-Version {v}")))?,
        None => provider::pick_best(&versions, None).ok_or_else(|| AppError::NotFound("keine Pack-Version".into()))?,
    };
    let file = version
        .files
        .iter()
        .find(|f| f.primary && (f.filename.ends_with(".mrpack") || f.filename.ends_with(".zip") || f.filename.ends_with(".vlpack")))
        .or_else(|| version.files.iter().find(|f| f.filename.ends_with(".mrpack")))
        .or(version.files.first())
        .cloned()
        .ok_or_else(|| AppError::msg("Pack-Version ohne Datei"))?;
    let url = file.url.clone().ok_or_else(|| AppError::msg("Der Autor erlaubt keinen Download dieses Modpacks über andere Launcher"))?;
    let ext = Path::new(&file.filename).extension().and_then(|e| e.to_str()).unwrap_or("zip").to_string();
    let dir = state.paths.tmp().join("packs");
    let zip = dir.join(format!("{}-{}.{ext}", crate::paths::sanitize_file_name(&source.as_string()), crate::paths::sanitize_file_name(&version.id)));
    state.net.download_all(vec![DownloadItem::new(url, zip.clone()).sha1(file.sha1.clone()).size(Some(file.size).filter(|s| *s > 0))], None).await?;
    let zp = zip.clone();
    let plan = tokio::task::spawn_blocking(move || import::analyze(&zp)).await??;
    finish_target(state, version, plan, zip).await
}

pub(super) async fn finish_target(state: &AppState, version: ProjectVersion, plan: PackPlan, zip: PathBuf) -> AppResult<Target> {
    let mut files = plan.files.clone();
    let mut missing_list = Vec::new();
    if !plan.cf_files.is_empty() {
        cf::key(state)?;
        let r = import::resolve_cf(state, &plan.cf_files).await?;
        files.extend(r.files);
        missing_list = r.missing;
    }
    let zp = zip.clone();
    let prefixes = plan.overrides.clone();
    let overrides = tokio::task::spawn_blocking(move || import::override_entries(&zp, &prefixes)).await??;
    Ok(Target { version, plan, zip, files, missing: missing_list, overrides })
}

#[derive(Debug, Clone, Serialize)]
pub struct PreviewFile {
    pub path: String,
    pub name: String,
    /// "added" | "updated" | "removed"
    pub change: String,
    /// Bisheriger Pfad (bei Updates mit neuem Dateinamen)
    pub old_path: Option<String>,
    pub side: Side,
}

#[derive(Debug, Clone, Serialize)]
pub struct PreviewOverride {
    pub path: String,
    /// "new" | "update" | "conflict" (Nutzer-Version bleibt) | "remove"
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModpackPreview {
    pub current_version: Option<String>,
    pub target: ProjectVersion,
    pub mc_from: String,
    pub mc_to: String,
    pub loader_from: Loader,
    pub loader_to: Loader,
    pub files: Vec<PreviewFile>,
    pub unchanged: u32,
    pub overrides: Vec<PreviewOverride>,
    /// Vom Nutzer hinzugefügte Inhalte, die erhalten bleiben
    pub user_files: u32,
    /// Dateien, die manuell geladen werden müssen (CurseForge)
    pub missing: Vec<MissingDownload>,
    /// Instanz ohne gespeicherten Installationsstand (ältere Installation): Overrides gelten als verändert
    pub legacy: bool,
}

struct Diff {
    /// (neue Datei, alter Pfad falls ersetzt)
    add_or_update: Vec<(PackFile, Option<String>)>,
    removed: Vec<String>,
    unchanged: u32,
    overrides: Vec<PreviewOverride>,
    user_files: u32,
}

fn exists_any(game: &Path, rel: &str) -> Option<String> {
    let p = safe_join(game, rel)?;
    if p.exists() {
        return Some(rel.to_string());
    }
    let d = format!("{rel}.disabled");
    safe_join(game, &d).filter(|p| p.exists()).map(|_| d)
}

fn sha1_of(path: &Path) -> Option<String> {
    crate::net::sha1_file(path).ok()
}

fn diff(state: &AppState, inst: &Instance, rec: &PackRecord, legacy: bool, t: &Target) -> Diff {
    let game = state.paths.game_dir(&inst.id);
    let idx = ContentIndex::load(&state.paths, &inst.id);
    let mut old_by_proj: HashMap<String, String> = rec.files.iter().filter_map(|(rel, f)| f.project.clone().map(|p| (p, rel.clone()))).collect();
    let mut matched_old: HashSet<String> = HashSet::new();
    let mut out = Diff { add_or_update: vec![], removed: vec![], unchanged: 0, overrides: vec![], user_files: 0 };
    for f in &t.files {
        let rel = norm_rel(&f.path);
        let pk = proj_key(&f.origin);
        if let Some(old) = rec.files.get(&rel) {
            matched_old.insert(rel.clone());
            if old.sha1.is_some() && old.sha1 == f.sha1 && exists_any(&game, &rel).is_some() {
                out.unchanged += 1;
            } else {
                out.add_or_update.push((f.clone(), Some(rel.clone())));
            }
            continue;
        }
        if let Some(old_rel) = pk.as_ref().and_then(|p| old_by_proj.remove(p)) {
            matched_old.insert(old_rel.clone());
            out.add_or_update.push((f.clone(), Some(old_rel)));
            continue;
        }
        if legacy {
            // ohne Stand: gleicher Name vorhanden = unverändert, sonst gleiches Projekt im Index ersetzen
            if exists_any(&game, &rel).is_some() {
                out.unchanged += 1;
                continue;
            }
            if let Some((src, pid, _)) = &f.origin {
                if let Some(k) = idx.keys_of_project(*src, pid).into_iter().next() {
                    out.add_or_update.push((f.clone(), Some(k)));
                    continue;
                }
            }
        }
        out.add_or_update.push((f.clone(), None));
    }
    for rel in rec.files.keys() {
        if !matched_old.contains(rel) && exists_any(&game, rel).is_some() {
            out.removed.push(rel.clone());
        }
    }
    // Overrides
    for (rel, (new_sha, _)) in &t.overrides {
        let Some(p) = safe_join(&game, rel) else { continue };
        let disk = p.is_file().then(|| sha1_of(&p)).flatten();
        let status = match (&disk, rec.overrides.get(rel)) {
            (None, _) => "new",
            (Some(d), _) if d == new_sha => continue,
            (Some(d), Some(r)) if d == r && !legacy => "update",
            _ => "conflict",
        };
        out.overrides.push(PreviewOverride { path: rel.clone(), status: status.into() });
    }
    for (rel, recorded) in &rec.overrides {
        if t.overrides.contains_key(rel) {
            continue;
        }
        if let Some(p) = safe_join(&game, rel).filter(|p| p.is_file()) {
            if sha1_of(&p).as_deref() == Some(recorded.as_str()) {
                out.overrides.push(PreviewOverride { path: rel.clone(), status: "remove".into() });
            }
        }
    }
    // Nutzer-Inhalte: Dateien in Inhaltsordnern, die weder alt noch neu zum Pack gehören
    let new_rels: HashSet<String> = t.files.iter().map(|f| norm_rel(&f.path)).collect();
    for k in ContentKind::ALL {
        if let Ok(rd) = std::fs::read_dir(game.join(k.folder())) {
            for e in rd.flatten() {
                let rel = format!("{}/{}", k.folder(), index::strip_disabled(&e.file_name().to_string_lossy()));
                if !rec.files.contains_key(&rel) && !new_rels.contains(&rel) && !t.overrides.contains_key(&rel) {
                    out.user_files += 1;
                }
            }
        }
    }
    out
}

fn file_name(rel: &str) -> String {
    rel.rsplit('/').next().unwrap_or(rel).to_string()
}

pub async fn preview(state: &AppState, instance_id: &str, version_id: Option<String>) -> AppResult<ModpackPreview> {
    let inst = state.instances.get(instance_id)?;
    let (rec, legacy) = record_or_fallback(state, &inst).ok_or_else(|| AppError::Invalid("Diese Instanz stammt nicht aus einem aktualisierbaren Modpack".into()))?;
    let (Some(source), Some(pid)) = (rec.source, rec.project_id.clone()) else { return Err(AppError::Invalid("Modpack-Quelle unbekannt".into())) };
    let t = load_target(state, source, &pid, version_id.as_deref()).await?;
    preview_target(state, inst, rec, legacy, t).await
}

pub(super) async fn preview_target(state: &AppState, inst: Instance, rec: PackRecord, legacy: bool, t: Target) -> AppResult<ModpackPreview> {
    let st = state.clone();
    let inst2 = inst.clone();
    let rec2 = rec.clone();
    let (d, t) = tokio::task::spawn_blocking(move || {
        let d = diff(&st, &inst2, &rec2, legacy, &t);
        (d, t)
    })
    .await?;
    let _ = super::sides::fill_modrinth_sides(state, &inst.id).await;
    let idx = ContentIndex::load(&state.paths, &inst.id);
    let title_of = |rel: &str| {
        let (folder, file) = rel.split_once('/').unwrap_or(("", rel));
        idx.files.get(&index::key(folder, file)).and_then(|e| e.title.clone()).unwrap_or_else(|| file_name(rel))
    };
    let side_of = |rel: &str, side: Option<Side>| {
        let (folder, file) = rel.split_once('/').unwrap_or(("", rel));
        side.or_else(|| idx.files.get(&index::key(folder, file)).and_then(|e| e.side)).unwrap_or(match ContentKind::from_folder(folder) {
            Some(ContentKind::Resourcepack | ContentKind::Shader) => Side::Client,
            _ => Side::Unknown,
        })
    };
    let mut files: Vec<PreviewFile> = d
        .add_or_update
        .iter()
        .map(|(f, old)| {
            let rel = norm_rel(&f.path);
            PreviewFile {
                name: old.as_deref().map(&title_of).unwrap_or_else(|| file_name(&rel)),
                change: if old.is_some() { "updated" } else { "added" }.into(),
                old_path: old.clone().filter(|o| index::strip_disabled(o) != rel),
                side: side_of(old.as_deref().map(index::strip_disabled).unwrap_or(&rel), f.side),
                path: rel,
            }
        })
        .collect();
    files.extend(d.removed.iter().map(|rel| PreviewFile { path: rel.clone(), name: title_of(rel), change: "removed".into(), old_path: None, side: side_of(rel, None) }));
    files.sort_by(|a, b| a.change.cmp(&b.change).then(a.path.cmp(&b.path)));
    Ok(ModpackPreview {
        current_version: rec.version_number.clone(),
        mc_from: inst.mc_version.clone(),
        mc_to: t.plan.mc_version.clone(),
        loader_from: inst.loader.clone(),
        loader_to: t.plan.loader.clone(),
        target: t.version.clone(),
        files,
        unchanged: d.unchanged,
        overrides: d.overrides,
        user_files: d.user_files,
        missing: t.missing.iter().map(|m| m.info.clone()).collect(),
        legacy,
    })
}

fn index_entry(f: &PackFile) -> Option<(String, IndexEntry)> {
    let (source, pid, vid) = f.origin.clone()?;
    let rel = norm_rel(&f.path);
    let (folder, file) = rel.split_once('/')?;
    if ContentKind::from_folder(folder).is_none() || file.contains('/') {
        return None;
    }
    Some((
        index::key(folder, file),
        IndexEntry {
            source,
            project_id: pid,
            version_id: vid,
            sha1: f.sha1.clone(),
            sha512: None,
            title: None,
            icon_url: None,
            version_number: None,
            url: Some(f.url.clone()),
            size: f.size,
            date: None,
            release_type: None,
            side: f.side,
        },
    ))
}

/// Task-Körper von `modpack_update`.
pub async fn run_update(state: AppState, task: TaskHandle, instance_id: String, version_id: Option<String>) -> AppResult<()> {
    let inst = state.instances.get(&instance_id)?;
    let (rec, legacy) = record_or_fallback(&state, &inst).ok_or_else(|| AppError::Invalid("Diese Instanz stammt nicht aus einem aktualisierbaren Modpack".into()))?;
    let (Some(source), Some(pid)) = (rec.source, rec.project_id.clone()) else { return Err(AppError::Invalid("Modpack-Quelle unbekannt".into())) };
    task.stage("Lade neue Pack-Version …", None);
    let t = load_target(&state, source, &pid, version_id.as_deref()).await?;
    let origin = NewOrigin { source: Some(source), project_id: Some(pid), version_id: Some(t.version.id.clone()), remote: None, remote_hash: None };
    apply_target(state, task, inst, rec, legacy, t, origin).await
}

pub(super) struct NewOrigin {
    pub(super) source: Option<Source>,
    pub(super) project_id: Option<String>,
    pub(super) version_id: Option<String>,
    pub(super) remote: Option<String>,
    pub(super) remote_hash: Option<String>,
}

pub(super) async fn apply_target(state: AppState, task: TaskHandle, inst: Instance, rec: PackRecord, legacy: bool, t: Target, origin: NewOrigin) -> AppResult<()> {
    let instance_id = inst.id.clone();
    task.set_title(format!("{} auf {} aktualisieren", inst.name, t.version.version_number));
    task.check()?;
    task.stage("Sicherung wird erstellt …", None);
    let snap_name = format!("Vor Modpack-Update {} → {}", rec.version_number.clone().unwrap_or_else(|| "?".into()), t.version.version_number);
    if let Err(e) = super::snapshots::create(&state, &instance_id, &snap_name, true, None).await {
        return Err(AppError::msg(format!("Sicherung vor dem Update fehlgeschlagen: {e}")));
    }
    task.check()?;
    let st = state.clone();
    let inst2 = inst.clone();
    let rec2 = rec.clone();
    let (d, t) = tokio::task::spawn_blocking(move || {
        let d = diff(&st, &inst2, &rec2, legacy, &t);
        (d, t)
    })
    .await?;
    let game = state.paths.game_dir(&instance_id);

    // Downloads (deaktivierte Dateien bleiben deaktiviert)
    let mut items = Vec::new();
    for (f, old) in &d.add_or_update {
        let rel = norm_rel(&f.path);
        let disabled = old.as_ref().is_some_and(|o| exists_any(&game, index::strip_disabled(o)).is_some_and(|x| x.ends_with(".disabled")));
        let target_rel = if disabled { format!("{rel}.disabled") } else { rel.clone() };
        let path = safe_join(&game, &target_rel).ok_or_else(|| AppError::Invalid(format!("Unzulässiger Pfad: {rel}")))?;
        items.push(DownloadItem::new(f.url.clone(), path).sha1(f.sha1.clone()).size(f.size));
    }
    task.stage(format!("Lade {} Datei(en) …", items.len()), Some(0.1));
    state.net.download_all(items, Some(&task.sub(0.1, 0.85))).await?;
    task.check()?;

    // Alte Dateien entfernen (ersetzt / nicht mehr im Pack)
    let mut to_remove: Vec<String> = d.removed.clone();
    for (f, old) in &d.add_or_update {
        if let Some(o) = old {
            let o = index::strip_disabled(o).to_string();
            if o != norm_rel(&f.path) {
                to_remove.push(o);
            }
        }
    }
    for rel in &to_remove {
        for r in [rel.clone(), format!("{rel}.disabled")] {
            if let Some(p) = safe_join(&game, &r).filter(|p| p.is_file()) {
                let _ = tokio::fs::remove_file(p).await;
            }
        }
    }

    // Overrides
    task.stage("Konfigurationen werden aktualisiert …", Some(0.9));
    let write: HashSet<String> = d.overrides.iter().filter(|o| o.status == "new" || o.status == "update").map(|o| o.path.clone()).collect();
    let conflicts: Vec<String> = d.overrides.iter().filter(|o| o.status == "conflict").map(|o| o.path.clone()).collect();
    if !write.is_empty() {
        let zp = t.zip.clone();
        let prefixes = t.plan.overrides.clone();
        let gd = game.clone();
        tokio::task::spawn_blocking(move || import::extract_overrides_only(&zp, &prefixes, &gd, Some(&write), &|_| Ok(()))).await??;
    }
    for o in d.overrides.iter().filter(|o| o.status == "remove") {
        if let Some(p) = safe_join(&game, &o.path) {
            let _ = tokio::fs::remove_file(p).await;
        }
    }

    // Index
    {
        let lock = state.content.lock(&instance_id);
        let _g = lock.lock().await;
        let mut idx = ContentIndex::load(&state.paths, &instance_id);
        for rel in &to_remove {
            if let Some((folder, file)) = rel.split_once('/') {
                idx.files.remove(&index::key(folder, file));
            }
        }
        for (f, _) in &d.add_or_update {
            if let Some((k, e)) = index_entry(f) {
                idx.files.insert(k, e);
            }
        }
        idx.save(&state.paths, &instance_id)?;
    }
    missing::add(&state.paths, &instance_id, t.missing.clone())?;

    // Instanz: Version/Loader mitziehen, Herkunft aktualisieren
    let new_mc = t.plan.mc_version.clone();
    let new_loader = t.plan.loader.clone();
    let vnum = t.version.version_number.clone();
    let vid = origin.version_id.clone();
    let pack_name = t.plan.name.clone();
    let remote = origin.remote.clone();
    state.instances.modify(&instance_id, |i| {
        i.mc_version = new_mc.clone();
        i.loader = new_loader.clone();
        super::modpack_from::apply_source(&mut i.source, remote.as_deref(), vid.clone(), &vnum, &pack_name);
    })?;

    // Neuer Stand
    let rec_new = PackRecord {
        source: origin.source,
        project_id: origin.project_id.clone(),
        version_id: origin.version_id.clone(),
        version_number: Some(t.version.version_number.clone()),
        mc_version: t.plan.mc_version.clone(),
        loader: Some(t.plan.loader.clone()),
        files: t.files.iter().map(|f| (norm_rel(&f.path), RecFile { sha1: f.sha1.clone(), project: proj_key(&f.origin) })).collect(),
        overrides: t.overrides.iter().map(|(k, (h, _))| (k.clone(), h.clone())).collect(),
        installed_at: crate::util::now_ms(),
        remote: origin.remote.clone(),
        remote_hash: origin.remote_hash.clone(),
    };
    crate::util::write_json_atomic(&record_path(&state, &instance_id), &rec_new)?;
    state.content.update_counts.lock().remove(&instance_id);
    state.content.emit_changed(&instance_id);

    let updated = d.add_or_update.iter().filter(|(_, o)| o.is_some()).count();
    let added = d.add_or_update.len() - updated;
    let mut msg = format!("{updated} aktualisiert, {added} neu, {} entfernt", d.removed.len());
    if !conflicts.is_empty() {
        msg.push_str(&format!(" – {} geänderte Config(s) behalten", conflicts.len()));
        tracing::info!("Modpack-Update {instance_id}: Nutzer-Versionen behalten: {}", conflicts.join(", "));
    }
    task.message(msg);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_roundtrip() {
        let r = PackRecord {
            source: Some(Source::Modrinth),
            project_id: Some("p".into()),
            files: [("mods/a.jar".to_string(), RecFile { sha1: Some("aa".into()), project: Some("modrinth|x".into()) })].into(),
            ..Default::default()
        };
        let s = serde_json::to_string(&r).unwrap();
        let back: PackRecord = serde_json::from_str(&s).unwrap();
        assert_eq!(back.files["mods/a.jar"].project.as_deref(), Some("modrinth|x"));
        assert_eq!(proj_key(&Some((Source::Curseforge, "1".into(), "2".into()))).as_deref(), Some("curseforge|1"));
        assert_eq!(norm_rel(".\\mods\\a.jar"), "mods/a.jar");
    }
}
