use super::*;

/// Probleme (Abhängigkeits-Check + Crash-Diagnosen) in einen widerspruchsfreien Bedarf übersetzen.
/// `names`: Dateiname -> Anzeigename der installierten Mods. Die Position einer Diagnose in `diags` ist ihr
/// `cause`-Index.
pub fn needs(issues: &[DepIssue], diags: &[Diagnosis], names: &HashMap<String, String>) -> Vec<Need> {
    let name = |f: &str| names.get(f).cloned().unwrap_or_else(|| display_name(f));
    let mut a = Acc { out: vec![], off: HashSet::new(), swapped: HashSet::new() };
    let of = |k: IssueKind| issues.iter().filter(move |i| i.kind == k);

    // Doppelte zuerst: alle bis auf die neueste Datei deaktivieren
    for i in of(IssueKind::Duplicate) {
        for f in &i.fixes {
            if let Fix::Remove { file_names } = f {
                for n in file_names {
                    a.disable(n, i.mod_name.clone(), "duplicate", false, None, None);
                }
            }
        }
    }
    // Falscher Loader / falsche Minecraft-Version: passende Version, sonst deaktivieren
    for i in issues.iter().filter(|i| matches!(i.kind, IssueKind::WrongLoader | IssueKind::WrongMinecraft)) {
        a.swap(&i.file_name, i.mod_name.clone(), kind_str(i.kind), None);
    }
    // Deaktivierte Pflicht-Abhängigkeit: wieder aktivieren
    for i in of(IssueKind::DisabledDependency) {
        if a.gone(&i.file_name) {
            continue;
        }
        if let Some(Fix::Enable { file_name, title }) = i.fixes.iter().find(|f| matches!(f, Fix::Enable { .. })) {
            a.enable(file_name, title.clone(), Some(&i.mod_name), None);
        }
    }
    // Fehlende Pflicht-Abhängigkeit: installieren (gleiche ID nur einmal)
    for i in of(IssueKind::MissingDependency) {
        if a.gone(&i.file_name) {
            continue;
        }
        if let Some(t) = &i.target {
            a.install(t, Some((&i.mod_name, &i.file_name)), None);
        }
    }
    // Unpassende Version einer Abhängigkeit: Abhängigkeit tauschen (Loader-Version: siehe loaderfix)
    for i in of(IssueKind::VersionMismatch) {
        if a.gone(&i.file_name) {
            continue;
        }
        match (&i.target, &i.other_file) {
            (Some(t), _) if LOADER_IDS.contains(&t.as_str()) => {}
            (_, Some(o)) => {
                if a.gone(o) {
                    continue;
                }
                a.update(o, name(o), &i.mod_name, None);
            }
            _ => a.unfixable("version_mismatch", &i.mod_name, Some(i.message.clone()), None),
        }
    }
    // Konflikte: nur nach Rückfrage, wahlweise die eine oder andere Mod
    let mut pairs: HashSet<(String, String)> = HashSet::new();
    for i in of(IssueKind::Incompatible) {
        let Some(o) = &i.other_file else { continue };
        if a.gone(o) || a.gone(&i.file_name) {
            continue;
        }
        let key = if *o < i.file_name { (o.clone(), i.file_name.clone()) } else { (i.file_name.clone(), o.clone()) };
        if !pairs.insert(key) {
            continue;
        }
        a.disable(o, name(o), "incompatible", true, Some((i.file_name.clone(), i.mod_name.clone())), None);
    }

    // Absturzursachen (Reihenfolge = Sicherheit der Regel)
    for (ci, d) in diags.iter().enumerate() {
        let cause = Some(ci);
        let culprit_file = d.culprit.as_ref().and_then(|c| c.file.clone());
        let culprit_name = d.culprit.as_ref().and_then(|c| c.name.clone().or_else(|| c.mod_id.clone()));
        let p = |k: &str| d.params.get(k).cloned();
        match d.id.as_str() {
            "missing_dependency" => {
                if culprit_file.as_deref().is_some_and(|f| a.gone(f)) {
                    continue;
                }
                for act in &d.actions {
                    match act {
                        CrashAction::InstallDependency { mod_id, .. } => {
                            let by = culprit_name.as_deref().map(|n| (n, culprit_file.as_deref().unwrap_or("")));
                            a.install(mod_id, by, cause)
                        }
                        CrashAction::EnableMod { file, name: n } => {
                            let n = n.clone().unwrap_or_else(|| name(file));
                            a.enable(file, n, culprit_name.as_deref(), cause)
                        }
                        _ => {}
                    }
                }
            }
            "outdated_dependency" => {
                let by = culprit_name.clone().unwrap_or_default();
                let mut any = false;
                for act in &d.actions {
                    if let CrashAction::UpdateMod { file, .. } = act {
                        let n = if p("dependency_file").as_deref() == Some(file.as_str()) { p("dependency_name").unwrap_or_else(|| name(file)) } else { culprit_name.clone().unwrap_or_else(|| name(file)) };
                        a.update(file, n, &by, cause);
                        any = true;
                    }
                }
                if !any {
                    a.unfixable("no_version", &p("dependency_name").unwrap_or_default(), Some(by), cause);
                }
            }
            "java_version" => {
                for act in &d.actions {
                    if let CrashAction::SetJava { major } = act {
                        if !a.out.iter().any(|n| matches!(n, Need::Java { .. })) {
                            a.out.push(Need::Java { major: *major, cause });
                        }
                    }
                }
            }
            "out_of_memory" => {
                let mut any = false;
                for act in &d.actions {
                    if let CrashAction::IncreaseRam { suggest_mb } = act {
                        any = true;
                        if !a.out.iter().any(|n| matches!(n, Need::Ram { .. })) {
                            a.out.push(Need::Ram { mb: *suggest_mb, cause });
                        }
                    }
                }
                if !any {
                    a.unfixable("ram_limit", "", p("current"), cause);
                }
            }
            "duplicate_mod" => {
                for act in &d.actions {
                    if let CrashAction::DisableMod { file } = act {
                        a.disable(file, culprit_name.clone().unwrap_or_else(|| name(file)), "duplicate", false, None, cause);
                    }
                }
            }
            "wrong_minecraft" | "wrong_loader" => {
                if let Some(f) = &culprit_file {
                    a.swap(f, culprit_name.clone().unwrap_or_else(|| name(f)), &d.id, cause);
                }
            }
            "mixin_conflict" | "mod_conflict" | "known_conflict" => {
                // Beide Seiten anbieten: vorgeschlagen ist die Mod, deren Mixin scheitert bzw. die markiert wurde
                if let Some(f) = &culprit_file {
                    let alt = p("other_file").filter(|o| o != f && !a.gone(o)).map(|o| {
                        let n = p("other_name").unwrap_or_else(|| name(&o));
                        (o, n)
                    });
                    let reason = if d.id == "known_conflict" { "known_pair" } else { d.id.as_str() };
                    a.disable(f, culprit_name.clone().unwrap_or_else(|| name(f)), reason, true, alt, cause);
                }
            }
            "mixin" | "suspected_mod" => {
                if let Some(f) = &culprit_file {
                    a.disable(f, culprit_name.clone().unwrap_or_else(|| name(f)), "crash_suspect", true, None, cause);
                }
            }
            "broken_config" => {
                for act in &d.actions {
                    if let CrashAction::ResetConfig { path } = act {
                        if !a.out.iter().any(|n| matches!(n, Need::ResetConfig { path: x, .. } if x == path)) {
                            a.out.push(Need::ResetConfig { path: path.clone(), name: culprit_name.clone().unwrap_or_default(), cause });
                        }
                    }
                }
            }
            "graphics" => a.unfixable("graphics", "", p("dll"), cause),
            "heap_reserve" => a.unfixable("heap_reserve", "", p("current"), cause),
            "native_memory" | "disk_full" | "invalid_jvm_flag" | "corrupt_archive" | "locked_world" => {
                a.unfixable(&d.id, "", None, cause);
            }
            _ => {}
        }
    }
    a.out
}
