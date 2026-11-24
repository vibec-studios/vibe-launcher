use super::*;

pub(super) fn new_instance(name: String, plan: &PackPlan, source: Option<PackSource>) -> Instance {
    let mut inst = Instance {
        id: String::new(),
        name,
        icon: None,
        accent: None,
        group: None,
        mc_version: plan.mc_version.clone(),
        loader: plan.loader.clone(),
        java: Default::default(),
        window: Default::default(),
        hooks: Default::default(),
        source,
        install_state: InstallState::NotInstalled,
        version_id: None,
        created_at: crate::util::now_ms(),
        last_played: None,
        play_time_secs: 0,
        notes: None,
        auto_update_content: None,
        bedrock: None,
        custom_loader: None,
    };
    if let Some(p) = &plan.prism {
        inst.java.min_memory_mb = p.min_memory_mb;
        inst.java.max_memory_mb = p.max_memory_mb;
        inst.java.jvm_args = p.jvm_args.clone();
        inst.notes = p.notes.clone();
    }
    inst
}

pub(super) fn pack_source_kind(f: PackFormat) -> PackSourceKind {
    match f {
        PackFormat::Mrpack => PackSourceKind::Modrinth,
        PackFormat::Curseforge => PackSourceKind::Curseforge,
        PackFormat::Vlpack => PackSourceKind::Vlpack,
        PackFormat::Prism | PackFormat::Multimc => PackSourceKind::Prism,
    }
}

pub(crate) struct ResolvedCf {
    pub(crate) files: Vec<PackFile>,
    pub(crate) missing: Vec<MissingEntry>,
    pub(super) warnings: Vec<String>,
}

/// CurseForge-Manifest auflösen: Datei-Infos + Projekte (Klasse -> Zielordner).
pub(crate) async fn resolve_cf(state: &AppState, refs: &[CfRef]) -> AppResult<ResolvedCf> {
    let refs: Vec<&CfRef> = refs.iter().filter(|r| r.required).collect();
    let file_ids: Vec<u64> = refs.iter().map(|r| r.file_id).collect();
    let mod_ids: Vec<u64> = refs.iter().map(|r| r.project_id).collect::<HashSet<_>>().into_iter().collect();
    let files: HashMap<u64, cf::CfFile> = cf::raw_files_by_id(state, &file_ids).await?.into_iter().map(|f| (f.id, f)).collect();
    let mods: HashMap<u64, cf::CfMod> = cf::raw_mods(state, &mod_ids).await?.into_iter().map(|m| (m.id, m)).collect();
    let mut out = ResolvedCf { files: vec![], missing: vec![], warnings: vec![] };
    for r in refs {
        let Some(f) = files.get(&r.file_id) else {
            out.warnings.push(format!("CurseForge-Datei {} (Projekt {}) nicht gefunden", r.file_id, r.project_id));
            continue;
        };
        let m = mods.get(&r.project_id);
        let kind = cf::kind_of_class(m.and_then(|m| m.class_id));
        let file_name = crate::paths::sanitize_file_name(&f.file_name);
        let path = format!("{}/{file_name}", kind.folder());
        match f.download_url.clone().filter(|u| !u.is_empty()) {
            Some(url) => out.files.push(PackFile {
                path,
                url,
                sha1: f.sha1(),
                size: Some(f.file_length).filter(|s| *s > 0),
                origin: Some((Source::Curseforge, r.project_id.to_string(), r.file_id.to_string())),
                side: crate::content::sides::from_cf_versions(&f.game_versions),
            }),
            None => out.missing.push(crate::content::missing::entry_for_cf_file(
                f,
                &m.map(|m| m.name.clone()).unwrap_or_else(|| format!("Projekt {}", r.project_id)),
                m.map(|m| cf::file_page_url(m, r.file_id)).unwrap_or_else(|| format!("https://www.curseforge.com/projects/{}", r.project_id)),
                kind,
            )),
        }
    }
    Ok(out)
}

pub(crate) async fn set_icon_bytes(state: &AppState, instance_id: &str, bytes: &[u8]) -> AppResult<()> {
    let ext = match crate::content::meta::image_mime(bytes) {
        Some("image/png") => "png",
        Some("image/jpeg") => "jpg",
        Some("image/gif") => "gif",
        Some("image/webp") => "webp",
        _ => return Ok(()),
    };
    let dest = state.paths.instance_dir(instance_id).join(format!("icon.{ext}"));
    tokio::fs::write(&dest, bytes).await?;
    let s = dest.to_string_lossy().to_string();
    state.instances.modify(instance_id, |i| i.icon = Some(s))?;
    Ok(())
}
