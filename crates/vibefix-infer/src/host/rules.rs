use serde_json::{json, Map, Value};

use super::context::{builtin, Source};
use super::handlers::{handle, Ctx};
use super::index::Index;
use super::table::{Side, Table, PAIRS, TABLE};
use super::types::{Evidence, HostFinding, HostLabel, OMap};

pub fn meta_text<'a>(meta: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    meta.get(key).and_then(Value::as_str)
}

pub fn exit_code(meta: &Map<String, Value>) -> Option<&Value> {
    meta.get("exit_code").filter(|v| !v.is_null())
}

pub fn nonzero_exit(meta: &Map<String, Value>) -> bool {
    exit_code(meta).is_some_and(|v| v.as_f64() != Some(0.0))
}

pub fn fatal_case(meta: &Map<String, Value>, sources: &[Source], table: &Table) -> bool {
    nonzero_exit(meta)
        || sources.iter().any(|s| s.kind == "crash_report")
        || sources.iter().any(|s| table.fatal_markers.iter().any(|m| s.text.contains(m.as_str())))
}

fn dedupe_key(cause: &str, e: &OMap) -> String {
    let pick = |keys: &[&str]| keys.iter().map(|k| e.get(k).cloned().unwrap_or(Value::Null)).collect::<Vec<_>>();
    let parts = match cause {
        "missing_dependency" => pick(&["dep_id"]),
        "known_conflict" => pick(&["mod_id", "file"]),
        _ => pick(&["mod_id", "file", "dep_id", "config_path", "other_id"]),
    };
    json!([cause, parts]).to_string()
}

type Match = (String, i64, OMap, String, usize);

fn matches(sources: &[Source], meta: &Map<String, Value>, index: &Index, fatal: bool, fallback: bool) -> Vec<Match> {
    let table = &*TABLE;
    let loader = meta_text(meta, "loader");
    let mut out = Vec::new();
    for rule in &table.rules {
        if rule.fallback != fallback || (rule.fatal && !fatal) {
            continue;
        }
        if rule.loader.as_ref().is_some_and(|l| !loader.is_some_and(|x| l.iter().any(|y| y == x))) {
            continue;
        }
        for source in sources {
            if rule.also.as_ref().is_some_and(|a| !a.is_match(&source.text)) {
                continue;
            }
            for caps in rule.regex.captures_iter(&source.text).take(20) {
                let pos = caps.get(0).unwrap().start();
                if rule.unless.as_ref().is_some_and(|u| u.is_match(source.line(pos))) {
                    continue;
                }
                let ctx = Ctx { source, pos, loader, mc: meta_text(meta, "mc"), index, hints: &table.class_hints };
                if let Some((cause, entities)) = handle(rule, &caps, &ctx) {
                    let mut conf = rule.confidence;
                    if rule.kind == "mixin_failure" && cause == "mixin_conflict" {
                        conf = conf.max(88);
                    }
                    out.push((cause, conf, entities, source.name.clone(), source.line_no(pos)));
                }
            }
        }
    }
    out
}

fn pair_file(side: &Side, index: &Index) -> Option<String> {
    let version = side.version.as_deref();
    for id in &side.ids {
        for entry in index.entries(id) {
            let file = entry.get("file").and_then(Value::as_str).filter(|f| !f.is_empty());
            let v = entry.get("version").and_then(Value::as_str).unwrap_or("");
            if let Some(f) = file.filter(|_| version.map_or(true, |p| v.starts_with(p))) {
                return Some(f.to_owned());
            }
        }
    }
    let pattern = side.file.as_ref()?;
    index
        .files
        .iter()
        .find(|f| pattern.is_match(f) && index.id_for(Some(f)).is_none() && version.map_or(true, |v| f.contains(v)))
        .cloned()
}

fn index_findings(index: &Index) -> Vec<(String, i64, OMap)> {
    let mut out = Vec::new();
    let mut active: Vec<&(String, Vec<Value>)> = index.active.iter().collect();
    active.sort_by(|a, b| a.0.cmp(&b.0));
    for (id, entries) in active {
        let files: Vec<&str> =
            entries.iter().filter_map(|e| e.get("file").and_then(Value::as_str)).filter(|f| !f.is_empty()).collect();
        if !builtin(id) && files.len() > 1 {
            out.push((
                "duplicate_mod".into(),
                80,
                OMap::from_pairs([("mod_id", json!(id)), ("files", json!(files.join(", ")))]),
            ));
        }
    }
    let mut seen: Vec<(String, String)> = Vec::new();
    for pair in PAIRS.iter() {
        if let (Some(a), Some(b)) = (pair_file(&pair.a, index), pair_file(&pair.b, index)) {
            if a != b && !seen.contains(&(a.clone(), b.clone())) {
                seen.push((a.clone(), b.clone()));
                let pairs = [
                    ("mod_id", json!(index.id_for(Some(&a)))),
                    ("other_id", json!(index.id_for(Some(&b)))),
                    ("file", json!(a)),
                    ("other_file", json!(b)),
                    ("pair_id", json!(pair.id)),
                ];
                out.push(("known_conflict".into(), 78, OMap::from_pairs(pairs)));
            }
        }
    }
    out
}

fn pair_set(a: Option<String>, b: Option<String>) -> Vec<Option<String>> {
    let mut set = vec![a, b];
    set.sort();
    set.dedup();
    set
}

fn suppress_overlaps(out: Vec<HostFinding>, index: &Index) -> Vec<HostFinding> {
    let conflicts: Vec<&OMap> = out
        .iter()
        .filter(|r| matches!(r.cause.as_str(), "mixin_conflict" | "mod_conflict"))
        .map(|r| &r.entities)
        .collect();
    let ids: Vec<String> =
        conflicts.iter().flat_map(|c| [c.text("mod_id"), c.text("other_id")]).flatten().map(str::to_owned).collect();
    let files: Vec<Vec<Option<String>>> = conflicts
        .iter()
        .map(|c| {
            let first =
                c.text("file").filter(|f| !f.is_empty()).map(str::to_owned).or_else(|| index.file(c.text("mod_id")));
            pair_set(first, index.file(c.text("other_id")))
        })
        .collect();
    drop(conflicts);
    out.into_iter()
        .filter(|r| {
            let e = &r.entities;
            let mixin = r.cause == "mixin" && e.text("mod_id").is_some_and(|m| ids.iter().any(|i| i == m));
            let known = r.cause == "known_conflict"
                && files
                    .contains(&pair_set(e.text("file").map(str::to_owned), e.text("other_file").map(str::to_owned)));
            !(mixin || known)
        })
        .collect()
}

fn exit_hint(code: &Value) -> &'static str {
    match code.as_i64() {
        Some(-1073741819) => "exit_access_violation",
        Some(-805306369) => "exit_hang",
        Some(-1073740791 | -1073740940) => "exit_native",
        Some(137 | -9) => "exit_killed",
        _ => "exit_code",
    }
}

pub fn diagnose(sources: &[Source], meta: &Map<String, Value>, index: &Index) -> HostLabel {
    let fatal = fatal_case(meta, sources, &TABLE);
    let mut out: Vec<HostFinding> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let mut push = |out: &mut Vec<HostFinding>, cause: &str, conf: i64, entities: OMap, at: Option<(String, usize)>| {
        let key = dedupe_key(cause, &entities);
        if seen.contains(&key) {
            return false;
        }
        seen.push(key);
        let mut entities = entities.present();
        if matches!(cause, "wrong_loader" | "wrong_minecraft" | "suspected_mod" | "missing_dependency")
            && !entities.contains("file")
        {
            if let Some(file) = index.file(entities.text("mod_id")).filter(|f| !f.is_empty()) {
                entities.insert("file", json!(file));
            }
        }
        let evidence = at.map(|(file, line)| Evidence { file, line });
        out.push(HostFinding { cause: cause.to_owned(), confidence: conf as f64 / 100.0, entities, evidence });
        true
    };
    for (cause, conf, entities, file, line) in matches(sources, meta, index, fatal, false) {
        push(&mut out, &cause, conf, entities, Some((file, line)));
    }
    if !out.iter().any(|r| r.confidence >= 0.85) {
        for (cause, conf, entities, file, line) in matches(sources, meta, index, fatal, true) {
            if push(&mut out, &cause, conf, entities, Some((file, line))) {
                break;
            }
        }
    }
    if fatal {
        for (cause, conf, entities) in index_findings(index) {
            push(&mut out, &cause, conf, entities, None);
        }
    }
    if out.is_empty() && nonzero_exit(meta) {
        let code = exit_code(meta).cloned().unwrap_or(Value::Null);
        let hint = exit_hint(&code);
        push(&mut out, "exit_code", 30, OMap::from_pairs([("exit_code", code), ("hint", json!(hint))]), None);
    }
    let mut out = suppress_overlaps(out, index);
    out.sort_by(|a, b| b.confidence.total_cmp(&a.confidence));
    let healthy = !fatal && out.is_empty() && exit_code(meta).is_some_and(|v| v.as_f64() == Some(0.0));
    HostLabel { causes: out, healthy }
}
