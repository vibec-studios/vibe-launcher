use super::*;

/// Name einer neuen Instanz: Modpack-Titel bzw. „<Welt> (<Host>)“.
pub fn new_instance_name(link: &PlayLink) -> String {
    if let Some(t) = link.pack.as_ref().and_then(|p| p.title.clone()).filter(|t| !t.trim().is_empty()) {
        return t;
    }
    match link.world_name.as_deref().map(str::trim).filter(|w| !w.is_empty()) {
        Some(w) => format!("{w} ({})", link.host.name),
        None => format!("Welt von {}", link.host.name),
    }
}

/// Hinweis, wenn der Link ein Client-Pack nennt, das der Launcher nicht (mehr) anbietet.
pub fn skipped_pack_note(cp: &str) -> String {
    if cp == "vibey" {
        "Der Einladende nutzt den Vibey Client. Den gibt es nicht mehr – du trittst ohne ihn bei.".to_string()
    } else {
        format!("Client-Pack „{cp}“ ist unbekannt – du trittst ohne es bei.")
    }
}

/// Task-Körper: passende Instanz nehmen oder anlegen, Inhalte und Client-Pack installieren.
/// Setzt die Instanz der Aufgabe (`task.instance_id`), damit das Frontend danach starten kann.
pub async fn run_setup(state: AppState, task: TaskHandle, link: PlayLink, instance_id: Option<String>) -> AppResult<()> {
    let kind = loader_kind(&link.loader.kind)?;
    let vibe = link.vibe_pack.as_ref().filter(|v| v.available).cloned();
    let inst = match (instance_id, &vibe) {
        (Some(id), Some(vp)) => {
            let inst = state.instances.get(&id)?;
            if super::super::vibe_pack_match(vp, &inst) == Some(super::super::VibeMatch::OtherVersion) {
                task.stage(format!("Aktualisiere {} auf {} …", inst.name, vp.version), Some(0.02));
                let input = crate::content::modpack_from::PackInput::Vibe { code: vp.code.clone(), version_id: Some(vp.version_id.clone()), link: Some(link.code.clone()) };
                crate::content::modpack_from::run_update(state.clone(), task.clone(), inst.id.clone(), input).await?;
                state.instances.get(&id)?
            } else {
                inst
            }
        }
        (Some(id), None) => state.instances.get(&id)?,
        (None, Some(_)) => {
            let before: std::collections::HashSet<String> = state.instances.list().into_iter().map(|i| i.id).collect();
            crate::vibe::packs::install_from(state.clone(), task.clone(), crate::vibe::pack_fetch::PackOrigin::PlayLink { link: link.code.clone() }, None).await?;
            state
                .instances
                .list()
                .into_iter()
                .filter(|i| !before.contains(&i.id))
                .max_by_key(|i| i.created_at)
                .ok_or_else(|| AppError::msg("Die neue Instanz wurde nicht gefunden"))?
        }
        (None, None) => match &link.pack {
            Some(pack) => {
                let src = source_of(&pack.source).ok_or_else(|| AppError::Invalid("Unbekannte Modpack-Quelle".into()))?;
                let before: std::collections::HashSet<String> = state.instances.list().into_iter().map(|i| i.id).collect();
                import::run_modpack_install(state.clone(), task.clone(), src, pack.project_id.clone(), Some(pack.version_id.clone())).await?;
                state
                    .instances
                    .list()
                    .into_iter()
                    .filter(|i| !before.contains(&i.id))
                    .max_by_key(|i| i.created_at)
                    .ok_or_else(|| AppError::msg("Die neue Instanz wurde nicht gefunden"))?
            }
            None => {
                task.stage("Lege das Spiel an …", None);
                let loader_version = match (&link.loader.version, kind) {
                    (_, LoaderKind::Vanilla) => None,
                    (Some(v), _) => Some(v.clone()),
                    (None, k) => Some(crate::minecraft::loaders::default_loader_version(&state, k, &link.mc_version).await?),
                };
                state.instances.create(CreateInstance {
                    name: new_instance_name(&link),
                    mc_version: link.mc_version.clone(),
                    loader: Loader { kind, version: loader_version },
                    icon: None,
                    accent: None,
                    group: None,
                    custom_loader: None,
                })?
            }
        },
    };
    task.set_instance(inst.id.clone());
    task.set_title(format!("Einladung von {}: {}", link.host.name, inst.name));
    crate::events::emit(&state.app, crate::events::INSTANCE_CHANGED, &inst);
    task.check()?;

    // Fehlende Inhalte aus der Liste
    let (_, idx) = local::refresh(&state, &inst.id, crate::content::ContentKind::Mod).await?;
    let missing: Vec<(Source, String, Option<String>)> = missing_mods(&link, &idx)
        .into_iter()
        .filter_map(|m| Some((source_of(&m.source)?, m.project_id.clone(), m.version_id.clone())))
        .collect();
    let mut warnings = vec![];
    let mut manual = 0;
    if !missing.is_empty() {
        let n = missing.len();
        let chunks: Vec<_> = missing.chunks(100).map(|c| c.to_vec()).collect();
        let steps = chunks.len() as f64;
        for (i, roots) in chunks.into_iter().enumerate() {
            task.check()?;
            task.stage(format!("Installiere Inhalte ({}/{n}) …", (i * 100).min(n)), Some(0.1 + 0.8 * i as f64 / steps));
            let idx = ContentIndex::load(&state.paths, &inst.id);
            let planned = install::plan(&state, &inst, &idx, roots, &mut warnings).await?;
            let sub = task.sub(0.1 + 0.8 * i as f64 / steps, 0.1 + 0.8 * (i + 1) as f64 / steps);
            manual += install::apply(&state, &inst, planned, &sub).await?.len();
        }
        if manual > 0 {
            crate::content::missing::watch(&state, &inst.id, crate::content::missing::WATCH_FOR);
        }
    }
    for w in &warnings {
        tracing::warn!("Spiel-Link {}: {w}", link.code);
    }

    // Client-Pack – nicht kritisch
    if let Some(cp) = link.client_pack.as_deref().filter(|c| crate::client_packs::def(c).is_none()) {
        tracing::info!("Spiel-Link {}: Client-Pack {cp} wird nicht angeboten, Beitritt ohne", link.code);
        state.game.launcher_line(&inst.id, crate::minecraft::LogLevel::Launcher, skipped_pack_note(cp));
    } else if let Some(cp) = link.client_pack.as_deref() {
        let installed = crate::client_packs::installed_ids(&state, &inst.id);
        if !installed.iter().any(|x| x == cp) {
            match crate::client_packs::precheck(&state, &inst.id, cp, true) {
                Ok((_, _, others)) => {
                    task.stage(format!("Installiere {} …", crate::client_packs::pretty(cp)), Some(0.92));
                    if let Err(e) = crate::client_packs::install(state.clone(), task.clone(), inst.id.clone(), cp.to_string(), others).await {
                        tracing::warn!("Client-Pack {cp} für Spiel-Link nicht installiert: {e}");
                        warnings.push(format!("{}: {e}", crate::client_packs::pretty(cp)));
                    }
                }
                Err(e) => tracing::info!("Client-Pack {cp} passt nicht zu {}: {e}", inst.id),
            }
        }
    }
    task.set_title(format!("Einladung von {}: {}", link.host.name, inst.name));
    task.message(if manual > 0 { format!("Bereit – {manual} Datei(en) musst du noch selbst herunterladen") } else { "Bereit zum Beitreten".to_string() });
    crate::events::emit(&state.app, crate::events::INSTANCE_CHANGED, &inst);
    Ok(())
}
