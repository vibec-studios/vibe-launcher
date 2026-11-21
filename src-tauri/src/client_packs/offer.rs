use super::*;

#[derive(Debug, Clone, Serialize, Default)]
pub struct PackInstall {
    pub version: Option<String>,
    pub files: Vec<String>,
    pub mc_version: Option<String>,
    pub loader: Option<String>,
    pub installed_at: Option<i64>,
    /// Datei in der Inhalte-Liste deaktiviert
    pub disabled_by_user: bool,
    /// Datei fehlt (z. B. von Hand gelöscht oder Version passte nicht mehr)
    pub missing: bool,
    /// Instanz hat inzwischen eine andere MC-Version/einen anderen Loader
    pub mismatch: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PackOffer {
    pub id: &'static str,
    pub category: Category,
    /// "norisk" | "modrinth"
    pub source: &'static str,
    pub group: Option<&'static str>,
    pub vendor: Option<&'static str>,
    pub homepage: Option<&'static str>,
    /// Modrinth-Projekte des Packs
    pub projects: Vec<&'static str>,
    /// Passt zur Instanz? `None` = unbekannt (Quelle nicht erreichbar)
    pub available: Option<bool>,
    /// Warum nicht: "loader" | "version" | "unreachable"
    pub reason: Option<&'static str>,
    pub error: Option<String>,
    /// Unterstützte MC-Versionen für den Loader (Hinweis bei „passt nicht“)
    pub mc_versions: Vec<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub installed: Option<PackInstall>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PacksOverview {
    pub mc_version: String,
    pub loader: LoaderKind,
    pub vibe_enabled: bool,
    pub packs: Vec<PackOffer>,
}

pub(super) fn base_offer(d: &PackDef) -> PackOffer {
    PackOffer {
        id: d.id,
        category: d.category,
        source: d.source.kind(),
        group: d.group,
        vendor: d.vendor,
        homepage: d.homepage,
        projects: match d.source {
            PackSource::Modrinth(p) => p.iter().map(|(id, _)| *id).collect(),
            _ => vec![],
        },
        available: None,
        reason: None,
        error: None,
        mc_versions: vec![],
        latest_version: None,
        update_available: false,
        installed: None,
    }
}

/// Packs mit Verfügbarkeit für Minecraft-Version + Loader, bei `instance` zusätzlich mit Installationsstand.
pub async fn overview(state: &AppState, instance: Option<&Instance>, mc: &str, loader: LoaderKind) -> PacksOverview {
    let vibe_enabled = state.settings().vibe.enabled;
    let futs = PACKS.iter().map(|d| offer(state, d, instance, mc, loader));
    let packs = futures::future::join_all(futs).await;
    PacksOverview { mc_version: mc.to_string(), loader, vibe_enabled, packs }
}

pub(super) async fn offer(state: &AppState, d: &'static PackDef, instance: Option<&Instance>, mc: &str, loader: LoaderKind) -> PackOffer {
    let mut o = base_offer(d);
    let loader_ok = d.loaders.contains(&loader);
    if !loader_ok {
        o.available = Some(false);
        o.reason = Some("loader");
    }
    match d.source {
        PackSource::Norisk(flavor) => {
            let rec = instance.and_then(|i| load(state, &i.id).get(d.id).cloned().map(|r| (i, r)));
            if let Some((inst, r)) = &rec {
                let file = r.files.first().and_then(|f| find_file(state, &inst.id, f));
                o.installed = Some(PackInstall {
                    version: r.version.as_deref().map(|v| norisk::display_version(v).to_string()),
                    files: r.files.clone(),
                    mc_version: Some(r.mc_version.clone()),
                    loader: Some(r.loader.clone()),
                    installed_at: Some(r.installed_at),
                    disabled_by_user: file.as_ref().is_some_and(|(_, on)| !on),
                    missing: file.is_none(),
                    mismatch: r.mc_version != inst.mc_version || Some(r.loader.as_str()) != norisk::loader_name(inst.loader.kind),
                });
            }
            if !loader_ok {
                return o;
            }
            match norisk::list(false).await {
                Ok(list) => {
                    o.mc_versions = list.mc_versions(flavor, loader);
                    let entry = list.select(flavor, mc, loader);
                    o.available = Some(entry.is_some());
                    if entry.is_none() {
                        o.reason = Some("version");
                    }
                    if let (Some(e), Some((_, r))) = (entry, &rec) {
                        // Update nur für installierte Packs prüfen (ein GET ohne Weiterleitung, kein Download)
                        match norisk::latest_file(e).await {
                            Ok(f) => {
                                o.latest_version = norisk::version_from_file(&f, flavor).map(|v| norisk::display_version(&v).to_string());
                                o.update_available = r.files.first() != Some(&f);
                            }
                            Err(err) => o.error = Some(err.to_string()),
                        }
                    }
                    if let Some(i) = o.installed.as_mut() {
                        if i.mismatch || i.missing {
                            o.update_available = entry.is_some();
                        }
                    }
                }
                Err(e) => {
                    o.reason = Some("unreachable");
                    o.error = Some(e.to_string());
                }
            }
        }
        PackSource::Modrinth(projects) => {
            if let Some(inst) = instance {
                if let Some(r) = load(state, &inst.id).get(d.id) {
                    let idx = ContentIndex::load(&state.paths, &inst.id);
                    if present(state, &inst.id, r, &idx) {
                        // Version der (ersten) Pack-Mod aus dem Inhalts-Index (folgt auch normalen Updates)
                        let version = r.projects.iter().find_map(|pid| idx.files.values().find(|e| e.source == Source::Modrinth && &e.project_id == pid).and_then(|e| e.version_number.clone()));
                        o.installed = Some(PackInstall {
                            version,
                            files: r.files.clone(),
                            mc_version: Some(r.mc_version.clone()),
                            loader: Some(r.loader.clone()),
                            installed_at: Some(r.installed_at),
                            disabled_by_user: false,
                            missing: false,
                            mismatch: r.mc_version != inst.mc_version,
                        });
                    }
                }
            }
            if !loader_ok {
                return o;
            }
            let checks = projects.iter().map(|(p, _)| async move {
                provider::versions_for(state, Source::Modrinth, p, Some(mc), Some(loader)).await.map(|(list, pref, _)| provider::pick_best(&list, pref.as_deref()).is_some())
            });
            let res = futures::future::join_all(checks).await;
            if let Some(Err(e)) = res.iter().find(|r| r.is_err()) {
                o.reason = Some("unreachable");
                o.error = Some(e.to_string());
            } else {
                let all = res.iter().all(|r| matches!(r, Ok(true)));
                o.available = Some(all);
                if !all {
                    o.reason = Some("version");
                }
            }
        }
    }
    o
}
