use super::*;

/// `disabled`: deaktivierte Mods (`.disabled`) – nur, um bei fehlenden Abhängigkeiten „aktivieren“ anzubieten.
pub(super) fn analyze(inst: &Instance, mods: &[ModInfo], disabled: &[ModInfo]) -> Vec<DepIssue> {
    let mut issues = Vec::new();
    let builtins = builtin_ids(inst);
    // ID -> deaktivierte Datei (eigene ID vor bereitgestellten IDs)
    let mut off: HashMap<&str, &Scanned> = HashMap::new();
    for m in disabled {
        off.insert(m.id, m.s);
    }
    for m in disabled {
        for p in &m.s.meta.provides {
            off.entry(p.as_str()).or_insert(m.s);
        }
    }
    // ID -> (Version, Datei) aller aktiven Mods inkl. bereitgestellter IDs
    let mut present: HashMap<&str, (Option<&str>, &Scanned)> = HashMap::new();
    let connector = mods.iter().any(|m| m.id == "connector");
    for m in mods {
        present.insert(m.id, (m.s.meta.version.as_deref(), m.s));
        // Eingebettete/bereitgestellte IDs: Version unbekannt (nicht die der Haupt-Mod)
        for p in &m.s.meta.provides {
            present.entry(p.as_str()).or_insert((None, m.s));
        }
    }
    for m in mods {
        let s = m.s;
        let name = name_of(s);
        if !loader_ok(inst, &s.meta, connector) {
            let l = s.meta.loader.as_deref().unwrap_or("?");
            issues.push(DepIssue {
                kind: IssueKind::WrongLoader,
                severity: "error".into(),
                file_name: s.file_name.clone(),
                mod_name: name.clone(),
                target: None,
                other_file: None,
                message: format!("{name} ist eine {}-Mod, die Instanz nutzt {}", loader_label(l), loader_label(inst.loader.kind.as_str())),
                fixes: vec![Fix::Disable { file_name: s.file_name.clone() }],
            });
            continue;
        }
        for d in &s.meta.deps {
            let id = d.id.as_str();
            match d.kind.as_str() {
                "required" => {
                    if id == "minecraft" {
                        if let Some(r) = &d.range {
                            if satisfies(r, &inst.mc_version) == Some(false) {
                                issues.push(DepIssue {
                                    kind: IssueKind::WrongMinecraft,
                                    severity: "error".into(),
                                    file_name: s.file_name.clone(),
                                    mod_name: name.clone(),
                                    target: Some("minecraft".into()),
                                    other_file: None,
                                    message: format!("{name} braucht Minecraft {r}, die Instanz nutzt {}", inst.mc_version),
                                    fixes: vec![Fix::Disable { file_name: s.file_name.clone() }],
                                });
                            }
                        }
                        continue;
                    }
                    if LOADER_DEP_IDS.contains(&id) {
                        if let (Some(r), Some(lv)) = (&d.range, inst.loader.version.as_deref()) {
                            if loader_dep_applies(inst, id) && satisfies(r, lv) == Some(false) {
                                issues.push(DepIssue {
                                    kind: IssueKind::VersionMismatch,
                                    severity: "error".into(),
                                    file_name: s.file_name.clone(),
                                    mod_name: name.clone(),
                                    target: Some(id.into()),
                                    other_file: None,
                                    message: format!("{name} braucht {} {r}, installiert ist {lv}", loader_label(inst.loader.kind.as_str())),
                                    fixes: vec![],
                                });
                            }
                        }
                        continue;
                    }
                    if builtins.contains(&id) {
                        continue;
                    }
                    // Mod-IDs mit „-“ und „_“ werden uneinheitlich angegeben (fabric-api / fabric_api)
                    let alias = if id.contains('-') { id.replace('-', "_") } else { id.replace('_', "-") };
                    let found = present.get(id).or_else(|| present.get(alias.as_str()));
                    match found {
                        None if off.contains_key(id) => {
                            let other = off[id];
                            issues.push(DepIssue {
                                kind: IssueKind::DisabledDependency,
                                severity: "error".into(),
                                file_name: s.file_name.clone(),
                                mod_name: name.clone(),
                                target: Some(id.into()),
                                other_file: None,
                                message: format!("{name} braucht {}, das deaktiviert ist", name_of(other)),
                                fixes: vec![Fix::Enable { file_name: other.file_name.clone(), title: name_of(other) }, Fix::Disable { file_name: s.file_name.clone() }],
                            });
                        }
                        None => issues.push(DepIssue {
                            kind: IssueKind::MissingDependency,
                            severity: "error".into(),
                            file_name: s.file_name.clone(),
                            mod_name: name.clone(),
                            target: Some(id.into()),
                            other_file: None,
                            message: format!("{name} braucht „{id}“{}", d.range.as_deref().filter(|r| *r != "*").map(|r| format!(" ({r})")).unwrap_or_default()),
                            fixes: vec![Fix::Disable { file_name: s.file_name.clone() }],
                        }),
                        Some((_, other)) if std::ptr::eq(*other, s) => {}
                        Some((ver, other)) => {
                            if let (Some(r), Some(v)) = (&d.range, ver) {
                                if satisfies(r, v) == Some(false) {
                                    issues.push(DepIssue {
                                        kind: IssueKind::VersionMismatch,
                                        severity: "warning".into(),
                                        file_name: s.file_name.clone(),
                                        mod_name: name.clone(),
                                        target: Some(id.into()),
                                        other_file: Some(other.file_name.clone()),
                                        message: format!("{name} braucht {} {r}, installiert ist {v}", name_of(other)),
                                        fixes: vec![],
                                    });
                                }
                            }
                        }
                    }
                }
                "breaks" => {
                    if let Some((ver, other)) = present.get(id) {
                        if std::ptr::eq(*other, s) {
                            continue;
                        }
                        let hit = match (&d.range, ver) {
                            (Some(r), Some(v)) => satisfies(r, v).unwrap_or(true),
                            _ => true,
                        };
                        if hit {
                            issues.push(DepIssue {
                                kind: IssueKind::Incompatible,
                                severity: "error".into(),
                                file_name: s.file_name.clone(),
                                mod_name: name.clone(),
                                target: Some(id.into()),
                                other_file: Some(other.file_name.clone()),
                                message: format!("{name} ist nicht mit {} kompatibel", name_of(other)),
                                fixes: vec![Fix::Disable { file_name: other.file_name.clone() }, Fix::Disable { file_name: s.file_name.clone() }],
                            });
                        }
                    }
                }
                _ => {}
            }
        }
    }
    // Doppelte Mods (gleiche ID in mehreren aktiven Dateien)
    let mut by_id: HashMap<&str, Vec<&Scanned>> = HashMap::new();
    for m in mods {
        by_id.entry(m.id).or_default().push(m.s);
    }
    let mut dups: Vec<(&str, Vec<&Scanned>)> = by_id.into_iter().filter(|(_, v)| v.len() > 1).collect();
    dups.sort_by_key(|(id, _)| *id);
    for (id, mut files) in dups {
        // neueste Version (sonst neueste Datei) behalten
        files.sort_by(|a, b| {
            let va = a.meta.version.as_deref().and_then(parse_ver);
            let vb = b.meta.version.as_deref().and_then(parse_ver);
            match (va, vb) {
                (Some(x), Some(y)) => cmp_ver(&y, &x),
                _ => b.modified.cmp(&a.modified),
            }
        });
        let keep = files[0];
        let remove: Vec<String> = files[1..].iter().map(|s| s.file_name.clone()).collect();
        issues.push(DepIssue {
            kind: IssueKind::Duplicate,
            severity: "error".into(),
            file_name: keep.file_name.clone(),
            mod_name: name_of(keep),
            target: Some(id.into()),
            other_file: None,
            message: format!("{} ist {}× installiert ({})", name_of(keep), files.len(), files.iter().map(|s| s.file_name.as_str()).collect::<Vec<_>>().join(", ")),
            fixes: vec![Fix::Remove { file_names: remove }],
        });
    }
    issues
}

/// Vor dem Start: Probleme ins Spiel-Log schreiben (Start wird nie verhindert).
pub async fn warn_before_launch(state: &AppState, instance_id: &str) {
    let Ok(issues) = check(state, instance_id, false).await else { return };
    let errors: Vec<&DepIssue> = issues.iter().filter(|i| i.severity == "error").collect();
    if errors.is_empty() {
        return;
    }
    let log = |m: String| state.game.launcher_line(instance_id, crate::minecraft::LogLevel::Launcher, m);
    log(format!("Warnung: Abhängigkeits-Check meldet {} Problem(e) – das Spiel startet evtl. nicht:", errors.len()));
    for i in errors.iter().take(20) {
        log(format!("  • {}", i.message));
    }
}
