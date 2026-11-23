use std::sync::LazyLock;

use serde_json::{json, Map, Value};

use super::context::{recommended_java, Source};
use super::hints::{Hint, HINTS};
use super::index::Index;
use super::pyre::Py;
use super::rules::{fatal_case, meta_text};
use super::table::TABLE;
use super::types::{Evidence, HostFinding, HostLabel, OMap};
use crate::LogFile;

pub const EXIT_BLOCKERS: [&str; 4] =
    ["Stopping!", "Successfully logged in", "Joined the game", "Logged in with entity id"];
const NETWORK: [&str; 4] = ["network_timeout", "network_dns", "network_tls", "auth_session"];
static CANDIDATE: LazyLock<Py> = LazyLock::new(|| {
    Py::new(concat!(
        r"(?i)Exception|Error|failed|disabled|cannot (?:load|be loaded|run)|requires|unsupported|",
        r"Direct buffer|OpenGL|GLFW|^# [CVJ]|incompatible|was not found|Invalid tag|Invalid chunk|",
        r"truncated|wrong location|Disconnect|Description: Ticking|Watching Server|server tick took|Duplicate|Unknown recipe"
    ))
});
static TARGET: LazyLock<Py> = LazyLock::new(|| Py::new(r"(?:Entity Type|Name):\s*([\w.-]+:[\w./-]+)"));

fn healthy(meta: &Map<String, Value>, files: &[LogFile]) -> bool {
    meta.get("exit_code").is_some_and(|v| v.as_f64() == Some(0.0))
        || files.iter().any(|f| f.text.contains("Stopping!") || f.text.contains("All dimensions are saved"))
}

fn int(value: Option<Value>) -> i64 {
    value.and_then(|v| v.as_str().and_then(|s| s.parse::<i64>().ok())).unwrap_or(0)
}

fn rename(e: &mut OMap, from: &str, to: &str) {
    if let Some(v) = e.remove(from) {
        e.insert(to, v);
    }
}

struct Scope<'a> {
    meta: &'a Map<String, Value>,
    index: &'a Index,
    baseline: &'a [HostFinding],
}

fn contextualize(hint: &Hint, whole: &str, mut e: OMap, nearby: &str, s: &Scope<'_>) -> Option<OMap> {
    let (loader, mc) = (meta_text(s.meta, "loader"), meta_text(s.meta, "mc"));
    match hint.cause {
        "missing_class" => {
            let cls = e.text("class").unwrap_or("").replace('.', "/");
            let covered = s.baseline.iter().any(|r| {
                r.cause == "missing_dependency" && r.entities.text("class").unwrap_or("").replace('.', "/") == cls
            });
            if covered {
                return None;
            }
        }
        "disabled_dependency" => {
            let file = e.text("file").unwrap_or("").to_owned();
            let row = s.baseline.iter().find(|r| {
                r.cause == "missing_dependency"
                    && s.index.disabled_file(&r.entities.text("dep_id").unwrap_or("").to_lowercase())
                        == Some(file.as_str())
            })?;
            for key in ["mod_id", "dep_id"] {
                if let Some(v) = row.entities.get(key) {
                    e.insert(key, v.clone());
                }
            }
        }
        "forge_mod_on_fabric" => {
            if loader != Some("fabric") {
                return None;
            }
            e.insert("loader", json!("fabric"));
            e.insert("required_loader", json!("forge"));
            let file = e.text("file").unwrap_or("").rsplit(['/', '\\']).next().unwrap_or("").to_owned();
            e.insert("file", json!(file));
        }
        "java_too_old" => {
            let major = int(e.remove("required_major")) - 44;
            e.insert("java_major", json!(major));
            if let Some(runtime) = e.remove("runtime_major") {
                e.insert("present_version", json!((int(Some(runtime)) - 44).to_string()));
            }
        }
        "java_too_new" => {
            let target = recommended_java(mc);
            let runtime = e.remove("runtime_major").map_or(0, |v| int(Some(v))) - 44;
            if runtime >= 1 && target.map_or(true, |t| runtime <= t) {
                return None;
            }
            if runtime < 1 && !matches!(target, Some(8) | None) {
                return None;
            }
            e.insert("java_major", json!(target.filter(|&t| t != 0).unwrap_or(8)));
            if let Some(mc) = mc.filter(|m| !m.is_empty()) {
                e.insert("mc_version", json!(mc));
            }
            if runtime >= 1 {
                e.insert("present_version", json!(runtime.to_string()));
            }
        }
        "mixin_target_missing" => {
            if let Some(first) = s.index.referenced_mods(nearby).into_iter().next() {
                e.insert("mod_id", json!(first));
            }
        }
        "opengl_version" if e.contains("needed") => rename(&mut e, "needed", "range"),
        "wrong_mod_environment" if e.contains("environment_class") => rename(&mut e, "environment_class", "class"),
        "network_tls" if e.contains("tls_class") => rename(&mut e, "tls_class", "class"),
        "recipe_parse" if e.contains("serializer") => rename(&mut e, "serializer", "resource_id"),
        "native_lwjgl" => {
            if e.contains("library") {
                rename(&mut e, "library", "file");
            }
            if whole.contains("UnsatisfiedLinkError") {
                e.insert("class", json!("java.lang.UnsatisfiedLinkError"));
            }
        }
        "shader_mod_conflict" => {
            e.insert("mod_id", json!(if whole.to_lowercase().contains("oculus") { "oculus" } else { "iris" }));
            let other = if matches!(loader, Some("fabric" | "quilt")) { "optifabric" } else { "optifine" };
            e.insert("other_id", json!(other));
        }
        "connector_dependency" => e.insert("mod_id", json!("connector")),
        "loader_files" => {
            if let Some(l) = loader.filter(|l| !l.is_empty()) {
                e.insert("loader", json!(l));
            }
        }
        "ticking_entity" | "ticking_block_entity" => {
            if let Some(target) = TARGET.group(nearby, 1) {
                e.insert("resource_id", json!(target));
            }
        }
        _ => {}
    }
    Some(e)
}

pub fn diagnose(
    sources: &[Source],
    files: &[LogFile],
    meta: &Map<String, Value>,
    index: &Index,
    baseline: &[HostFinding],
) -> HostLabel {
    let fatal = fatal_case(meta, sources, &TABLE) || meta.get("crash").is_some_and(|v| v.as_bool() == Some(true));
    let scope = Scope { meta, index, baseline };
    let mut out: Vec<HostFinding> = Vec::new();
    for src in sources {
        let recovered = !fatal && EXIT_BLOCKERS.iter().any(|m| src.text.contains(m));
        let lines: Vec<&str> = src.text.split('\n').collect();
        for (i, line) in lines.iter().enumerate() {
            if !CANDIDATE.is_match(line) || line.contains("Error loading class:") {
                continue;
            }
            if line.contains("/WARN]") && !line.contains("disabled") {
                continue;
            }
            for hint in HINTS.iter() {
                if (hint.fatal && !fatal) || (hint.cause.starts_with("driver_") && src.kind != "hs_err") {
                    continue;
                }
                if out.iter().any(|f| f.cause == hint.cause) {
                    continue;
                }
                let Some(caps) = hint.pattern.search(line) else { continue };
                if NETWORK.contains(&hint.cause) && recovered {
                    continue;
                }
                let driver = out.iter().any(|f| f.cause.starts_with("driver_"));
                if hint.cause == "native_jvm_crash" && (src.kind != "hs_err" || driver) {
                    continue;
                }
                let groups = hint.names.iter().filter_map(|n| caps.name(n).map(|m| (n.clone(), json!(m.as_str()))));
                let entities = OMap::from_pairs(groups.filter(|(_, v)| v.as_str() != Some("")));
                let whole = caps.get(0).map_or("", |m| m.as_str());
                let nearby = lines[i..(i + 16).min(lines.len())].join("\n");
                if let Some(e) = contextualize(hint, whole, entities, &nearby, &scope) {
                    let evidence = Some(Evidence { file: src.name.clone(), line: i + 1 });
                    out.push(HostFinding {
                        cause: hint.cause.to_owned(),
                        confidence: hint.confidence,
                        entities: e,
                        evidence,
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| b.confidence.total_cmp(&a.confidence));
    let healthy = !fatal && out.is_empty() && healthy(meta, files);
    HostLabel { causes: out, healthy }
}
