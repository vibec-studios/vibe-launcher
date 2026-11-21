use super::*;

/// SHA-1 über Größe + RGBA-Pixel; nicht dekodierbar -> SHA-1 der Datei.
pub fn content_hash(png: &[u8]) -> String {
    match image::load_from_memory_with_format(png, image::ImageFormat::Png) {
        Ok(img) => {
            let rgba = img.to_rgba8();
            let mut h = Sha1::new();
            h.update(rgba.width().to_be_bytes());
            h.update(rgba.height().to_be_bytes());
            // Voll transparente Pixel vereinheitlichen (Farbwerte dort sind unsichtbar)
            for px in rgba.pixels() {
                if px.0[3] == 0 {
                    h.update([0u8; 4]);
                } else {
                    h.update(px.0);
                }
            }
            hex::encode(h.finalize())
        }
        Err(_) => hex::encode(Sha1::digest(png)),
    }
}

/// Bild-Hashes aller Bibliotheks-Skins.
pub(super) fn library_hashes(st: &AppState) -> HashSet<String> {
    st.auth
        .skins
        .list()
        .iter()
        .filter_map(|s| s.data_url.split_once(',').map(|x| x.1.to_string()))
        .filter_map(|b| base64::engine::general_purpose::STANDARD.decode(b).ok())
        .map(|png| content_hash(&png))
        .collect()
}

pub(super) fn found_from(src: ImportSource, raw: RawFound, png: Vec<u8>, have: &HashSet<String>, n: usize) -> Option<FoundSkin> {
    skins::validate_skin_png(&png).ok()?;
    let sha1 = content_hash(&png);
    Some(FoundSkin {
        key: format!("{}:{sha1}", src.as_str()),
        source: src,
        name: raw.name.unwrap_or_else(|| format!("{} {n}", src.label())),
        variant: raw.variant,
        cape_id: raw.cape_id,
        in_library: have.contains(&sha1),
        sha1,
        data_url: skins::data_url(&png),
    })
}

/// Alle installierten Quellen lesen (Lunar lädt die Bilder von Mojang, gecacht).
pub async fn scan(st: &AppState) -> ImportScan {
    let roots = Roots::system();
    let tmp = st.paths.cache().join("tmp");
    let raw: Vec<(ImportSource, PathBuf, AppResult<Vec<RawFound>>)> = {
        let tmp = tmp.clone();
        tokio::task::spawn_blocking(move || {
            ImportSource::ALL.iter().filter_map(|s| read_source(*s, &roots, &tmp).map(|(p, r)| (*s, p, r))).collect()
        })
        .await
        .unwrap_or_default()
    };
    let have = library_hashes(st);
    let cache = st.paths.cache().join("textures");
    let mut sources = Vec::new();
    for (src, path, res) in raw {
        let mut scan = SourceScan { source: src, label: src.label(), path: path.to_string_lossy().to_string(), skins: vec![], error: None };
        match res {
            Err(e) => scan.error = Some(e.to_string()),
            Ok(list) => {
                let mut seen = HashSet::new();
                let mut failed = 0;
                for (i, r) in list.into_iter().enumerate() {
                    let png = match (&r.png, &r.url) {
                        (Some(p), _) => p.clone(),
                        (None, Some(u)) => match skins::fetch_texture(&st.net.client, &cache, u).await {
                            Ok(b) => b,
                            Err(_) => {
                                failed += 1;
                                continue;
                            }
                        },
                        _ => continue,
                    };
                    if let Some(f) = found_from(src, r, png, &have, i + 1) {
                        // gleiche Textur in derselben Quelle nur einmal
                        if seen.insert(f.sha1.clone()) {
                            scan.skins.push(f);
                        }
                    }
                }
                if failed > 0 {
                    scan.error = Some(format!("{failed} Skin(s) konnten nicht von Mojang geladen werden."));
                }
            }
        }
        sources.push(scan);
    }
    // Gleiche Textur aus mehreren Quellen: nur beim ersten Vorkommen als neu zählen
    let mut counted = HashSet::new();
    let new_count = sources.iter().flat_map(|s| s.skins.iter()).filter(|f| !f.in_library && counted.insert(f.sha1.clone())).count();
    ImportScan { sources, new_count, auto_import: load_state(st).auto }
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
}

/// Ausgewählte Skins übernehmen (`keys = None` -> alle neuen). Duplikate (SHA-1) werden übersprungen.
pub async fn import(st: &AppState, keys: Option<Vec<String>>) -> AppResult<ImportResult> {
    let scan = scan(st).await;
    let wanted: Option<HashSet<String>> = keys.map(|k| k.into_iter().collect());
    let mut have = library_hashes(st);
    let mut res = ImportResult { imported: 0, skipped: 0 };
    let mut state = load_state(st);
    for f in scan.sources.iter().flat_map(|s| s.skins.iter()) {
        if wanted.as_ref().is_some_and(|w| !w.contains(&f.key)) {
            continue;
        }
        if !state.seen.contains(&f.key) {
            state.seen.push(f.key.clone());
        }
        if have.contains(&f.sha1) {
            res.skipped += 1;
            continue;
        }
        let b64 = f.data_url.split_once(',').map(|x| x.1).unwrap_or_default();
        let png = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| AppError::msg(e.to_string()))?;
        st.auth.skins.add_with(&png, &f.name, f.variant, Some(format!("import:{}", f.source.as_str())), f.cape_id.clone())?;
        have.insert(f.sha1.clone());
        res.imported += 1;
    }
    save_state(st, &state)?;
    Ok(res)
}

/// Beim Start: wenn eingeschaltet, nur noch nie gesehene Skins übernehmen.
pub async fn auto_import(st: &AppState) -> AppResult<usize> {
    let state = load_state(st);
    if !state.auto {
        return Ok(0);
    }
    let scan = scan(st).await;
    let fresh: Vec<String> = scan.sources.iter().flat_map(|s| s.skins.iter()).filter(|f| !state.seen.contains(&f.key)).map(|f| f.key.clone()).collect();
    if fresh.is_empty() {
        return Ok(0);
    }
    Ok(import(st, Some(fresh)).await?.imported)
}
