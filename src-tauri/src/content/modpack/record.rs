use super::*;

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

pub(super) fn record_path(state: &AppState, id: &str) -> PathBuf {
    state.paths.instance_dir(id).join("pack.json")
}

pub(crate) fn load_record(state: &AppState, id: &str) -> Option<PackRecord> {
    std::fs::read(record_path(state, id)).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

pub(super) fn proj_key(origin: &Option<(Source, String, String)>) -> Option<String> {
    origin.as_ref().map(|(s, p, _)| format!("{}|{p}", s.as_string()))
}

pub(super) fn norm_rel(p: &str) -> String {
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
pub(crate) fn record_or_fallback(state: &AppState, inst: &Instance) -> Option<(PackRecord, bool)> {
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
