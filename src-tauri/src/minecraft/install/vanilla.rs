use super::*;

/// Vanilla-Dateien: Client-JAR, Libraries, Logging-Config, Asset-Index + Objekte.
pub(super) async fn install_vanilla_files(state: &AppState, r: &Resolved, game_dir: &Path, force: bool, sp: &SubProgress) -> AppResult<(PathBuf, Option<PathBuf>)> {
    let env = Env::current();
    let paths = &state.paths;
    let VanillaItems { items, log_config, index_path } = vanilla_items(paths, r, &env);
    sp.message("Spieldateien werden geladen …");
    download(state, items, force, &sp.sub(0.0, 0.35)).await?;
    sp.check()?;

    let mut game_assets = paths.assets();
    if let (Some(a), Some(p)) = (&r.asset_index, &index_path) {
        let idx = read_asset_index(p).await?;
        sp.message("Assets werden geladen …");
        download(state, asset_items(paths, &idx), force, &sp.sub(0.35, 0.95)).await?;
        sp.check()?;
        game_assets = materialize_assets(paths, &a.id, &idx, game_dir).await?;
    }
    sp.progress(1.0);
    Ok((game_assets, log_config))
}

/// Alte Natives (`natives`-Klassifizierer) entpacken.
pub(super) fn extract_natives(r: &Resolved, libs_dir: &Path, dir: &Path, force: bool) -> AppResult<()> {
    let env = Env::current();
    let mut list = Vec::new();
    for l in &r.libraries {
        if let Some(n) = l.native_artifact(libs_dir, &env) {
            let excl = l.extract.as_ref().map(|e| e.exclude.clone()).unwrap_or_default();
            list.push((n.path, excl));
        }
    }
    std::fs::create_dir_all(dir)?;
    let sig: String = list
        .iter()
        .map(|(p, _)| format!("{}:{}", p.display(), p.metadata().map(|m| m.len()).unwrap_or(0)))
        .collect::<Vec<_>>()
        .join("\n");
    let marker = dir.join(".vibe-natives");
    if !force && std::fs::read_to_string(&marker).ok().as_deref() == Some(sig.as_str()) {
        return Ok(());
    }
    for (jar, exclude) in &list {
        let f = std::fs::File::open(jar).map_err(|e| AppError::msg(format!("Natives fehlen ({}): {e}", jar.display())))?;
        let mut z = zip::ZipArchive::new(f)?;
        for i in 0..z.len() {
            let mut e = z.by_index(i)?;
            let name = e.name().to_string();
            if e.is_dir() || name.starts_with("META-INF/") || exclude.iter().any(|x| name.starts_with(x.as_str())) {
                continue;
            }
            let Some(out) = crate::util::safe_join(dir, &name) else { continue };
            if out.metadata().map(|m| m.len() == e.size()).unwrap_or(false) {
                continue;
            }
            if let Some(p) = out.parent() {
                std::fs::create_dir_all(p)?;
            }
            let res = std::fs::File::create(&out).and_then(|mut w| std::io::copy(&mut e, &mut w).map(|_| ()));
            if let Err(err) = res {
                // Datei evtl. von laufendem Spiel gesperrt – vorhandene Datei behalten
                if !out.exists() {
                    return Err(err.into());
                }
                tracing::warn!("Native {} nicht überschreibbar: {err}", out.display());
            }
        }
    }
    std::fs::write(&marker, sig)?;
    Ok(())
}

/// Client-JAR unter dem Namen der Profil-Version bereitstellen (Forge 1.17+ erwartet `${version_name}.jar`).
pub(super) fn link_client_jar(paths: &crate::paths::Paths, r: &Resolved) -> AppResult<PathBuf> {
    if let Some(j) = &r.jar {
        let p = paths.version_jar(j);
        if p.is_file() {
            return Ok(p);
        }
    }
    let base = paths.version_jar(&r.base_id);
    if r.id == r.base_id {
        return Ok(base);
    }
    let target = paths.version_jar(&r.id);
    let base_len = base.metadata().map(|m| m.len()).map_err(|_| AppError::msg("Minecraft-JAR fehlt"))?;
    if target.metadata().map(|m| m.len() == base_len).unwrap_or(false) {
        return Ok(target);
    }
    if let Some(p) = target.parent() {
        std::fs::create_dir_all(p)?;
    }
    let _ = std::fs::remove_file(&target);
    if std::fs::hard_link(&base, &target).is_err() {
        std::fs::copy(&base, &target)?;
    }
    Ok(target)
}
