use super::*;

/// Liste für das Frontend (Zuordnung unbekannter Dateien läuft im Hintergrund weiter).
pub async fn list(state: &AppState, instance_id: &str, kind: ContentKind) -> AppResult<Vec<ContentItem>> {
    let (scanned, idx) = scan(state, instance_id, kind).await?;
    let (p, e) = pending(&scanned, &idx, cf::available(state));
    identify_in_background(state, instance_id, p, e);
    items(state, &scanned, &idx, kind).await
}

/// Scannen + Zuordnung abwarten (vor Installationen/Updates/Exporten, damit der Index aktuell ist).
pub async fn refresh(state: &AppState, instance_id: &str, kind: ContentKind) -> AppResult<(Vec<Scanned>, ContentIndex)> {
    let (scanned, idx) = scan(state, instance_id, kind).await?;
    let (p, e) = pending(&scanned, &idx, cf::available(state));
    if p.is_empty() && e.is_empty() {
        return Ok((scanned, idx));
    }
    match identify(state, instance_id, p, e).await {
        Ok(_) => {}
        Err(err) => tracing::warn!("Hash-Zuordnung fehlgeschlagen: {err}"),
    }
    let idx = ContentIndex::load(&state.paths, instance_id);
    Ok((scanned, idx))
}

pub(super) fn check_file_name(name: &str) -> AppResult<()> {
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." || name.contains(':') {
        return Err(AppError::Invalid(format!("Ungültiger Dateiname: {name}")));
    }
    Ok(())
}

pub async fn set_enabled(state: &AppState, instance_id: &str, kind: ContentKind, file_name: &str, enabled: bool) -> AppResult<ContentItem> {
    crate::content::migration::guard(state, instance_id)?;
    check_file_name(file_name)?;
    let dir = state.paths.game_dir(instance_id).join(kind.folder());
    let src = dir.join(file_name);
    if !src.exists() {
        return Err(AppError::NotFound(format!("Datei {file_name}")));
    }
    let base = index::strip_disabled(file_name).to_string();
    let new_name = if enabled { base.clone() } else { format!("{base}.disabled") };
    if new_name != file_name {
        let dst = dir.join(&new_name);
        if dst.exists() {
            return Err(AppError::Invalid(format!("{new_name} existiert bereits")));
        }
        tokio::fs::rename(&src, &dst).await?;
    }
    let (scanned, idx) = scan(state, instance_id, kind).await?;
    state.content.emit_changed(instance_id);
    let s = scanned.iter().find(|s| s.file_name == new_name).ok_or_else(|| AppError::NotFound(new_name.clone()))?;
    Ok(to_item(s, &idx, kind, &icons_dir(state)))
}

pub async fn remove(state: &AppState, instance_id: &str, kind: ContentKind, file_names: &[String]) -> AppResult<()> {
    crate::content::migration::guard(state, instance_id)?;
    state.instances.get(instance_id)?;
    let dir = state.paths.game_dir(instance_id).join(kind.folder());
    for n in file_names {
        check_file_name(n)?;
        let p = dir.join(n);
        if p.is_dir() {
            tokio::fs::remove_dir_all(&p).await?;
        } else if p.exists() {
            tokio::fs::remove_file(&p).await?;
        }
    }
    {
        let lock = state.content.lock(instance_id);
        let _g = lock.lock().await;
        let mut idx = ContentIndex::load(&state.paths, instance_id);
        for n in file_names {
            let k = index::key(kind.folder(), n);
            // Nur entfernen, wenn keine aktivierte/deaktivierte Variante mehr existiert
            let base = index::strip_disabled(n);
            if !dir.join(base).exists() && !dir.join(format!("{base}.disabled")).exists() {
                idx.files.remove(&k);
                idx.local.remove(&k);
            }
        }
        idx.save(&state.paths, instance_id)?;
    }
    state.content.emit_changed(instance_id);
    Ok(())
}

pub async fn add_files(state: &AppState, instance_id: &str, kind: ContentKind, paths: &[String]) -> AppResult<Vec<ContentItem>> {
    crate::content::migration::guard(state, instance_id)?;
    state.instances.get(instance_id)?;
    let dir = state.paths.game_dir(instance_id).join(kind.folder());
    let mut added: Vec<String> = Vec::new();
    for p in paths {
        let src = PathBuf::from(p);
        let name = src.file_name().map(|n| n.to_string_lossy().to_string()).ok_or_else(|| AppError::Invalid(format!("Ungültiger Pfad: {p}")))?;
        let is_dir = src.is_dir();
        if !src.exists() {
            return Err(AppError::NotFound(p.clone()));
        }
        if !accepts(kind, &name, is_dir) {
            let hint = match kind {
                ContentKind::Mod => "Mods müssen .jar-Dateien sein",
                _ => "Erwartet wird eine .zip-Datei oder ein Ordner",
            };
            return Err(AppError::Invalid(format!("{name}: {hint}")));
        }
        let dst = dir.join(&name);
        if dst == src {
            added.push(name);
            continue;
        }
        let dir2 = dir.clone();
        tokio::task::spawn_blocking(move || -> std::io::Result<()> {
            std::fs::create_dir_all(&dir2)?;
            if is_dir {
                if dst.exists() {
                    std::fs::remove_dir_all(&dst)?;
                }
                crate::util::copy_dir_all(&src, &dst)
            } else {
                let tmp = dst.with_extension("part");
                std::fs::copy(&src, &tmp)?;
                std::fs::rename(&tmp, &dst)
            }
        })
        .await??;
        added.push(name);
    }
    let (scanned, idx) = refresh(state, instance_id, kind).await?;
    state.content.emit_changed(instance_id);
    let icons = icons_dir(state);
    Ok(scanned.iter().filter(|s| added.contains(&s.file_name)).map(|s| to_item(s, &idx, kind, &icons)).collect())
}
