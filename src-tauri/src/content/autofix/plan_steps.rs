use super::*;

/// Index der aktiven Mods für die Paarliste (`conflicts.toml`).
pub(super) fn mod_index(scanned: &[local::Scanned], gone: &HashSet<String>) -> crash::ModIndex {
    let mut m = crash::ModIndex::default();
    for s in scanned.iter().filter(|s| s.enabled && !gone.contains(&s.file_name)) {
        let e = crash::ModEntry { file: s.file_name.clone(), name: s.meta.name.clone(), version: s.meta.version.clone() };
        match &s.meta.mod_id {
            Some(id) => m.add(id, e),
            None => m.files.push(s.file_name.clone()),
        }
    }
    m
}

/// Bekannte unverträgliche Paare als Schritt „eine von beiden deaktivieren“ (nur nach Rückfrage).
pub(super) fn known_pair_steps(scanned: &[local::Scanned], gone: &HashSet<String>, b: &mut Builder) {
    for h in crash::known_pairs(&mod_index(scanned, gone)) {
        let taken = b.steps.iter().any(|s| matches!(&s.action, FixAction::Disable { file_name } if file_name == &h.a_file || file_name == &h.b_file));
        if taken {
            continue;
        }
        if let Some(s) = b.step(
            "known_pair",
            &h.a_name,
            vec![],
            FixAction::Disable { file_name: h.a_file.clone() },
            Some((FixAction::Disable { file_name: h.b_file.clone() }, h.b_name.clone())),
            true,
            None,
        ) {
            s.detail = Some(h.source);
        }
    }
}

/// Loader-Bedarf als Schritte bzw. Hinweise.
pub(super) fn loader_steps(inst: &Instance, need: Vec<LoaderNeed>, b: &mut Builder) {
    let kind = inst.loader.kind;
    let label = crate::minecraft::loaders::loader_name(kind);
    for n in need {
        match n {
            LoaderNeed::Set { from, to, reason, required_by, detail } => {
                if let Some(s) = b.step(reason, label, required_by, FixAction::SetLoader { loader: kind, from, to }, None, false, None) {
                    s.detail = detail;
                }
            }
            LoaderNeed::Repair { version, reason, detail } => {
                if let Some(s) = b.step(reason, label, vec![], FixAction::RepairLoader { loader: kind, version }, None, false, None) {
                    s.detail = detail;
                }
            }
            LoaderNeed::Unfixable { reason, detail } => b.unfixable.push(Unfixable { reason: reason.into(), name: label.into(), detail, cause: None }),
        }
    }
}

/// Installierte Modrinth-Mods, deren Version eine andere installierte Mod als inkompatibel markiert.
pub(super) async fn known_conflicts(
    state: &AppState,
    scanned: &[local::Scanned],
    idx: &ContentIndex,
    names: &HashMap<String, String>,
    gone: &HashSet<String>,
    b: &mut Builder,
) -> AppResult<()> {
    // Projekt -> aktive Datei
    let mut by_project: HashMap<String, String> = HashMap::new();
    let mut vids: Vec<(String, String)> = vec![];
    for s in scanned.iter().filter(|s| s.enabled && !gone.contains(&s.file_name)) {
        if let Some(e) = idx.files.get(&index::key("mods", &s.file_name)) {
            if e.source == Source::Modrinth {
                by_project.insert(e.project_id.clone(), s.file_name.clone());
                vids.push((e.version_id.clone(), s.file_name.clone()));
            }
        }
    }
    if vids.len() < 2 {
        return Ok(());
    }
    let ids: Vec<String> = vids.iter().map(|(v, _)| v.clone()).collect();
    let versions = mr::raw_versions_batch(state, &ids).await?;
    let file_of: HashMap<&str, &str> = vids.iter().map(|(v, f)| (v.as_str(), f.as_str())).collect();
    let name = |f: &str| names.get(f).cloned().unwrap_or_else(|| display_name(f));
    for c in conflicts_of(&versions, &file_of, &by_project) {
        let (me, other) = c;
        let taken = b.steps.iter().any(|s| matches!(&s.action, FixAction::Disable { file_name } if file_name == &other || file_name == &me));
        if taken {
            continue;
        }
        b.step(
            "known_conflict",
            &name(&other),
            vec![],
            FixAction::Disable { file_name: other.clone() },
            Some((FixAction::Disable { file_name: me.clone() }, name(&me))),
            true,
            None,
        );
    }
    Ok(())
}

/// Konfliktpaare (Datei der markierenden Mod, Datei der markierten Mod), jedes Paar nur einmal.
pub(super) fn conflicts_of(versions: &[mr::MrVersion], file_of: &HashMap<&str, &str>, by_project: &HashMap<String, String>) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = vec![];
    for v in versions {
        let Some(me) = file_of.get(v.id.as_str()) else { continue };
        for d in v.dependencies.iter().filter(|d| d.dependency_type == "incompatible") {
            let Some(other) = d.project_id.as_ref().and_then(|p| by_project.get(p)) else { continue };
            if other == me || out.iter().any(|(a, b)| (a == me && b == other) || (a == other && b == me)) {
                continue;
            }
            out.push((me.to_string(), other.clone()));
        }
    }
    out
}
