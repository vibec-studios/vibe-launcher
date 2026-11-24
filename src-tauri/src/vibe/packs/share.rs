use super::*;

/// Instanz exportieren und als (neue Version eines) geteilten Packs hochladen. Liefert das `Pack` des Backends.
pub async fn share(state: &AppState, instance_id: &str, token: &str, opts: ShareOptions) -> AppResult<Value> {
    let base = ensure(state, Feature::Sharing)?;
    let inst = state.instances.get(instance_id)?;
    crate::custom_loader::block(&inst, "Das Teilen als Pack")?;
    if let Some(c) = &opts.code {
        if !valid_code(c) {
            return Err(AppError::Invalid("Ungültiger Pack-Code".into()));
        }
    }
    let task = state.tasks.create("export", format!("{} teilen", inst.name), Some(instance_id.to_string()));
    let res = share_inner(state, &task, &base, instance_id, &inst.name, token, opts).await;
    let out = match &res {
        Ok(_) => Ok(()),
        Err(AppError::Cancelled) => Err(AppError::Cancelled),
        Err(e) => Err(AppError::msg(e.to_string())),
    };
    task.finish(out);
    res
}

pub(super) async fn share_inner(state: &AppState, task: &TaskHandle, base: &str, instance_id: &str, name: &str, token: &str, opts: ShareOptions) -> AppResult<Value> {
    let vlpack = tmp_path(state, "vlpack");
    let overrides = tmp_path(state, "zip");
    let _cleanup = TmpFiles(vec![vlpack.clone(), overrides.clone()]);

    // 1. Export (gleiche Auswahl wie im Export-Dialog vorbelegt)
    let include: Vec<String> = export::entries(state, instance_id).await?.into_iter().filter(|e| e.default_selected).map(|e| e.path).collect();
    let author = super::super::identity(state).map(|i| i.name);
    let version = opts.version.clone().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| {
        if opts.code.is_some() {
            chrono::Local::now().format("%Y.%m.%d-%H%M").to_string()
        } else {
            "1.0.0".into()
        }
    });
    let eo = ExportOptions {
        format: PackFormat::Vlpack,
        dest: vlpack.to_string_lossy().into_owned(),
        name: name.to_string(),
        version,
        author,
        description: opts.description.clone(),
        include,
    };
    export::run_export(state.clone(), task.clone(), instance_id.to_string(), eo).await?;
    task.check()?;

    // 2. Zerlegen: Manifest, Icon, Overrides-ZIP
    task.stage("Bereite Upload vor …", Some(0.85));
    let (vp, op) = (vlpack.clone(), overrides.clone());
    let parts = tokio::task::spawn_blocking(move || split_vlpack(&vp, &op)).await??;
    task.check()?;

    // 3. Upload
    task.stage("Lade hoch …", Some(0.9));
    let mut form = reqwest::multipart::Form::new();
    if opts.code.is_none() {
        let vis = match opts.visibility.as_deref() {
            Some(v @ ("public" | "unlisted" | "friends")) => v.to_string(),
            _ => "unlisted".into(),
        };
        form = form.text("visibility", vis);
        if let Some(d) = opts.description.filter(|d| !d.trim().is_empty()) {
            form = form.text("description", d);
        }
    }
    if let Some(c) = opts.changelog.filter(|d| !d.trim().is_empty()) {
        form = form.text("changelog", c);
    }
    form = form.text("manifest", parts.manifest);
    if parts.has_overrides {
        let bytes = tokio::fs::read(&overrides).await?;
        form = form.part("overrides", reqwest::multipart::Part::bytes(bytes).file_name("overrides.zip").mime_str("application/zip")?);
    }
    if let Some((bytes, mime)) = parts.icon {
        form = form.part("icon", reqwest::multipart::Part::bytes(bytes).file_name("icon.png").mime_str(mime)?);
    }
    let url = match &opts.code {
        Some(c) => format!("{base}/api/v1/packs/{c}/versions"),
        None => format!("{base}/api/v1/packs"),
    };
    let r = state.net.client.post(url).bearer_auth(token).multipart(form).timeout(Duration::from_secs(600)).send().await?;
    let status = r.status().as_u16();
    let body = r.text().await?;
    if !(200..300).contains(&status) {
        return Err(api_error(status, &body));
    }
    let pack: Value = serde_json::from_str(&body)?;
    if let Some(code) = pack["code"].as_str() {
        let link = ShareLink { code: code.to_string(), url: pack["url"].as_str().map(str::to_string) };
        let _ = crate::util::write_json_atomic(&link_file(state, instance_id), &link);
    }
    Ok(pack)
}

pub(super) struct Parts {
    pub(super) manifest: String,
    pub(super) icon: Option<(Vec<u8>, &'static str)>,
    pub(super) has_overrides: bool,
}

/// `.vlpack` in Manifest, Icon und Overrides-ZIP (ohne `overrides/`-Präfix) zerlegen.
pub(super) fn split_vlpack(vlpack: &Path, overrides_out: &Path) -> AppResult<Parts> {
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(std::fs::File::open(vlpack)?))?;
    let manifest = {
        let mut f = zip.by_name("vlpack.json").map_err(|_| AppError::msg("Export unvollständig (vlpack.json fehlt)"))?;
        let mut s = String::new();
        f.read_to_string(&mut s)?;
        s
    };
    let mv: Value = serde_json::from_str(&manifest)?;
    let icon = match mv["icon"].as_str() {
        Some(name) if !name.is_empty() => match zip.by_name(name) {
            Ok(mut f) if f.size() <= 1024 * 1024 => {
                let mut b = Vec::new();
                f.read_to_end(&mut b)?;
                image_mime(&b).map(|m| (b, m))
            }
            _ => None,
        },
        _ => None,
    };
    let mut out = zip::ZipWriter::new(std::io::BufWriter::new(std::fs::File::create(overrides_out)?));
    let mut n = 0usize;
    for i in 0..zip.len() {
        let f = zip.by_index_raw(i)?;
        let name = f.name().replace('\\', "/");
        let Some(rel) = name.strip_prefix("overrides/") else { continue };
        if rel.is_empty() {
            continue;
        }
        let rel = rel.to_string();
        out.raw_copy_file_rename(f, rel)?;
        n += 1;
    }
    out.finish()?;
    Ok(Parts { manifest, icon, has_overrides: n > 0 })
}

pub(crate) fn image_mime(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if b.starts_with(b"GIF8") {
        Some("image/gif")
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}
