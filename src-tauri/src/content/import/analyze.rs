use super::*;

pub(super) fn read_zip_file<R: std::io::Read + std::io::Seek>(zip: &mut zip::ZipArchive<R>, name: &str) -> Option<Vec<u8>> {
    let mut f = zip.by_name(name).ok()?;
    if f.size() > 64 * 1024 * 1024 {
        return None;
    }
    let mut v = Vec::new();
    f.read_to_end(&mut v).ok()?;
    Some(v)
}

pub(super) fn json_of<T: serde::de::DeserializeOwned>(bytes: &[u8], what: &str) -> AppResult<T> {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    serde_json::from_slice(bytes).map_err(|e| AppError::Invalid(format!("{what} ist fehlerhaft: {e}")))
}

/// Dateien eines Modpacks ohne Installation (Vorschau bei Spiel-Links): mrpack -> Größen je Datei,
/// CurseForge -> (Projekt-ID, Datei-ID) der Pflicht-Dateien. Dazu die Größe der Overrides im Archiv.
#[derive(Debug, Default)]
pub struct PackListing {
    pub mr_sizes: Vec<Option<u64>>,
    pub cf_files: Vec<(u64, u64)>,
    pub overrides_bytes: u64,
}

pub fn pack_listing(bytes: &[u8]) -> AppResult<PackListing> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| AppError::Invalid("Das Modpack ist kein gültiges ZIP-Archiv".into()))?;
    let mut out = PackListing::default();
    if let Some(b) = read_zip_file(&mut zip, "modrinth.index.json") {
        let idx: MrIndex = json_of(&b, "modrinth.index.json")?;
        out.mr_sizes = idx
            .files
            .iter()
            .filter(|f| !f.env.as_ref().and_then(|e| e.get("client")).is_some_and(|c| c == "unsupported"))
            .map(|f| f.file_size)
            .collect();
    } else if let Some(b) = read_zip_file(&mut zip, "manifest.json") {
        let m: CfManifest = json_of(&b, "manifest.json")?;
        out.cf_files = m.files.iter().filter(|f| f.required).map(|f| (f.project_id, f.file_id)).collect();
    } else {
        return Err(AppError::Invalid("Unbekanntes Modpack-Format".into()));
    }
    for i in 0..zip.len() {
        if let Ok(f) = zip.by_index_raw(i) {
            if f.name().contains("overrides/") {
                out.overrides_bytes += f.size();
            }
        }
    }
    Ok(out)
}

/// Datei analysieren (blockierend).
pub fn analyze(path: &Path) -> AppResult<PackPlan> {
    let f = std::fs::File::open(path).map_err(|e| AppError::NotFound(format!("{} ({e})", path.display())))?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(f)).map_err(|_| AppError::Invalid("Die Datei ist kein gültiges ZIP-Archiv / Modpack".into()))?;
    let names: Vec<String> = zip.file_names().map(str::to_string).collect();
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Import".into());

    if let Some(b) = read_zip_file(&mut zip, "modrinth.index.json") {
        let idx: MrIndex = json_of(&b, "modrinth.index.json")?;
        let mc = idx.dependencies.get("minecraft").cloned().ok_or_else(|| AppError::Invalid("mrpack ohne Minecraft-Version".into()))?;
        let mut files = Vec::new();
        for f in idx.files {
            if f.env.as_ref().and_then(|e| e.get("client")).is_some_and(|c| c == "unsupported") {
                continue;
            }
            check_rel(&f.path)?;
            let Some(url) = f.downloads.iter().find(|u| u.starts_with("https://") || u.starts_with("http://")).cloned() else {
                tracing::warn!("mrpack: {} ohne Download-URL übersprungen", f.path);
                continue;
            };
            let origin = modrinth_ids_from_url(&url).map(|(p, v)| (Source::Modrinth, p, v));
            let side = f.env.as_ref().map(|e| crate::content::sides::from_sides(e.get("client").map(String::as_str), e.get("server").map(String::as_str)));
            files.push(PackFile { path: f.path, url, sha1: f.hashes.get("sha1").cloned(), size: f.file_size, origin, side });
        }
        return Ok(PackPlan {
            format: PackFormat::Mrpack,
            name: if idx.name.trim().is_empty() { stem } else { idx.name },
            version_name: idx.version_id,
            author: None,
            loader: loader_from_mrpack(&idx.dependencies),
            mc_version: mc,
            icon: read_zip_file(&mut zip, "icon.png").filter(|b| crate::content::meta::image_mime(b).is_some()),
            overrides: vec!["overrides/".into(), "client-overrides/".into()],
            files,
            cf_files: vec![],
            prism: None,
            embedded_mods: 0,
        });
    }

    if let Some(b) = read_zip_file(&mut zip, "vlpack.json") {
        let p: VlPack = json_of(&b, "vlpack.json")?;
        if p.format_version > 1 {
            return Err(AppError::Invalid(format!("vlpack-Format {} wird von dieser Launcher-Version nicht unterstützt – bitte Launcher aktualisieren", p.format_version)));
        }
        let mut files = Vec::new();
        for f in p.files {
            check_rel(&f.path)?;
            let origin = match f.source.as_str() {
                "modrinth" => f.project_id.clone().zip(f.version_id.clone()).map(|(a, b)| (Source::Modrinth, a, b)),
                "curseforge" => f.project_id.clone().zip(f.file_id.clone().or(f.version_id.clone())).map(|(a, b)| (Source::Curseforge, a, b)),
                _ => None,
            };
            files.push(PackFile { path: f.path, url: f.url, sha1: f.sha1, size: f.size, origin, side: None });
        }
        let icon = p.icon.as_deref().and_then(|i| read_zip_file(&mut zip, i)).filter(|b| crate::content::meta::image_mime(b).is_some());
        return Ok(PackPlan {
            format: PackFormat::Vlpack,
            name: p.name,
            version_name: p.version,
            author: p.author,
            mc_version: p.mc_version,
            loader: p.loader,
            icon,
            overrides: vec!["overrides/".into()],
            files,
            cf_files: vec![],
            prism: None,
            embedded_mods: 0,
        });
    }

    if let Some(b) = read_zip_file(&mut zip, "manifest.json") {
        if let Ok(m) = json_of::<CfManifest>(&b, "manifest.json") {
            let lid = m.minecraft.mod_loaders.iter().find(|l| l.primary).or(m.minecraft.mod_loaders.first()).map(|l| l.id.clone());
            let loader = lid.map(|id| loader_from_cf_id(&id, &m.minecraft.version)).unwrap_or(Loader { kind: LoaderKind::Vanilla, version: None });
            let ov = m.overrides.clone().filter(|o| !o.trim().is_empty()).unwrap_or_else(|| "overrides".into());
            check_rel(&ov)?;
            return Ok(PackPlan {
                format: PackFormat::Curseforge,
                name: if m.name.trim().is_empty() { stem } else { m.name },
                version_name: m.version,
                author: m.author.filter(|a| !a.is_empty()),
                mc_version: m.minecraft.version,
                loader,
                icon: None,
                overrides: vec![format!("{}/", ov.trim_end_matches('/'))],
                files: vec![],
                cf_files: m.files.iter().map(|f| CfRef { project_id: f.project_id, file_id: f.file_id, required: f.required }).collect(),
                prism: None,
                embedded_mods: 0,
            });
        }
    }

    // Prism/MultiMC: instance.cfg im Wurzelordner oder eine Ebene tiefer
    let cfg_name = names
        .iter()
        .filter(|n| n.ends_with("instance.cfg") && (n.as_str() == "instance.cfg" || (n.matches('/').count() == 1 && n.ends_with("/instance.cfg"))))
        .min_by_key(|n| n.len())
        .cloned();
    if let Some(cfg_name) = cfg_name {
        let root = cfg_name.strip_suffix("instance.cfg").unwrap_or("").to_string();
        let cfg_text = String::from_utf8_lossy(&read_zip_file(&mut zip, &cfg_name).unwrap_or_default()).to_string();
        let pack = read_zip_file(&mut zip, &format!("{root}mmc-pack.json"));
        let info = prism_info(&cfg_text, pack.as_deref());
        if info.mc_version.is_empty() {
            return Err(AppError::Invalid("Prism/MultiMC-Export ohne Minecraft-Version (mmc-pack.json fehlt)".into()));
        }
        let game = [".minecraft/", "minecraft/"].iter().map(|g| format!("{root}{g}")).find(|g| names.iter().any(|n| n.starts_with(g.as_str())));
        let embedded_mods = game.as_ref().map(|g| names.iter().filter(|n| n.starts_with(&format!("{g}mods/")) && n.ends_with(".jar")).count() as u32).unwrap_or(0);
        let icon = info
            .icon_key
            .as_ref()
            .and_then(|k| read_zip_file(&mut zip, &format!("{root}{k}.png")))
            .filter(|b| crate::content::meta::image_mime(b).is_some());
        return Ok(PackPlan {
            format: info.format,
            name: info.name.unwrap_or(stem),
            version_name: None,
            author: None,
            mc_version: info.mc_version,
            loader: info.loader,
            icon,
            overrides: game.into_iter().collect(),
            files: vec![],
            cf_files: vec![],
            prism: Some(info.settings),
            embedded_mods,
        });
    }

    Err(AppError::Invalid(
        "Unbekanntes Format. Unterstützt werden .mrpack, CurseForge-Modpacks (.zip), .vlpack und Prism-/MultiMC-Exporte.".into(),
    ))
}

pub async fn preview(path: &str) -> AppResult<ImportPreview> {
    let p = PathBuf::from(path);
    let plan = tokio::task::spawn_blocking(move || analyze(&p)).await??;
    Ok(ImportPreview {
        format: plan.format,
        file_count: plan.file_count(),
        icon: plan.icon.as_deref().and_then(crate::content::meta::data_url),
        name: plan.name,
        version_name: plan.version_name,
        mc_version: plan.mc_version,
        loader: plan.loader,
        files: plan
            .files
            .iter()
            .map(|f| ImportFile {
                path: f.path.clone(),
                side: f.side.unwrap_or(if f.path.starts_with("resourcepacks/") || f.path.starts_with("shaderpacks/") { Side::Client } else { Side::Unknown }),
            })
            .collect(),
        author: plan.author,
    })
}
