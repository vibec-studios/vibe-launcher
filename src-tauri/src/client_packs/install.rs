use super::*;

pub(super) fn ensure_idle(state: &AppState, id: &str) -> AppResult<()> {
    if state.game.is_running(id) {
        return Err(AppError::Invalid("Die Instanz läuft gerade – bitte zuerst beenden.".into()));
    }
    Ok(())
}

/// Prüfung vor dem Start der Aufgabe: Pack bekannt, Loader passt, Ausschluss bestätigt.
pub fn precheck(state: &AppState, instance_id: &str, pack_id: &str, replace: bool) -> AppResult<(Instance, &'static PackDef, Vec<String>)> {
    let inst = state.instances.get(instance_id)?;
    let d = def(pack_id).ok_or_else(|| AppError::NotFound(format!("Client-Pack {pack_id}")))?;
    if !d.loaders.contains(&inst.loader.kind) {
        return Err(AppError::Invalid("Dieses Pack passt nicht zum Loader der Instanz.".into()));
    }
    if d.source == PackSource::Vibey {
        crate::vibe::ensure(state, crate::vibe::Feature::Any)?;
    }
    ensure_idle(state, instance_id)?;
    let others = to_replace(pack_id, &installed_ids(state, instance_id));
    if !others.is_empty() && !replace {
        return Err(AppError::Invalid(format!("Nur ein Client gleichzeitig: zuerst {} entfernen.", others.join(", "))));
    }
    Ok((inst, d, others))
}

/// Pack installieren bzw. aktualisieren (Task-Körper). Andere Packs der Gruppe werden vorher entfernt.
pub async fn install(state: AppState, task: TaskHandle, instance_id: String, pack_id: String, replace: Vec<String>) -> AppResult<()> {
    let d = def(&pack_id).ok_or_else(|| AppError::NotFound(format!("Client-Pack {pack_id}")))?;
    for other in &replace {
        task.stage(format!("Entferne {} …", pretty(other)), Some(0.02));
        remove(&state, &instance_id, other).await?;
    }
    task.check()?;
    let inst = state.instances.get(&instance_id)?;
    match d.source {
        PackSource::Vibey => vibey_client::install::enable(state.clone(), task, instance_id).await,
        PackSource::Norisk(flavor) => install_norisk(&state, &task, &inst, d, flavor).await,
        PackSource::Modrinth(projects) => install_modrinth(&state, &task, &inst, d, projects).await,
    }
}

pub fn pretty(id: &str) -> &'static str {
    match id {
        "vibey" => "Vibey Client",
        "norisk" => "NoRisk Client",
        "norisk-mini" => "NoRisk Mini",
        "essential" => "Essential",
        _ => "Pack",
    }
}

pub(super) async fn install_norisk(state: &AppState, task: &TaskHandle, inst: &Instance, d: &PackDef, flavor: norisk::Flavor) -> AppResult<()> {
    task.stage("NoRisk-Downloadliste wird geladen …", Some(0.05));
    // Immer frisch: Liste und Jar direkt von NoRisk
    let list = norisk::list(true).await?;
    let entry = list.select(flavor, &inst.mc_version, inst.loader.kind).ok_or_else(|| {
        AppError::NotFound(format!("{} gibt es nicht für Minecraft {} mit {:?}.", flavor.name(), inst.mc_version, inst.loader.kind))
    })?;
    task.stage(format!("{} wird von norisk.gg geladen …", flavor.name()), Some(0.15));
    let (file, bytes) = norisk::download(entry, flavor).await?;
    task.check()?;
    ensure_idle(state, &inst.id)?;

    let mut st = load(state, &inst.id);
    let prev = st.get(d.id).cloned();
    let prev_file = prev.as_ref().and_then(|p| p.files.first()).and_then(|f| find_file(state, &inst.id, f));
    let was_disabled = prev_file.as_ref().is_some_and(|(_, on)| !on);
    let dir = mods_dir(state, &inst.id);
    tokio::fs::create_dir_all(&dir).await?;
    let target = dir.join(if was_disabled { format!("{file}.disabled") } else { file.clone() });
    // Unverändert schreiben (über eine versteckte Teildatei im selben Ordner)
    let tmp = dir.join(format!(".{file}.part"));
    tokio::fs::write(&tmp, &bytes).await?;
    if let Err(e) = tokio::fs::rename(&tmp, &target).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e.into());
    }
    if let Some((old, _)) = prev_file {
        if old != target {
            let _ = tokio::fs::remove_file(&old).await;
        }
    }
    let version = norisk::version_from_file(&file, flavor);
    st.upsert(InstalledPack {
        id: d.id.to_string(),
        version: version.clone(),
        files: vec![file.clone()],
        projects: vec![],
        mc_version: inst.mc_version.clone(),
        loader: norisk::loader_name(inst.loader.kind).unwrap_or("").to_string(),
        installed_at: crate::util::now_ms(),
        url: Some(entry.href.clone()),
    });
    save(state, &inst.id, &st)?;
    state.content.emit_changed(&inst.id);
    let v = version.as_deref().map(norisk::display_version).unwrap_or("?");
    let line = match prev.and_then(|p| p.version) {
        Some(old) if Some(&old) != version.as_ref() => format!("{} aktualisiert: {} → {v}", flavor.name(), norisk::display_version(&old)),
        _ => format!("{} {v} installiert ({file})", flavor.name()),
    };
    state.game.launcher_line(&inst.id, crate::minecraft::LogLevel::Launcher, line.clone());
    task.message(line);
    Ok(())
}

pub(super) async fn install_modrinth(state: &AppState, task: &TaskHandle, inst: &Instance, d: &PackDef, projects: &[(&str, &[&str])]) -> AppResult<()> {
    task.stage("Prüfe installierte Mods …", Some(0.05));
    let (scanned, idx) = local::refresh(state, &inst.id, ContentKind::Mod).await?;
    let has_mod = |mids: &[&str]| scanned.iter().any(|s| mids.iter().any(|m| s.meta.mod_id.as_deref() == Some(*m) || s.meta.provides.iter().any(|p| p == m)));
    let mut st = load(state, &inst.id);
    let mut owned = st.get(d.id).map(|p| p.projects.clone()).unwrap_or_default();
    // Schon vorhandene Mods bleiben, wie sie sind (und gehören nicht dem Pack)
    let roots: Vec<(Source, String, Option<String>)> = projects
        .iter()
        .filter(|(p, mids)| !idx.has_project(Source::Modrinth, p) && !has_mod(mids))
        .map(|(p, _)| (Source::Modrinth, p.to_string(), None))
        .collect();
    let mut files = st.get(d.id).map(|p| p.files.clone()).unwrap_or_default();
    if !roots.is_empty() {
        task.stage("Löse Abhängigkeiten auf …", Some(0.1));
        let mut warnings = Vec::new();
        let planned = cinstall::plan(state, inst, &idx, roots, &mut warnings).await?;
        task.check()?;
        // Nur die Pack-Projekte selbst gehören dem Pack; Abhängigkeiten bleiben beim Entfernen (andere Mods brauchen sie evtl.)
        let own: Vec<&str> = projects.iter().map(|(p, _)| *p).collect();
        for p in planned.iter().filter(|p| own.contains(&p.brief.id.as_str())) {
            if !owned.contains(&p.brief.id) {
                owned.push(p.brief.id.clone());
            }
            let f = crate::paths::sanitize_file_name(&p.file.filename);
            if !files.contains(&f) {
                files.push(f);
            }
        }
        task.stage(format!("Lade {} Mod(s) …", planned.len()), Some(0.2));
        cinstall::apply(state, inst, planned, &task.sub(0.2, 0.95)).await?;
        for w in warnings {
            tracing::warn!("Client-Pack {}: {w}", d.id);
        }
    }
    st.upsert(InstalledPack {
        id: d.id.to_string(),
        version: None,
        files,
        projects: owned,
        mc_version: inst.mc_version.clone(),
        loader: inst.loader.kind.as_str().to_string(),
        installed_at: crate::util::now_ms(),
        url: None,
    });
    save(state, &inst.id, &st)?;
    state.content.emit_changed(&inst.id);
    task.message(format!("{} installiert", pretty(d.id)));
    Ok(())
}

/// Pack entfernen: nur die Dateien/Projekte, die das Pack selbst angelegt hat.
pub async fn remove(state: &AppState, instance_id: &str, pack_id: &str) -> AppResult<()> {
    let d = def(pack_id).ok_or_else(|| AppError::NotFound(format!("Client-Pack {pack_id}")))?;
    state.instances.get(instance_id)?;
    ensure_idle(state, instance_id)?;
    if d.source == PackSource::Vibey {
        return vibey_client::install::disable(state, instance_id).await;
    }
    let mut st = load(state, instance_id);
    let Some(rec) = st.remove(pack_id) else { return Ok(()) };
    let mut names: Vec<String> = Vec::new();
    match d.source {
        PackSource::Modrinth(_) => {
            // Aktuelle Dateinamen über den Index (Updates ändern den Namen)
            let idx = ContentIndex::load(&state.paths, instance_id);
            for (k, e) in &idx.files {
                if e.source == Source::Modrinth && rec.projects.contains(&e.project_id) {
                    if let Some(name) = k.strip_prefix("mods/") {
                        for n in [name.to_string(), format!("{name}.disabled")] {
                            if mods_dir(state, instance_id).join(&n).exists() {
                                names.push(n);
                            }
                        }
                    }
                }
            }
        }
        _ => {
            for f in &rec.files {
                for n in [f.clone(), format!("{f}.disabled")] {
                    if mods_dir(state, instance_id).join(&n).exists() {
                        names.push(n);
                    }
                }
            }
        }
    }
    if !names.is_empty() {
        local::remove(state, instance_id, ContentKind::Mod, &names).await?;
    }
    save(state, instance_id, &st)?;
    state.content.emit_changed(instance_id);
    state.game.launcher_line(instance_id, crate::minecraft::LogLevel::Launcher, format!("{} entfernt", pretty(pack_id)));
    Ok(())
}
