use super::*;

pub(super) fn g<'t>(c: &Captures<'t>, name: &str) -> Option<&'t str> {
    [name.to_string(), format!("{name}2"), format!("{name}3")]
        .iter()
        .find_map(|n| c.name(n).map(|m| m.as_str().trim()))
        .filter(|s| !s.is_empty())
}

/// Fehlende Abhängigkeit: liegt sie deaktiviert in `mods/`, heißt die Lösung „aktivieren“ statt „installieren“.
pub(super) fn missing_dependency(mods: &ModIndex, conf: u8, dep_id: &str, ids: &[&str], dep_name: Option<&str>) -> Diagnosis {
    let d = Diagnosis::new("missing_dependency", conf).param("dependency", dep_id);
    let off = std::iter::once(dep_id).chain(ids.iter().copied()).find_map(|i| mods.disabled.get(&i.to_ascii_lowercase()));
    match off {
        Some(e) => {
            let name = e.name.clone().or_else(|| dep_name.map(Into::into));
            d.param("dependency_name", name.as_deref().unwrap_or(dep_id))
                .param("disabled_file", &e.file)
                .action(Action::EnableMod { file: e.file.clone(), name })
        }
        None => d
            .param("dependency_name", dep_name.unwrap_or(dep_id))
            .action(Action::InstallDependency { mod_id: dep_id.into(), name: dep_name.map(Into::into) }),
    }
}

/// Mod-IDs in einem Textstück, in Reihenfolge des Auftretens (from mod X, Mixin-Configs, Handler-Namen, Pakete).
pub(super) fn mods_in(s: &str, mods: &ModIndex) -> Vec<String> {
    static FROM: OnceLock<Regex> = OnceLock::new();
    static CFG: OnceLock<Regex> = OnceLock::new();
    static HANDLER: OnceLock<Regex> = OnceLock::new();
    static CLASS: OnceLock<Regex> = OnceLock::new();
    let from = FROM.get_or_init(|| re(r"from mod ([\w\-]+)"));
    let cfg = CFG.get_or_init(|| re(r"([\w\-.]*mixins?[\w\-.]*\.json)"));
    let handler = HANDLER.get_or_init(|| re(r"(?:handler|redirect|modify|localvar|wrapOperation|wrapWithCondition|constant|inject)\$[a-z0-9]{6}\$([a-z][a-z0-9_]*)\$"));
    let class = CLASS.get_or_init(|| re(r"\b([a-z][\w]*(?:\.[a-z][\w]*){2,}\.[\w$]+)"));
    let mut found: Vec<(usize, String)> = vec![];
    for c in from.captures_iter(s) {
        found.push((c.get(1).unwrap().start(), c[1].to_ascii_lowercase()));
    }
    for c in cfg.captures_iter(s) {
        let name = c[1].to_ascii_lowercase();
        if name.contains("refmap") {
            continue;
        }
        let id = mods.mixins.get(&name).cloned().or_else(|| {
            // Ohne Index: „betterclouds.mixins.json“ / „mixins.sodium.json“ / „sodium-common.mixins.json“
            let stem = name.trim_end_matches(".json").trim_end_matches(".mixins").trim_end_matches(".mixin").trim_start_matches("mixins.").trim_end_matches("-mixins");
            let stem = stem.split(['.']).next().unwrap_or(stem);
            let cand = stem.trim_end_matches("-common").trim_end_matches("-client").trim_end_matches("-fabric").trim_end_matches("-forge").trim_end_matches("-neoforge");
            (!cand.is_empty() && cand != "mixins").then(|| cand.to_string())
        });
        if let Some(id) = id {
            found.push((c.get(1).unwrap().start(), id));
        }
    }
    for c in handler.captures_iter(s) {
        found.push((c.get(1).unwrap().start(), c[1].to_string()));
    }
    if !mods.packages.is_empty() {
        for c in class.captures_iter(s) {
            if let Some((_, id)) = mods.packages.iter().filter(|(p, _)| c[1].starts_with(p.as_str())).max_by_key(|(p, _)| p.len()) {
                found.push((c.get(1).unwrap().start(), id.clone()));
            }
        }
    }
    found.sort_by_key(|(p, _)| *p);
    let mut out: Vec<String> = vec![];
    for (_, id) in found {
        // Mod-ID im Index bevorzugen (Config-Name ≈ Mod-ID)
        let id = if mods.by_id.contains_key(&id) { id } else { mods.by_id.keys().find(|k| k.replace(['-', '_'], "") == id.replace(['-', '_'], "")).cloned().unwrap_or(id) };
        if !out.contains(&id) && !is_builtin(&id) {
            out.push(id);
        }
    }
    out
}

/// Pfad unter `config/` aus einer Fundstelle (absolut oder relativ), normalisiert und ohne `..`.
pub(super) fn config_path(s: &str) -> Option<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let r = RE.get_or_init(|| re(r#"(?i)(?:^|[^\w])config[\\/](?P<rel>[^\s'"()\[\],;]+?\.(?:json5|jsonc|json|toml|cfg|conf|properties|yaml|yml|txt|snbt|ini))\b"#));
    let rel = r.captures(s)?.name("rel")?.as_str().replace('\\', "/");
    safe_rel(&rel).map(|r| format!("config/{r}"))
}

pub(super) fn safe_rel(rel: &str) -> Option<String> {
    let rel = rel.trim_start_matches("./");
    if rel.is_empty() || rel.starts_with('/') || rel.contains(':') || rel.split('/').any(|p| p.is_empty() || p == "..") {
        return None;
    }
    Some(rel.to_string())
}
