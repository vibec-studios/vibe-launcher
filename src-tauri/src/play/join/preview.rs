use super::*;

pub(super) fn loader_kind(s: &str) -> AppResult<LoaderKind> {
    serde_json::from_value(serde_json::Value::String(s.to_string())).map_err(|_| AppError::Invalid(format!("Unbekannter Loader: {s}")))
}

pub(super) fn source_of(s: &str) -> Option<Source> {
    Source::parse(s).filter(|s| matches!(s, Source::Modrinth | Source::Curseforge))
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct JoinPreview {
    /// Vorhandene passende Instanz
    pub instance_id: Option<String>,
    pub instance_name: Option<String>,
    /// Neue Instanz wird angelegt
    pub create: bool,
    pub pack_title: Option<String>,
    pub pack_icon: Option<String>,
    pub pack_version: Option<String>,
    /// Zu installierende Inhalte (ohne die des Modpacks)
    pub mods: usize,
    /// Dateien des Modpacks
    pub pack_files: usize,
    /// Client-Pack, das noch installiert wird (ID)
    pub client_pack: Option<String>,
    /// Ungefähre Downloadgröße (ohne Minecraft selbst); None = unbekannt
    pub download_bytes: Option<u64>,
    /// Minecraft selbst muss noch geladen werden
    pub game_download: bool,
    /// Gesperrte CurseForge-Dateien (Titel), die man selbst herunterladen muss
    pub manual: Vec<String>,
    /// Problem, das das Beitreten verhindert: version_unavailable | pack_unavailable | curseforge_unavailable | loader_unsupported
    pub problem: Option<String>,
    pub problem_detail: Option<String>,
    /// Vibe-Pack am Link: vorhandene Instanz wird auf die Version des Links aktualisiert (mit Sicherung)
    pub pack_update: bool,
    /// Bisherige Version dieser Instanz (bei `pack_update`)
    pub pack_from_version: Option<String>,
    /// Das Modpack kommt als geteiltes Vibe-Pack
    pub vibe_pack: bool,
}

pub(super) fn problem(p: &mut JoinPreview, kind: &str, detail: impl Into<String>) {
    p.problem = Some(kind.into());
    p.problem_detail = Some(detail.into());
}

/// Was passiert beim Beitreten? Prüft Versionen und schätzt die Größe.
pub async fn preview(state: &AppState, link: &PlayLink) -> AppResult<JoinPreview> {
    let mut p = JoinPreview::default();
    let kind = match loader_kind(&link.loader.kind) {
        Ok(k) => k,
        Err(e) => {
            problem(&mut p, "loader_unsupported", e.to_string());
            return Ok(p);
        }
    };
    if let Some(vp) = link.vibe_pack.as_ref() {
        if !vp.available {
            problem(&mut p, "pack_unavailable", format!("Das Modpack {} ist nicht mehr verfügbar.", vp.name));
            return Ok(p);
        }
        return vibe_preview(state, link, p).await;
    }
    let matched = find_match(state, link);
    let idx = matched.as_ref().map(|i| ContentIndex::load(&state.paths, &i.id)).unwrap_or_default();
    p.instance_id = matched.as_ref().map(|i| i.id.clone());
    p.instance_name = matched.as_ref().map(|i| i.name.clone());
    p.create = matched.is_none();
    p.game_download = matched.as_ref().map_or(true, |i| i.install_state != crate::instance::InstallState::Installed);
    let needs_cf = link.pack.as_ref().is_some_and(|x| x.source == "curseforge") || link.mods.iter().any(|m| m.source == "curseforge");
    if needs_cf && !cf::available(state) {
        problem(&mut p, "curseforge_unavailable", "CurseForge ist in diesem Launcher nicht eingerichtet.");
        return Ok(p);
    }

    // Minecraft- und Loader-Version vorhanden?
    let manifest = crate::minecraft::meta::manifest(state, false).await?;
    if !manifest.versions.iter().any(|v| v.id == link.mc_version) {
        problem(&mut p, "version_unavailable", format!("Minecraft {} ist nicht verfügbar.", link.mc_version));
        return Ok(p);
    }
    if kind != LoaderKind::Vanilla && link.pack.is_none() && matched.is_none() {
        let list = crate::minecraft::loaders::loader_versions(state, kind, &link.mc_version).await.unwrap_or_default();
        if list.is_empty() {
            problem(&mut p, "version_unavailable", format!("{} gibt es nicht für Minecraft {}.", link.loader.kind, link.mc_version));
            return Ok(p);
        }
    }

    let mut bytes: u64 = 0;
    let mut known = true;
    // Modpack
    if let (Some(pack), true) = (&link.pack, matched.is_none()) {
        match pack_preview(state, pack).await {
            Ok(pp) => {
                p.pack_title = pp.title;
                p.pack_icon = pp.icon;
                p.pack_version = pp.version;
                p.pack_files = pp.files;
                p.manual.extend(pp.manual);
                match pp.bytes {
                    Some(b) => bytes += b,
                    None => known = false,
                }
            }
            Err(e) => {
                problem(&mut p, "pack_unavailable", e.to_string());
                return Ok(p);
            }
        }
    } else if let Some(pack) = &link.pack {
        p.pack_title = pack.title.clone();
    }
    // Zusätzliche Inhalte (bei Modpack-Instanzen: was über das Pack hinausgeht – nach der Installation geprüft)
    let wanted: Vec<&LinkMod> = if link.pack.is_some() && matched.is_none() { link.mods.iter().collect() } else { missing_mods(link, &idx) };
    if link.pack.is_none() || matched.is_some() {
        p.mods = wanted.len();
        let (b, k, manual) = mods_size(state, &wanted).await;
        bytes += b;
        known &= k;
        p.manual.extend(manual);
    }
    // Client-Pack
    if let Some(cp) = link.client_pack.as_deref().filter(|c| crate::client_packs::def(c).is_some_and(|d| d.loaders.contains(&kind))) {
        let has = matched.as_ref().is_some_and(|i| crate::client_packs::installed_ids(state, &i.id).iter().any(|x| x == cp));
        if !has {
            p.client_pack = Some(cp.to_string());
        }
    }
    p.download_bytes = known.then_some(bytes);
    Ok(p)
}

pub(super) async fn vibe_preview(state: &AppState, link: &PlayLink, mut p: JoinPreview) -> AppResult<JoinPreview> {
    let Some(vp) = link.vibe_pack.clone() else { return Ok(p) };
    p.vibe_pack = true;
    p.pack_title = Some(vp.name.clone()).filter(|n| !n.is_empty());
    p.pack_version = Some(vp.version.clone()).filter(|v| !v.is_empty());
    p.pack_files = vp.file_count as usize;
    let matched = find_match(state, link);
    let update = if matched.is_none() { find_vibe_update(state, link) } else { None };
    let target = matched.as_ref().or(update.as_ref());
    p.instance_id = target.map(|i| i.id.clone());
    p.instance_name = target.map(|i| i.name.clone());
    p.create = target.is_none();
    p.pack_update = update.is_some();
    p.pack_from_version = update.as_ref().and_then(|i| i.source.as_ref()?.version_name.clone());
    p.game_download = target.map_or(true, |i| i.install_state != crate::instance::InstallState::Installed) || p.pack_update;
    let idx = matched.as_ref().map(|i| ContentIndex::load(&state.paths, &i.id)).unwrap_or_default();
    if matched.is_some() {
        let wanted = missing_mods(link, &idx);
        p.mods = wanted.len();
        let (b, k, manual) = mods_size(state, &wanted).await;
        p.download_bytes = k.then_some(b);
        p.manual = manual;
    }
    if let Ok(kind) = loader_kind(&link.loader.kind) {
        if let Some(cp) = link.client_pack.as_deref().filter(|c| crate::client_packs::def(c).is_some_and(|d| d.loaders.contains(&kind))) {
            let has = target.is_some_and(|i| crate::client_packs::installed_ids(state, &i.id).iter().any(|x| x == cp));
            if !has {
                p.client_pack = Some(cp.to_string());
            }
        }
    }
    Ok(p)
}

pub(super) struct PackPreview {
    pub(super) title: Option<String>,
    pub(super) icon: Option<String>,
    pub(super) version: Option<String>,
    pub(super) files: usize,
    pub(super) bytes: Option<u64>,
    pub(super) manual: Vec<String>,
}

pub(super) async fn pack_preview(state: &AppState, pack: &LinkPack) -> AppResult<PackPreview> {
    let src = source_of(&pack.source).ok_or_else(|| AppError::Invalid("Unbekannte Modpack-Quelle".into()))?;
    let brief = crate::content::provider::brief(state, src, &pack.project_id).await?;
    let mut out = PackPreview { title: Some(brief.title.clone()), icon: brief.icon_url.clone(), version: None, files: 0, bytes: None, manual: vec![] };
    match src {
        Source::Modrinth => {
            let v = mr::raw_version(state, &pack.version_id).await.map_err(|_| AppError::NotFound(format!("Die Modpack-Version von {} ist nicht mehr verfügbar.", brief.title)))?;
            out.version = Some(v.version_number.clone());
            let file = v.files.iter().find(|f| f.primary && f.filename.ends_with(".mrpack")).or_else(|| v.files.iter().find(|f| f.filename.ends_with(".mrpack")));
            if let Some(f) = file.filter(|f| f.size < 64 * 1024 * 1024) {
                let data = state.net.get_bytes(&f.url).await?;
                let l = import::pack_listing(&data)?;
                out.files = l.mr_sizes.len();
                out.bytes = l.mr_sizes.iter().all(Option::is_some).then(|| l.mr_sizes.iter().flatten().sum::<u64>() + l.overrides_bytes);
            }
        }
        Source::Curseforge => {
            let f = cf::raw_file(state, &pack.project_id, &pack.version_id).await.map_err(|_| AppError::NotFound(format!("Die Modpack-Version von {} ist nicht mehr verfügbar.", brief.title)))?;
            out.version = Some(f.display_name.clone());
            let Some(url) = f.download_url.clone().filter(|_| f.file_length < 128 * 1024 * 1024) else {
                return Err(AppError::msg(format!("Der Autor von {} erlaubt keine Downloads über andere Launcher.", brief.title)));
            };
            let data = state.net.get_bytes(&url).await?;
            let l = import::pack_listing(&data)?;
            out.files = l.cf_files.len();
            let ids: Vec<u64> = l.cf_files.iter().map(|x| x.1).collect();
            let files = cf::raw_files_by_id(state, &ids).await.unwrap_or_default();
            let (bytes, manual) = cf_sizes(state, &files).await;
            out.bytes = Some(bytes + l.overrides_bytes);
            out.manual = manual;
        }
        Source::Store(_) => {}
    }
    Ok(out)
}

/// Größe der CurseForge-Dateien; gesperrte ohne Modrinth-Spiegel -> Titel für „selbst herunterladen“.
pub(super) async fn cf_sizes(state: &AppState, files: &[cf::CfFile]) -> (u64, Vec<String>) {
    let bytes = files.iter().map(|f| f.file_length).sum();
    let locked: Vec<&cf::CfFile> = files.iter().filter(|f| f.locked()).collect();
    if locked.is_empty() {
        return (bytes, vec![]);
    }
    let sha1s: Vec<String> = locked.iter().filter_map(|f| f.sha1()).collect();
    let mirrors = mr::mirrors(state, &sha1s).await;
    let still: Vec<&cf::CfFile> = locked.into_iter().filter(|f| !f.sha1().is_some_and(|h| mirrors.contains_key(&h))).collect();
    let ids: Vec<u64> = still.iter().map(|f| f.mod_id).collect();
    let names = cf::raw_mods(state, &ids).await.unwrap_or_default();
    let manual = still
        .iter()
        .map(|f| names.iter().find(|m| m.id == f.mod_id).map(|m| m.name.clone()).unwrap_or_else(|| f.display_name.clone()))
        .collect();
    (bytes, manual)
}

/// Größe der Inhalte aus dem Link (nur mit Versions-ID bekannt) -> (Bytes, alles bekannt, manuelle Downloads).
pub(super) async fn mods_size(state: &AppState, mods: &[&LinkMod]) -> (u64, bool, Vec<String>) {
    let mut known = true;
    let mut bytes = 0;
    let mr_ids: Vec<String> = mods.iter().filter(|m| m.source == "modrinth").filter_map(|m| m.version_id.clone()).collect();
    if mods.iter().any(|m| m.version_id.is_none()) {
        known = false;
    }
    if !mr_ids.is_empty() {
        match mr::raw_versions_batch(state, &mr_ids).await {
            Ok(list) => {
                if list.len() < mr_ids.len() {
                    known = false;
                }
                bytes += list.iter().filter_map(|v| v.files.iter().find(|f| f.primary).or(v.files.first())).map(|f| f.size).sum::<u64>();
            }
            Err(_) => known = false,
        }
    }
    let cf_ids: Vec<u64> = mods.iter().filter(|m| m.source == "curseforge").filter_map(|m| m.version_id.as_deref()?.parse().ok()).collect();
    let mut manual = vec![];
    if !cf_ids.is_empty() && cf::available(state) {
        let files = cf::raw_files_by_id(state, &cf_ids).await.unwrap_or_default();
        if files.len() < cf_ids.len() {
            known = false;
        }
        let (b, m) = cf_sizes(state, &files).await;
        bytes += b;
        manual = m;
    }
    (bytes, known, manual)
}
