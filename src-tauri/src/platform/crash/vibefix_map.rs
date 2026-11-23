use super::*;
use vibefix_infer::{Analysis, Cause};

pub fn launcher_id(cause: &str) -> &str {
    match cause {
        "disabled_dependency" | "connector_dependency" => "missing_dependency",
        "forge_mod_on_fabric" => "wrong_loader",
        "mixin_target_missing" => "mixin",
        "java_too_old" | "java_too_new" => "java_version",
        "metaspace_exhausted" | "direct_buffer_exhausted" | "native_thread_exhausted" => "native_memory",
        "glfw_context" | "opengl_version" | "driver_intel" | "driver_amd" | "driver_nvidia" => "graphics",
        other => other,
    }
}

fn pct(v: f64) -> u8 {
    (v * 100.0).round().clamp(0.0, 100.0) as u8
}

fn ents<'a>(c: &'a Cause, key: &str) -> &'a [String] {
    c.entities.get(key).unwrap_or(&[])
}

fn first<'a>(c: &'a Cause, key: &str) -> Option<&'a str> {
    ents(c, key).first().map(String::as_str)
}

fn same(list: &[String], v: Option<&String>) -> bool {
    match v {
        Some(v) => list.is_empty() || list.iter().any(|x| x.eq_ignore_ascii_case(v)),
        None => true,
    }
}

fn compatible(d: &Diagnosis, c: &Cause) -> bool {
    let mod_id = d.culprit.as_ref().and_then(|x| x.mod_id.as_ref());
    match d.id.as_str() {
        "missing_dependency" | "outdated_dependency" => same(ents(c, "dep_id"), d.params.get("dependency")),
        _ => same(ents(c, "mod_id"), mod_id),
    }
}

fn culprit_id<'a>(c: &'a Cause, mods: &ModIndex) -> Option<&'a str> {
    let ids = ents(c, "mod_id");
    ids.iter().find(|m| !is_builtin(m) && mods.file_of(m).is_some()).or(ids.iter().find(|m| !is_builtin(m))).map(String::as_str)
}

fn java(c: &Cause, ctx: &Ctx) -> Option<Diagnosis> {
    let older = c.cause == "java_too_new";
    let major = ents(c, "java_major").iter().filter_map(|v| v.parse::<u32>().ok()).find(|m| (8..=40).contains(m));
    let major = major.or_else(|| older.then(|| ctx.mc_version.as_deref().and_then(recommended_java)).flatten())?;
    let mut d = Diagnosis::new("java_version", pct(c.confidence)).param("required", major.to_string()).action(Action::SetJava { major });
    if let Some(p) = first(c, "present_version") {
        d = d.param("present", p);
    }
    if older {
        d = d.param("direction", "older");
    }
    Some(d)
}

fn from_cause(id: &str, c: &Cause, ctx: &Ctx, mods: &ModIndex) -> Vec<Diagnosis> {
    let conf = pct(c.confidence);
    let culprit = culprit_id(c, mods);
    let base = || Diagnosis::new(id, conf).culprit(culprit, None);
    let deps: Vec<&String> = ents(c, "dep_id").iter().filter(|d| !is_builtin(d)).take(3).collect();
    match id {
        "missing_dependency" if !deps.is_empty() => deps
            .into_iter()
            .filter(|dep| mods.file_of(dep).is_none())
            .map(|dep| {
                let mut d = missing_dependency(mods, conf, dep, &[], None);
                d.culprit = base().culprit;
                d
            })
            .collect(),
        "outdated_dependency" => deps
            .into_iter()
            .filter_map(|dep| {
                let e = mods.file_of(dep)?;
                let present = e.version.clone().or_else(|| first(c, "present_version").map(Into::into)).unwrap_or_default();
                Some(
                    base()
                        .param("dependency", dep.as_str())
                        .param("dependency_name", e.name.clone().unwrap_or_else(|| dep.clone()))
                        .param("dependency_file", &e.file)
                        .param("present", present)
                        .param("range", clean_range(first(c, "range").unwrap_or("")))
                        .action(Action::UpdateMod { file: e.file.clone(), mod_id: dep.clone() }),
                )
            })
            .collect(),
        "java_version" => java(c, ctx).into_iter().collect(),
        "out_of_memory" => {
            let suggest = suggest_ram(ctx.max_memory_mb, ctx.system_memory_mb);
            let d = base().param("current", ctx.max_memory_mb.to_string()).param("suggest", suggest.to_string());
            vec![if suggest > ctx.max_memory_mb { d.action(Action::IncreaseRam { suggest_mb: suggest }) } else { d.param("limit", ctx.system_memory_mb.to_string()) }]
        }
        "heap_reserve" => vec![base().param("current", ctx.max_memory_mb.to_string()).param("system", ctx.system_memory_mb.to_string())],
        "broken_config" => {
            let path = ents(c, "config_path").iter().chain(ents(c, "file")).map(|p| p.replace('\\', "/")).find(|p| p.starts_with("config/") && !p.contains(".."));
            match path {
                Some(p) => vec![base().param("path", &p).action(Action::ResetConfig { path: p })],
                None => vec![base()],
            }
        }
        "duplicate_mod" => {
            let dup = ents(c, "mod_id").iter().find_map(|m| mods.by_id.get(&m.to_ascii_lowercase()).filter(|v| v.len() > 1).map(|v| (m, v)));
            match dup {
                Some((m, files)) => {
                    let names: Vec<String> = files.iter().map(|f| f.file.clone()).collect();
                    let last = names[names.len() - 1].clone();
                    vec![Diagnosis::new(id, conf).culprit(Some(m), files[0].name.as_deref()).param("files", names.join(", ")).action(Action::DisableMod { file: last })]
                }
                None => vec![base()],
            }
        }
        "wrong_loader" => {
            let file = ents(c, "file").iter().find(|f| mods.files.contains(f)).cloned();
            let loader = first(c, "loader").or(first(c, "required_loader")).or((c.cause == "forge_mod_on_fabric").then_some("forge"));
            let mut d = base();
            if let Some(f) = file {
                d = d.param("file", &f);
                d.culprit = Some(Culprit { mod_id: d.culprit.take().and_then(|x| x.mod_id).or_else(|| mods.id_of_file(&f).map(Into::into)), name: None, file: Some(f) });
            }
            vec![match loader {
                Some(l) => d.param("mod_loader", l),
                None => d,
            }]
        }
        "wrong_minecraft" => vec![base().param("required", clean_range(first(c, "range").unwrap_or(""))).param("present", ctx.mc_version.clone().unwrap_or_default())],
        "loader_version" => vec![base()
            .param("loader", first(c, "loader").map(String::from).or_else(|| ctx.loader.clone()).unwrap_or_default())
            .param("required", clean_range(first(c, "range").unwrap_or("")))
            .param("present", first(c, "present_version").unwrap_or(""))],
        "mixin_conflict" | "mod_conflict" | "known_conflict" => {
            let other = first(c, "other_id").or_else(|| ents(c, "mod_id").iter().map(String::as_str).find(|m| Some(*m) != culprit));
            vec![match other {
                Some(o) => base().param("other_id", o),
                None => base(),
            }]
        }
        "graphics" => {
            let d = base().action(Action::UpdateDrivers);
            vec![match ents(c, "file").iter().find(|f| f.to_ascii_lowercase().ends_with(".dll")) {
                Some(dll) => d.param("dll", dll),
                None => d,
            }]
        }
        "exit_code" => match ctx.exit_code {
            Some(code) => vec![base().param("code", code.to_string()).param("hint", "exit_code")],
            None => vec![],
        },
        _ => vec![base()],
    }
}

fn finish(d: &mut Diagnosis, mods: &ModIndex) {
    if let Some(c) = d.culprit.as_mut() {
        if let Some(e) = c.mod_id.as_deref().and_then(|id| mods.file_of(id)) {
            c.file.get_or_insert_with(|| e.file.clone());
            if c.name.is_none() {
                c.name = e.name.clone();
            }
        }
    }
    if let Some(e) = d.params.get("other_id").and_then(|o| mods.file_of(o)).cloned() {
        d.params.entry("other_file".into()).or_insert(e.file);
        if let Some(n) = e.name {
            d.params.entry("other_name".into()).or_insert(n);
        }
    }
    let disable = matches!(d.id.as_str(), "mixin" | "mixin_conflict" | "mod_conflict" | "wrong_minecraft" | "wrong_loader" | "suspected_mod");
    if let (true, Some(f)) = (disable, d.culprit.as_ref().and_then(|c| c.file.clone())) {
        if !d.actions.iter().any(|a| matches!(a, Action::DisableMod { .. })) {
            d.actions.insert(0, Action::DisableMod { file: f });
        }
    }
    if !d.actions.contains(&Action::Upload) {
        d.actions.push(Action::Upload);
    }
}

fn locate(d: &mut Diagnosis, c: &Cause, sources: &[LogText]) {
    let Some(loc) = c.evidence.as_ref().or(c.locations.first()) else { return };
    let Some(src) = sources.iter().find(|s| s.name == loc.file) else { return };
    let Some((line, text)) = src.line_at(loc.line) else { return };
    d.source = Some(src.name.clone());
    d.line = Some(line);
    d.evidence = Some(text.trim().chars().take(300).collect());
}

fn unknown(a: &Analysis) -> Diagnosis {
    let score = a.crash_score.unwrap_or(a.ood_score);
    let mut d = Diagnosis::new("unknown", pct(score)).action(Action::Upload);
    d.origin = Some("vibefix".into());
    d.model_cause = Some("unknown".into());
    d.model_confidence = Some(score);
    d
}

fn push(out: &mut Vec<Diagnosis>, d: Diagnosis) {
    let key = dedupe_key(&d);
    if !out.iter().any(|o| dedupe_key(o) == key) {
        out.push(d);
    }
}

pub fn merge(a: &Analysis, sources: &[LogText], ctx: &Ctx, mods: &ModIndex, rules: Vec<Diagnosis>) -> Vec<Diagnosis> {
    let mut rules: Vec<Option<Diagnosis>> = rules.into_iter().map(Some).collect();
    let mut out: Vec<Diagnosis> = vec![];
    if a.status == "unknown" {
        out.push(unknown(a));
    }
    for c in &a.causes {
        let id = launcher_id(&c.cause);
        let mut found: Vec<Diagnosis> = rules.iter_mut().filter(|r| r.as_ref().is_some_and(|d| d.id == id && compatible(d, c))).filter_map(Option::take).collect();
        let origin = if found.is_empty() { "vibefix" } else { "both" };
        if found.is_empty() {
            found = from_cause(id, c, ctx, mods);
            for d in found.iter_mut() {
                finish(d, mods);
            }
        }
        for mut d in found {
            d.origin = Some(origin.into());
            d.model_cause = Some(c.cause.clone());
            d.model_confidence = Some(c.confidence);
            if d.source.is_none() {
                locate(&mut d, c, sources);
            }
            push(&mut out, d);
        }
    }
    let any = !out.is_empty();
    for mut d in rules.into_iter().flatten() {
        if any && d.id == "exit_code" {
            continue;
        }
        d.origin = Some("rules".into());
        push(&mut out, d);
    }
    out
}
