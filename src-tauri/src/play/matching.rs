use super::*;

/// Passt eine vorhandene Instanz zum Link? Gleiches Modpack in gleicher Version bzw. gleiche Version + Loader mit allen
/// Inhalten. Liefert die Anzahl fehlender Inhalte (bei Modpacks: zusätzliche Inhalte des Hosts).
pub fn match_score(link: &PlayLink, inst: &Instance, idx: &ContentIndex) -> Option<usize> {
    if let Some(vp) = link.vibe_pack.as_ref().filter(|v| v.available) {
        return (vibe_pack_match(vp, inst)? == VibeMatch::Same).then_some(missing_mods(link, idx).len());
    }
    if inst.mc_version != link.mc_version || loader_kind_str(inst) != link.loader.kind {
        return None;
    }
    let missing = missing_mods(link, idx).len();
    match &link.pack {
        Some(p) => {
            let s = inst.source.as_ref()?;
            let kind_ok = matches!((s.kind, p.source.as_str()), (PackSourceKind::Modrinth, "modrinth") | (PackSourceKind::Curseforge, "curseforge"));
            (kind_ok && s.project_id.as_deref() == Some(p.project_id.as_str()) && s.version_id.as_deref() == Some(p.version_id.as_str())).then_some(missing)
        }
        None => {
            // Ohne Modpack: Loader-Version muss passen (wenn angegeben), und alle Inhalte müssen da sein
            if let (Some(want), Some(have)) = (&link.loader.version, &inst.loader.version) {
                if want != have {
                    return None;
                }
            }
            (missing == 0).then_some(0)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VibeMatch {
    Same,
    OtherVersion,
}

/// Stammt die Instanz aus demselben Vibe-Pack? `Same` = gleiche Version.
pub fn vibe_pack_match(vp: &LinkVibePack, inst: &Instance) -> Option<VibeMatch> {
    let s = inst.source.as_ref().filter(|s| s.kind == PackSourceKind::Vibe)?;
    if !s.project_id.as_deref().is_some_and(|c| c.eq_ignore_ascii_case(&vp.code)) {
        return None;
    }
    Some(if s.version_id.as_deref() == Some(vp.version_id.as_str()) { VibeMatch::Same } else { VibeMatch::OtherVersion })
}

/// Instanz aus demselben Vibe-Pack in anderer Version (zum Aktualisieren), zuletzt gespielt zuerst.
pub fn find_vibe_update(state: &AppState, link: &PlayLink) -> Option<Instance> {
    let vp = link.vibe_pack.as_ref().filter(|v| v.available)?;
    state
        .instances
        .list()
        .into_iter()
        .filter(|i| !i.is_bedrock() && vibe_pack_match(vp, i) == Some(VibeMatch::OtherVersion))
        .max_by_key(|i| i.last_played.unwrap_or(0))
}

/// Inhalte aus dem Link, die in der Instanz fehlen.
pub fn missing_mods<'a>(link: &'a PlayLink, idx: &ContentIndex) -> Vec<&'a LinkMod> {
    link.mods
        .iter()
        .filter(|m| Source::parse(&m.source).is_some_and(|s| matches!(s, Source::Modrinth | Source::Curseforge) && !idx.has_project(s, &m.project_id)))
        .collect()
}

/// Beste passende Instanz (wenigste fehlende Inhalte, zuletzt gespielt).
pub fn find_match(state: &AppState, link: &PlayLink) -> Option<Instance> {
    let mut best: Option<(usize, i64, Instance)> = None;
    for inst in state.instances.list().into_iter().filter(|i| !i.is_bedrock()) {
        let idx = ContentIndex::load(&state.paths, &inst.id);
        let Some(missing) = match_score(link, &inst, &idx) else { continue };
        let played = inst.last_played.unwrap_or(0);
        if best.as_ref().map_or(true, |(m, p, _)| missing < *m || (missing == *m && played > *p)) {
            best = Some((missing, played, inst));
        }
    }
    best.map(|b| b.2)
}
