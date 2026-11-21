use super::*;

/// Status für die Oberfläche.
#[derive(Debug, Clone, Serialize)]
pub struct ClientStatus {
    pub enabled: bool,
    pub installed_version: Option<String>,
    pub file: Option<String>,
    /// Datei liegt in `mods/`
    pub present: bool,
    /// in der Inhalte-Liste deaktiviert (`.disabled`)
    pub disabled_by_user: bool,
    /// Loader der Instanz wird unterstützt (Fabric/NeoForge)
    pub loader_supported: bool,
    /// Passt ein Jar zur Instanz? `None` = unbekannt (offline / Dienste aus)
    pub supported: Option<bool>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    /// Unterstützte MC-Versionen für den Loader der Instanz
    pub mc_versions: Vec<String>,
    pub channel: String,
    pub vibe_enabled: bool,
    /// Fehler beim Abfragen des Manifests
    pub error: Option<String>,
    pub requires: Vec<String>,
}

pub async fn status(state: &AppState, id: &str) -> AppResult<ClientStatus> {
    let inst = state.instances.get(id)?;
    let s = load(state, id);
    let file = managed_file(state, id, &s);
    let loader = loader_name(inst.loader.kind);
    let vibe_enabled = state.settings().vibe.enabled;
    let mut out = ClientStatus {
        enabled: s.enabled,
        installed_version: file.as_ref().and(s.version.clone()),
        file: s.file.clone(),
        present: file.is_some(),
        disabled_by_user: file.as_ref().is_some_and(|(_, on)| !on),
        loader_supported: loader.is_some(),
        supported: if loader.is_none() { Some(false) } else { None },
        latest_version: None,
        update_available: false,
        mc_versions: vec![],
        channel: super::super::channel(state).to_string(),
        vibe_enabled,
        error: None,
        requires: s.requires.clone(),
    };
    if let (Some(l), true) = (loader, vibe_enabled) {
        match super::super::latest(state, false).await {
            Ok(rel) => {
                let f = rel.file_for(l, &inst.mc_version);
                out.supported = Some(f.is_some());
                out.mc_versions = rel.mc_versions(l);
                out.latest_version = Some(rel.version.clone());
                out.update_available = out.present && f.is_some_and(|f| Some(&f.sha256) != s.sha256.as_ref());
            }
            Err(e) => out.error = Some(e.to_string()),
        }
    }
    Ok(out)
}

/// Pflicht-Abhängigkeiten, die als Mod-ID erkannt werden können (falls die Datei nicht zugeordnet ist).
pub(super) fn known_mod_id(modrinth: &str) -> Option<&'static str> {
    match modrinth {
        "P7dR8mSH" => Some("fabric-api"),
        "Ha28R6CL" => Some("fabric-language-kotlin"),
        _ => None,
    }
}

/// Fehlende Pflicht-Abhängigkeiten über Modrinth installieren. Gibt die installierten IDs zurück.
pub(super) async fn ensure_requires(state: &AppState, inst: &Instance, file: &ClientFile, log: &(dyn Fn(String) + Sync), task: &TaskHandle) -> AppResult<Vec<String>> {
    let wanted: Vec<&str> = file.requires.iter().filter_map(|r| r.modrinth.as_deref()).filter(|s| !s.is_empty()).collect();
    if wanted.is_empty() {
        return Ok(vec![]);
    }
    let (scanned, idx) = local::refresh(state, &inst.id, ContentKind::Mod).await?;
    let missing: Vec<String> = wanted
        .into_iter()
        .filter(|pid| {
            if idx.has_project(Source::Modrinth, pid) {
                return false;
            }
            let mid = known_mod_id(pid);
            !scanned.iter().any(|s| mid.is_some_and(|m| s.meta.mod_id.as_deref() == Some(m) || s.meta.provides.iter().any(|p| p == m)))
        })
        .map(str::to_string)
        .collect();
    if missing.is_empty() {
        return Ok(vec![]);
    }
    let names: Vec<String> = file.requires.iter().filter(|r| r.modrinth.as_ref().is_some_and(|m| missing.contains(m))).map(|r| r.name.clone().unwrap_or_else(|| r.modrinth.clone().unwrap_or_default())).collect();
    task.stage(format!("Installiere {} …", names.join(", ")), None);
    let idx = ContentIndex::load(&state.paths, &inst.id);
    let mut warnings = Vec::new();
    let roots = missing.iter().map(|p| (Source::Modrinth, p.clone(), None)).collect();
    let planned = cinstall::plan(state, inst, &idx, roots, &mut warnings).await?;
    cinstall::apply(state, inst, planned, &task.sub(0.6, 0.95)).await?;
    for w in warnings {
        log(format!("Vibey Client: {w}"));
    }
    log(format!("Vibey Client: Abhängigkeiten installiert: {}", names.join(", ")));
    Ok(missing)
}

/// Passendes Jar installieren bzw. aktualisieren. `true`, wenn sich etwas geändert hat.
pub async fn sync(state: &AppState, id: &str, rel: &ClientRelease, task: &TaskHandle, log: &(dyn Fn(String) + Sync)) -> AppResult<bool> {
    let inst = state.instances.get(id)?;
    let loader = loader_name(inst.loader.kind).ok_or_else(|| AppError::Invalid("Der Vibey Client läuft nur mit Fabric oder NeoForge.".into()))?;
    let mut s = load(state, id);
    let current = managed_file(state, id, &s);
    let Some(file) = rel.file_for(loader, &inst.mc_version) else {
        // Instanz passt (nicht mehr): verwaltetes Jar entfernen, damit das Spiel nicht abstürzt
        if let Some((p, _)) = &current {
            let _ = tokio::fs::remove_file(p).await;
            s.file = None;
            s.version = None;
            s.sha256 = None;
            save(state, id, &s)?;
            state.content.emit_changed(id);
            log(format!("Vibey Client: entfernt – Minecraft {} mit {loader} wird nicht unterstützt", inst.mc_version));
        }
        return Err(AppError::NotFound(format!("Vibey Client {} unterstützt Minecraft {} mit {} nicht.", rel.version, inst.mc_version, loader_pretty(loader))));
    };
    let name = super::super::safe_file_name(&file.file, ".jar")?;
    let base = crate::vibe::ensure(state, crate::vibe::Feature::Any)?;
    let url = super::super::resolve_url(&base, &file.url)?;
    let up_to_date = current.is_some() && s.sha256.as_deref() == Some(file.sha256.as_str()) && s.file.as_deref() == Some(name.as_str());
    let mut changed = false;
    if !up_to_date {
        task.stage(format!("Vibey Client {} wird geladen …", rel.version), Some(0.1));
        let was_disabled = current.as_ref().is_some_and(|(_, on)| !on);
        let target = mods_dir(state, id).join(if was_disabled { format!("{name}.disabled") } else { name.clone() });
        let tmp = state.paths.tmp().join(format!("vibey-{}-{name}", chrono::Utc::now().timestamp_millis()));
        super::super::download_verified(state, &url, &tmp, &file.sha256, Some(file.size)).await?;
        tokio::fs::create_dir_all(mods_dir(state, id)).await?;
        if let Some((old, _)) = &current {
            if old != &target {
                let _ = tokio::fs::remove_file(old).await;
            }
        }
        move_file(&tmp, &target).await?;
        let old_version = s.version.clone();
        s.file = Some(name.clone());
        s.version = Some(rel.version.clone());
        s.sha256 = Some(file.sha256.clone());
        s.channel = Some(rel.channel.clone());
        s.mc_version = Some(inst.mc_version.clone());
        s.loader = Some(loader.to_string());
        s.installed_at = Some(chrono::Utc::now().timestamp_millis());
        save(state, id, &s)?;
        changed = true;
        match old_version {
            Some(v) if current.is_some() && v != rel.version => log(format!("Vibey Client aktualisiert: {v} → {}", rel.version)),
            _ => log(format!("Vibey Client {} installiert ({name})", rel.version)),
        }
    }
    task.check()?;
    let installed = ensure_requires(state, &inst, file, log, task).await?;
    if !installed.is_empty() {
        for i in installed {
            if !s.requires.contains(&i) {
                s.requires.push(i);
            }
        }
        save(state, id, &s)?;
        changed = true;
    }
    if changed {
        state.content.emit_changed(id);
    }
    Ok(changed)
}

pub(super) fn loader_pretty(l: &str) -> &'static str {
    if l == "neoforge" {
        "NeoForge"
    } else {
        "Fabric"
    }
}

pub(super) async fn move_file(from: &Path, to: &Path) -> AppResult<()> {
    if tokio::fs::rename(from, to).await.is_err() {
        tokio::fs::copy(from, to).await?;
        let _ = tokio::fs::remove_file(from).await;
    }
    Ok(())
}
