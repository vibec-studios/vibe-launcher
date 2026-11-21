use super::*;

pub(super) fn handle(p: &Pattern, c: &Captures, src: &LogText, start: usize, ctx: &Ctx, mods: &ModIndex) -> Option<Diagnosis> {
    let conf = p.raw.confidence;
    let text = &src.text;
    match p.raw.kind.as_str() {
        "manual" => Some(Diagnosis::new(&p.raw.id, conf)),
        "missing_dependency" => {
            let dep = g(c, "dep_id")?;
            if is_builtin(dep) || mods.by_id.contains_key(&dep.to_ascii_lowercase()) {
                return None;
            }
            let mut d = missing_dependency(mods, conf, dep, &[], g(c, "dep_name")).culprit(g(c, "mod_id"), g(c, "mod_name"));
            let r = clean_range(g(c, "range").unwrap_or(""));
            if !r.is_empty() {
                d = d.param("range", r);
            }
            Some(d)
        }
        "dependency_version" => {
            let dep = g(c, "dep_id")?.to_ascii_lowercase();
            let range = g(c, "range").unwrap_or("");
            let present = g(c, "present").unwrap_or("");
            let (mod_id, mod_name) = (g(c, "mod_id"), g(c, "mod_name"));
            if dep == "minecraft" {
                return Some(Diagnosis::new("wrong_minecraft", conf).culprit(mod_id, mod_name).param("required", clean_range(range)).param("present", present));
            }
            if dep == "java" {
                let major: u32 = range.split(|ch: char| !ch.is_ascii_digit()).find(|s| !s.is_empty())?.parse().ok()?;
                return (major >= 8).then(|| {
                    Diagnosis::new("java_version", conf).param("required", major.to_string()).param("present", present).action(Action::SetJava { major })
                });
            }
            if LOADER_IDS.contains(&dep.as_str()) {
                return Some(Diagnosis::new("loader_version", conf).culprit(mod_id, mod_name).param("loader", dep).param("required", clean_range(range)).param("present", present));
            }
            let dep_name = g(c, "dep_name").map(String::from).or_else(|| mods.file_of(&dep).and_then(|e| e.name.clone())).unwrap_or_else(|| dep.clone());
            let mut d = Diagnosis::new("outdated_dependency", conf)
                .culprit(mod_id, mod_name)
                .param("dependency", &dep)
                .param("dependency_name", &dep_name)
                .param("range", clean_range(range))
                .param("present", present);
            match needs_newer(range, present) {
                // Die anfragende Mod ist zu alt (will eine ältere Abhängigkeit) -> sie aktualisieren
                Some(false) => {
                    d = d.param("direction", "older");
                    if let Some(e) = mod_id.and_then(|m| mods.file_of(m)) {
                        d = d.action(Action::UpdateMod { file: e.file.clone(), mod_id: mod_id.unwrap_or_default().into() });
                    }
                }
                _ => {
                    if let Some(e) = mods.file_of(&dep) {
                        d = d.param("dependency_file", &e.file).action(Action::UpdateMod { file: e.file.clone(), mod_id: dep.clone() });
                    }
                }
            }
            Some(d)
        }
        "declared_conflict" => {
            // Die Mod, die den Konflikt erklärt, schützt sich meist selbst -> die andere deaktivieren
            let other = g(c, "other_id")?;
            if is_builtin(other) {
                return None;
            }
            let mut d = Diagnosis::new("mod_conflict", conf).culprit(Some(other), g(c, "other_name"));
            if let Some(m) = g(c, "mod_id") {
                d = d.param("other_id", m);
            }
            if let Some(n) = g(c, "mod_name") {
                d = d.param("other_name", n);
            }
            Some(d)
        }
        "missing_class" => {
            let cls = g(c, "class")?.replace('.', "/");
            let hint = table().hints.iter().find(|h| {
                cls.starts_with(&h.prefix) && h.loader.as_ref().map(|l| ctx.loader.as_ref().is_some_and(|x| l.contains(x))).unwrap_or(true)
            })?;
            if hint.ids.iter().any(|i| mods.by_id.contains_key(i)) {
                return None;
            }
            let ids: Vec<&str> = hint.ids.iter().map(String::as_str).collect();
            let mut d = missing_dependency(mods, conf, &hint.slug, &ids, Some(&hint.name)).param("class", cls.replace('/', "."));
            if let Some(id) = mods_in(window(text, start, 0, 4000), mods).into_iter().find(|i| !is_noise(i)) {
                d = d.culprit(Some(&id), None);
            }
            Some(d)
        }
        "wrong_loader_file" => {
            let path = g(c, "file")?;
            let file = path.rsplit(['/', '\\']).next().unwrap_or(path).trim();
            let loader = g(c, "loader").unwrap_or("").to_ascii_lowercase().replace("minecraft ", "");
            let mut d = Diagnosis::new("wrong_loader", conf).param("mod_loader", loader).param("file", file);
            d.culprit = Some(Culprit { mod_id: mods.id_of_file(file).map(String::from), name: None, file: Some(file.to_string()) });
            Some(d)
        }
        "duplicate_files" => {
            let files: Vec<String> = g(c, "files")?.split(',').map(|f| f.trim().to_string()).filter(|f| !f.is_empty()).collect();
            let mut d = Diagnosis::new("duplicate_mod", conf).culprit(g(c, "mod_id"), None).param("files", files.join(", "));
            if let Some(f) = files.get(1) {
                d = d.action(Action::DisableMod { file: f.clone() });
            }
            Some(d)
        }
        "duplicate_id" => {
            let id = g(c, "mod_id")?;
            if is_builtin(id) {
                return None;
            }
            let mut d = Diagnosis::new("duplicate_mod", conf).culprit(Some(id), None);
            if let Some(v) = mods.by_id.get(&id.to_ascii_lowercase()).filter(|v| v.len() > 1) {
                let names: Vec<String> = v.iter().map(|e| e.file.clone()).collect();
                d = d.param("files", names.join(", ")).action(Action::DisableMod { file: names[names.len() - 1].clone() });
            }
            Some(d)
        }
        "java_class_version" => {
            let class: u32 = g(c, "class")?.parse().ok()?;
            if class < 45 {
                return None;
            }
            let major = class - 44;
            let present = g(c, "runtime").and_then(|v| v.parse::<u32>().ok()).filter(|v| *v >= 45).map(|v| (v - 44).to_string()).unwrap_or_default();
            Some(Diagnosis::new("java_version", conf).param("required", major.to_string()).param("present", present).action(Action::SetJava { major }))
        }
        "java_too_new" => {
            let runtime = g(c, "runtime")?.parse::<u32>().ok()?.checked_sub(44)?;
            let rec = recommended_java(ctx.mc_version.as_deref()?)?;
            (rec < runtime).then(|| {
                Diagnosis::new("java_version", conf)
                    .param("required", rec.to_string())
                    .param("present", runtime.to_string())
                    .param("direction", "older")
                    .action(Action::SetJava { major: rec })
            })
        }
        "java_8" => {
            if ctx.mc_version.as_deref().and_then(recommended_java).is_some_and(|r| r > 8) {
                return None;
            }
            Some(Diagnosis::new("java_version", conf).param("required", "8").param("direction", "older").action(Action::SetJava { major: 8 }))
        }
        "out_of_memory" => {
            let detail = g(c, "detail").unwrap_or("").to_string();
            let suggest = suggest_ram(ctx.max_memory_mb, ctx.system_memory_mb);
            let mut d = Diagnosis::new("out_of_memory", conf)
                .param("current", ctx.max_memory_mb.to_string())
                .param("suggest", suggest.to_string())
                .param("detail", detail);
            if suggest > ctx.max_memory_mb {
                d = d.action(Action::IncreaseRam { suggest_mb: suggest });
            } else {
                d = d.param("limit", ctx.system_memory_mb.to_string());
            }
            Some(d)
        }
        "heap_reserve" => Some(Diagnosis::new("heap_reserve", conf).param("current", ctx.max_memory_mb.to_string()).param("system", ctx.system_memory_mb.to_string())),
        "mixin_conflict" => {
            let a = mods_in(g(c, "a")?, mods).into_iter().next()?;
            let b = mods_in(g(c, "b")?, mods).into_iter().next()?;
            (a != b).then(|| Diagnosis::new("mixin_conflict", conf).culprit(Some(&a), None).param("other_id", b))
        }
        "mixin_failure" => {
            // Beteiligte Mods zuerst aus der Meldung selbst (die ersten Zeilen), sonst aus dem Stacktrace
            let w = window(text, start, 0, 8000);
            let msg: String = w.lines().take(3).collect::<Vec<_>>().join("\n");
            // Konfliktpartner nur aus der Meldung – Stacktrace-Frames („[from mod x]“) nennen nur, wer die Methode
            // ebenfalls verändert, und taugen höchstens als Hinweis auf den Verursacher
            let mut ids = mods_in(&msg, mods);
            if ids.is_empty() {
                ids = mods_in(w, mods).into_iter().filter(|i| !is_noise(i)).take(1).collect();
            }
            let clean: Vec<String> = ids.iter().filter(|i| !is_noise(i)).cloned().collect();
            let ids = if clean.is_empty() { ids } else { clean };
            match ids.as_slice() {
                [] => None,
                [one] => Some(Diagnosis::new("mixin", conf).culprit(Some(one), None)),
                [a, b, ..] => Some(Diagnosis::new("mixin_conflict", conf.max(88)).culprit(Some(a), None).param("other_id", b)),
            }
        }
        "broken_config" => {
            let path = match g(c, "path") {
                Some(p) => {
                    if g(c, "ctype").is_some_and(|t| t.eq_ignore_ascii_case("server")) {
                        return None;
                    }
                    config_path(&format!(" {p}")).or_else(|| safe_rel(&p.replace('\\', "/")).map(|r| format!("config/{r}")))?
                }
                None => {
                    // Pfad in der Zeile oder den Nachbarzeilen (2 davor, 4 danach)
                    let ls = text[..start].rfind('\n').map(|i| i + 1).unwrap_or(0);
                    let before: Vec<&str> = text[..ls].lines().rev().take(2).collect();
                    let after: Vec<&str> = text[ls..].lines().take(5).collect();
                    after.iter().chain(before.iter()).find_map(|l| config_path(l))?
                }
            };
            Some(Diagnosis::new("broken_config", conf).culprit(g(c, "mod_id"), None).param("path", &path).action(Action::ResetConfig { path }))
        }
        "graphics" => {
            let mut d = Diagnosis::new("graphics", conf).action(Action::UpdateDrivers);
            if let Some(dll) = g(c, "detail") {
                d = d.param("dll", dll);
            }
            Some(d)
        }
        "suspected_mod" => {
            let (id, name) = match (g(c, "mod_id"), g(c, "detail")) {
                (Some(id), _) => (id.to_string(), None),
                (None, Some(det)) => {
                    // „Sodium (sodium), Version: 0.5.8“
                    let first = det.split(',').next().unwrap_or("").trim();
                    match (first.find('('), first.find(')')) {
                        (Some(a), Some(b)) if b > a => (first[a + 1..b].to_string(), Some(first[..a].trim().to_string())),
                        _ => (first.to_string(), None),
                    }
                }
                _ => return None,
            };
            if id.is_empty() || is_builtin(&id) || id.eq_ignore_ascii_case("none") {
                return None;
            }
            Some(Diagnosis::new("suspected_mod", conf).culprit(Some(&id), name.as_deref()))
        }
        other => {
            tracing::warn!("Crash-Muster {}: unbekannte Auswertung {other}", p.raw.id);
            None
        }
    }
}
