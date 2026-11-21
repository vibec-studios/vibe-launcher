use super::*;

pub(super) fn dedupe_key(d: &Diagnosis) -> String {
    // Dieselbe fehlende Abhängigkeit (mehrere Mods brauchen sie, mehrere Fehlerzeilen) nur einmal
    if d.id == "missing_dependency" {
        return format!("{}:{:?}", d.id, d.params.get("dependency"));
    }
    let c = d.culprit.as_ref();
    format!(
        "{}:{:?}:{:?}:{:?}:{:?}:{:?}",
        d.id,
        c.and_then(|c| c.mod_id.clone()),
        c.and_then(|c| c.file.clone()),
        d.params.get("dependency"),
        d.params.get("path"),
        d.params.get("other_id")
    )
}

/// Hauptfunktion: Protokolle (Crash-Report, Log, Konsole – wichtigstes zuerst) auswerten.
pub fn analyze(sources: &[LogText], ctx: &Ctx, mods: &ModIndex) -> Vec<Diagnosis> {
    let t = table();
    let fatal = ctx.crash_report || ctx.exit_code.is_some_and(|c| c != 0) || sources.iter().any(|s| t.fatal.iter().any(|m| s.text.contains(m.as_str())));
    let mut out: Vec<Diagnosis> = vec![];
    let mut seen: HashSet<String> = HashSet::new();
    let mut push = |d: Diagnosis, out: &mut Vec<Diagnosis>| {
        if seen.insert(dedupe_key(&d)) {
            out.push(d);
            true
        } else {
            false
        }
    };

    'passes: for fallback in [false, true] {
        if fallback && out.iter().any(|d| d.confidence >= 85) {
            break;
        }
        for p in t.patterns.iter().filter(|p| p.raw.fallback == fallback) {
            if p.raw.fatal && !fatal {
                continue;
            }
            if let Some(l) = &p.raw.loader {
                if !ctx.loader.as_ref().is_some_and(|x| l.contains(x)) {
                    continue;
                }
            }
            for src in sources {
                if p.also.as_ref().is_some_and(|a| !a.is_match(&src.text)) {
                    continue;
                }
                for c in p.re.captures_iter(&src.text).take(20) {
                    let m = c.get(0).unwrap();
                    let line = line_of(&src.text, m.start());
                    if p.unless.as_ref().is_some_and(|u| u.is_match(line)) {
                        continue;
                    }
                    let Some(mut d) = handle(p, &c, src, m.start(), ctx, mods) else { continue };
                    d.rule = Some(p.raw.id.clone());
                    d.source = Some(src.name.clone());
                    d.line = Some(src.line_no(m.start()));
                    let d = d.evidence(line);
                    // Unsichere Regeln: nur der erste Treffer
                    if push(d, &mut out) && fallback {
                        break 'passes;
                    }
                }
            }
        }
    }

    if fatal {
        // Doppelte Mods (aus dem mods-Ordner selbst – zuverlässig)
        let mut dups: Vec<_> = mods.by_id.iter().filter(|(id, v)| v.len() > 1 && !is_builtin(id)).collect();
        dups.sort_by(|a, b| a.0.cmp(b.0));
        for (id, files) in dups {
            let names: Vec<String> = files.iter().map(|f| f.file.clone()).collect();
            let d = Diagnosis::new("duplicate_mod", 80)
                .culprit(Some(id), files[0].name.as_deref())
                .param("files", names.join(", "))
                .action(Action::DisableMod { file: names[names.len() - 1].clone() });
            push(d, &mut out);
        }
        // Bekannte unverträgliche Paare
        for h in known_pairs(mods) {
            let mut d = Diagnosis::new("known_conflict", 78)
                .param("other_file", &h.b_file)
                .param("other_name", &h.b_name)
                .param("source", &h.source)
                .action(Action::DisableMod { file: h.a_file.clone() });
            d.rule = Some(h.id.clone());
            d.culprit = Some(Culprit { mod_id: mods.id_of_file(&h.a_file).map(String::from), name: Some(h.a_name.clone()), file: Some(h.a_file.clone()) });
            push(d, &mut out);
        }
    }

    // Exit-Codes als letzter Hinweis
    if let Some(code) = ctx.exit_code {
        if code != 0 && out.is_empty() {
            let id = match code {
                -1073741819 => "exit_access_violation",
                -805306369 => "exit_hang",
                -1073740791 | -1073740940 => "exit_native",
                137 | -9 => "exit_killed",
                _ => "exit_code",
            };
            let mut d = Diagnosis::new("exit_code", 30).param("code", code.to_string()).param("hint", id);
            if id == "exit_access_violation" {
                d = d.action(Action::UpdateDrivers);
            }
            push(d, &mut out);
        }
    }

    // Schuldige den Dateien zuordnen, sinnvolle Standard-Aktionen ergänzen
    for d in out.iter_mut() {
        if let Some(c) = d.culprit.as_mut() {
            if let Some(id) = c.mod_id.clone() {
                if let Some(e) = mods.file_of(&id) {
                    if c.file.is_none() {
                        c.file = Some(e.file.clone());
                    }
                    if c.name.is_none() {
                        c.name = e.name.clone();
                    }
                }
            }
        }
        if let Some(o) = d.params.get("other_id").cloned() {
            if let Some(e) = mods.file_of(&o) {
                d.params.entry("other_file".into()).or_insert_with(|| e.file.clone());
                if let Some(n) = &e.name {
                    d.params.entry("other_name".into()).or_insert_with(|| n.clone());
                }
            }
        }
        let disable = matches!(d.id.as_str(), "mixin" | "mixin_conflict" | "mod_conflict" | "wrong_minecraft" | "wrong_loader" | "suspected_mod");
        if let (true, Some(f)) = (disable, d.culprit.as_ref().and_then(|c| c.file.clone())) {
            if !d.actions.iter().any(|a| matches!(a, Action::DisableMod { .. })) {
                d.actions.insert(0, Action::DisableMod { file: f });
            }
        }
        d.actions.push(Action::Upload);
    }

    // Überschneidungen: derselbe Mixin-Fehler als Einzel- und Paarbefund, bekanntes Paar mit konkretem Konflikt
    // (Mod-ID, Datei) der vorgeschlagenen Mod und der Alternative
    type Side = (Option<String>, Option<String>);
    let pairs: Vec<(Side, Side)> = out
        .iter()
        .filter(|d| matches!(d.id.as_str(), "mixin_conflict" | "mod_conflict"))
        .map(|d| {
            let c = d.culprit.as_ref();
            ((c.and_then(|c| c.mod_id.clone()), c.and_then(|c| c.file.clone())), (d.params.get("other_id").cloned(), d.params.get("other_file").cloned()))
        })
        .collect();
    out.retain(|d| {
        let c = d.culprit.as_ref();
        let id = c.and_then(|c| c.mod_id.clone());
        let file = c.and_then(|c| c.file.clone());
        match d.id.as_str() {
            "mixin" => !pairs.iter().any(|((a, _), (b, _))| id.is_some() && (id == *a || id == *b)),
            "known_conflict" => {
                let other = d.params.get("other_file").cloned();
                !pairs.iter().any(|((_, af), (_, bf))| file.is_some() && ((file == *af && other == *bf) || (file == *bf && other == *af)))
            }
            _ => true,
        }
    });
    out.sort_by_key(|d| std::cmp::Reverse(d.confidence));
    out
}

/// Kurzform für einen einzelnen Text (Tests, Logs-Tab).
pub fn analyze_text(text: &str, exit_code: Option<i32>, mods: &ModIndex, max_memory_mb: u32) -> Vec<Diagnosis> {
    let ctx = Ctx { exit_code, max_memory_mb, ..Default::default() };
    analyze(&[LogText::new("log", text)], &ctx, mods)
}
