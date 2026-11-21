use super::*;

/// Bestimmte Modrinth-Version installieren (Entdecken-Seite), mit Kompatibilitätsprüfung und Pflicht-Abhängigkeiten.
pub async fn install_modrinth_version(state: &Core, s: &Server, version_id: &str) -> AppResult<Vec<String>> {
    let t = target(s).ok_or_else(|| AppError::Invalid("Vanilla-Server haben keine Plugins oder Mods.".into()))?;
    let v = mr::raw_version(state, version_id).await?;
    if !v.loaders.iter().any(|l| t.loaders.contains(l)) {
        return Err(AppError::Invalid(format!("Diese Version passt nicht zur Server-Software ({}).", t.loaders.join("/"))));
    }
    if !t.mc.is_empty() && !v.game_versions.contains(&t.mc) {
        return Err(AppError::Invalid(format!("Diese Version ist nicht für Minecraft {}.", t.mc)));
    }
    let p = mr::raw_project(state, &v.project_id).await.ok();
    if !t.plugins && p.as_ref().and_then(|p| p.server_side.as_deref()) == Some("unsupported") {
        return Err(AppError::Invalid("Diese Mod läuft nur im Spiel (Client) und nicht auf einem Server.".into()));
    }
    let r = resolved_from(&v, p.as_ref())?;
    let installed = list(state, s).await?;
    let existing = installed.items.iter().find(|a| a.project_id.as_deref() == Some(r.project_id.as_str())).map(|a| a.file_name.clone());
    let mut out = vec![place(state, s, &t, &r, existing.as_deref()).await?];
    let have: HashSet<String> = installed.items.iter().filter_map(|a| a.project_id.clone()).collect();
    for d in r.deps.iter().filter(|d| !have.contains(*d)) {
        match install(state, s, AddonSource::Modrinth, d).await {
            Ok(mut f) => out.append(&mut f),
            Err(e) => tracing::warn!("Abhängigkeit {d} nicht installierbar: {e}"),
        }
    }
    Ok(out)
}

/// Projekt installieren (Modrinth: inkl. Pflicht-Abhängigkeiten). Gibt die neuen Dateinamen zurück.
pub async fn install(state: &Core, s: &Server, source: AddonSource, project: &str) -> AppResult<Vec<String>> {
    let t = target(s).ok_or_else(|| AppError::Invalid("Vanilla-Server haben keine Plugins oder Mods.".into()))?;
    let installed = list(state, s).await?;
    let mut have: HashSet<String> = installed.items.iter().filter_map(|a| a.project_id.clone()).collect();
    let mut out = Vec::new();
    let mut queue: Vec<(String, u8)> = vec![(project.to_string(), 0)];
    while let Some((pid, depth)) = queue.pop() {
        let r = match source {
            AddonSource::Hangar => resolve_hangar(state, &t, &pid, false).await?,
            AddonSource::Modrinth => match resolve_modrinth(state, &t, &pid).await {
                Ok(r) => r,
                // fehlende Abhängigkeit für diese Version: Hauptprojekt nicht blockieren
                Err(e) if depth > 0 => {
                    tracing::warn!("Abhängigkeit {pid} nicht installierbar: {e}");
                    continue;
                }
                Err(e) => return Err(e),
            },
        };
        // Schon installiert (gleiches Projekt) -> ersetzen, wenn es das Hauptprojekt ist
        let existing = installed.items.iter().find(|a| a.project_id.as_deref() == Some(r.project_id.as_str())).map(|a| a.file_name.clone());
        if depth > 0 && (existing.is_some() || have.contains(&r.project_id)) {
            continue;
        }
        out.push(place(state, s, &t, &r, existing.as_deref()).await?);
        have.insert(r.project_id.clone());
        if depth < 3 {
            for d in &r.deps {
                if !have.contains(d) {
                    queue.push((d.clone(), depth + 1));
                }
            }
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
pub struct AddonUpdate {
    pub file_name: String,
    pub source: AddonSource,
    pub project_id: String,
    pub current: Option<String>,
    pub latest: String,
}

/// Verfügbare Updates (nicht gecacht).
pub async fn updates(state: &Core, s: &Server) -> AppResult<Vec<AddonUpdate>> {
    let t = target(s).ok_or_else(|| AppError::Invalid("Vanilla-Server haben keine Plugins oder Mods.".into()))?;
    let l = list(state, s).await?;
    let mut out = Vec::new();
    let mr_items: Vec<&Addon> = l.items.iter().filter(|a| a.source == Some(AddonSource::Modrinth) && a.sha1.is_some()).collect();
    if !mr_items.is_empty() {
        let hashes: Vec<String> = mr_items.iter().filter_map(|a| a.sha1.clone()).collect();
        let latest = mr::latest_by_hash(state, &hashes, Some(&t.loaders), std::slice::from_ref(&t.mc)).await?;
        for a in mr_items {
            let h = a.sha1.as_deref().unwrap_or_default().to_ascii_lowercase();
            let Some(v) = latest.get(&h) else { continue };
            let same = v.files.iter().any(|f| f.hashes.sha1.as_deref().is_some_and(|x| x.eq_ignore_ascii_case(&h)));
            if !same && Some(v.id.as_str()) != a.version_id.as_deref() {
                out.push(AddonUpdate {
                    file_name: a.file_name.clone(),
                    source: AddonSource::Modrinth,
                    project_id: v.project_id.clone(),
                    current: a.version.clone(),
                    latest: v.version_number.clone(),
                });
            }
        }
    }
    let sdir = server_dir(&state.paths, &s.id);
    let idx = load_index(&sdir);
    for a in l.items.iter().filter(|a| a.source == Some(AddonSource::Hangar)) {
        let Some(e) = idx.get(base_name(&a.file_name)) else { continue };
        let Some(pid) = &e.project_id else { continue };
        match resolve_hangar(state, &t, pid, true).await {
            Ok(r) if Some(&r.version_name) != e.version_name.as_ref() => out.push(AddonUpdate {
                file_name: a.file_name.clone(),
                source: AddonSource::Hangar,
                project_id: pid.clone(),
                current: e.version_name.clone(),
                latest: r.version_name,
            }),
            Ok(_) => {}
            Err(err) => tracing::warn!("Hangar-Update für {pid}: {err}"),
        }
    }
    Ok(out)
}

/// Updates einspielen (`files = None` -> alle).
pub async fn apply_updates(state: &Core, s: &Server, files: Option<Vec<String>>) -> AppResult<usize> {
    let t = target(s).ok_or_else(|| AppError::Invalid("Vanilla-Server haben keine Plugins oder Mods.".into()))?;
    let ups = updates(state, s).await?;
    let mut n = 0;
    for u in ups.iter().filter(|u| files.as_ref().map_or(true, |f| f.contains(&u.file_name))) {
        let r = match u.source {
            AddonSource::Modrinth => resolve_modrinth(state, &t, &u.project_id).await?,
            AddonSource::Hangar => resolve_hangar(state, &t, &u.project_id, true).await?,
        };
        place(state, s, &t, &r, Some(&u.file_name)).await?;
        n += 1;
    }
    Ok(n)
}
