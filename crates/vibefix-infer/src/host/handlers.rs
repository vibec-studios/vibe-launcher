use regex::Captures;
use serde_json::{json, Value};

use super::context::{ascii_lower, builtin, clean_range, config_path, noise, recommended_java, rust_lines, safe_rel};
use super::context::{small_uint, Source, LOADER_IDS};
use super::index::Index;
use super::table::{ClassHint, Rule};
use super::types::{text, OMap};
use crate::unicode::strip;

pub struct Ctx<'a> {
    pub source: &'a Source,
    pub pos: usize,
    pub loader: Option<&'a str>,
    pub mc: Option<&'a str>,
    pub index: &'a Index,
    pub hints: &'a [ClassHint],
}

pub type Handled = Option<(String, OMap)>;

fn capture<'t>(caps: &Captures<'t>, key: &str) -> Option<&'t str> {
    [key.to_owned(), format!("{key}2"), format!("{key}3")]
        .iter()
        .find_map(|name| caps.name(name))
        .map(|m| strip(m.as_str()))
        .filter(|v| !v.is_empty())
}

fn uint(value: Option<&str>) -> Option<i64> {
    let v = value.filter(|v| !v.is_empty() && v.chars().all(|c| c.is_ascii_digit()))?;
    small_uint(v).map(|n| n as i64)
}

fn found(cause: &str, pairs: Vec<(&str, Value)>) -> Handled {
    Some((cause.to_owned(), OMap::from_pairs(pairs)))
}

fn dependency_version(get: &dyn Fn(&str) -> Option<String>, mod_id: Value) -> Handled {
    let dep = ascii_lower(&get("dep_id").unwrap_or_default());
    if dep.is_empty() {
        return None;
    }
    let span = json!(clean_range(&get("range").unwrap_or_default()));
    let present = text(get("present").as_deref());
    if dep == "minecraft" {
        return found("wrong_minecraft", vec![("mod_id", mod_id), ("range", span), ("mc_version", present)]);
    }
    if dep == "java" {
        let range = get("range").unwrap_or_default();
        let digits: String =
            range.chars().skip_while(|c| !c.is_ascii_digit()).take_while(char::is_ascii_digit).collect();
        let major = uint(Some(&digits)).filter(|&m| m >= 8)?;
        return found("java_version", vec![("java_major", json!(major)), ("present_version", present)]);
    }
    if LOADER_IDS.contains(&dep.as_str()) {
        let pairs = vec![("mod_id", mod_id), ("loader", json!(dep)), ("range", span), ("present_version", present)];
        return found("loader_version", pairs);
    }
    found(
        "outdated_dependency",
        vec![("mod_id", mod_id), ("dep_id", json!(dep)), ("range", span), ("present_version", present)],
    )
}

fn missing_class(get: &dyn Fn(&str) -> Option<String>, ctx: &Ctx<'_>) -> Handled {
    let cls = get("class").unwrap_or_default().replace('.', "/");
    let loader_ok =
        |h: &ClassHint| h.loader.as_ref().map_or(true, |l| ctx.loader.is_some_and(|x| l.iter().any(|y| y == x)));
    let hint = ctx.hints.iter().find(|h| cls.starts_with(&h.prefix) && loader_ok(h))?;
    if hint.ids.iter().any(|id| ctx.index.has(id)) {
        return None;
    }
    let window = ctx.source.window(ctx.pos, 4000);
    let culprit = ctx.index.referenced_mods(window).into_iter().find(|m| !noise(m));
    found(
        "missing_dependency",
        vec![("dep_id", json!(hint.module)), ("class", json!(cls.replace('/', "."))), ("mod_id", json!(culprit))],
    )
}

fn java_kind(kind: &str, get: &dyn Fn(&str) -> Option<String>, mc: Option<&str>) -> Handled {
    let rec = recommended_java(mc);
    match kind {
        "java_8" => (rec.is_none() || rec <= Some(8))
            .then(|| ("java_version".to_owned(), OMap::from_pairs([("java_major", json!(8))]))),
        "java_too_new" => {
            let runtime = uint(get("runtime").as_deref())?;
            let rec = rec?;
            (rec < runtime - 44).then(|| {
                let pairs = [("java_major", json!(rec)), ("present_version", json!((runtime - 44).to_string()))];
                ("java_version".to_owned(), OMap::from_pairs(pairs))
            })
        }
        _ => {
            let cls = uint(get("class").as_deref()).filter(|&c| c >= 45)?;
            let present = uint(get("runtime").as_deref()).filter(|&r| r >= 45).map(|r| (r - 44).to_string());
            found("java_version", vec![("java_major", json!(cls - 44)), ("present_version", json!(present))])
        }
    }
}

fn broken_config(get: &dyn Fn(&str) -> Option<String>, ctx: &Ctx<'_>) -> Handled {
    let path = if let Some(raw) = get("path") {
        if ascii_lower(&get("ctype").unwrap_or_default()) == "server" {
            return None;
        }
        let rel = safe_rel(&raw.replace('\\', "/"));
        config_path(&format!(" {raw}")).or_else(|| rel.map(|r| format!("config/{r}")))
    } else {
        let text = &ctx.source.text;
        let start = ctx.source.start(ctx.pos);
        let after: Vec<&str> = text[start..].splitn(6, '\n').take(5).collect();
        let head = text[..start].strip_suffix('\n').unwrap_or(&text[..start]);
        let mut before: Vec<&str> = head.rsplitn(3, '\n').take(2).collect();
        before.truncate(2);
        after.iter().chain(before.iter()).find_map(|line| config_path(line))
    };
    let path = path?;
    found("broken_config", vec![("mod_id", text(get("mod_id").as_deref())), ("config_path", json!(path))])
}

fn mixin(kind: &str, get: &dyn Fn(&str) -> Option<String>, ctx: &Ctx<'_>) -> Handled {
    let index = ctx.index;
    if kind == "mixin_conflict" {
        let a = index.referenced_mods(&get("a").unwrap_or_default());
        let b = index.referenced_mods(&get("b").unwrap_or_default());
        return match (a.first(), b.first()) {
            (Some(x), Some(y)) if x != y => found("mixin_conflict", vec![("mod_id", json!(x)), ("other_id", json!(y))]),
            _ => None,
        };
    }
    let window = ctx.source.window(ctx.pos, 8000);
    let mut mods = index.referenced_mods(&rust_lines(window).into_iter().take(3).collect::<Vec<_>>().join("\n"));
    if mods.is_empty() {
        mods = index.referenced_mods(window).into_iter().filter(|m| !noise(m)).take(1).collect();
    }
    let quiet: Vec<String> = mods.iter().filter(|m| !noise(m)).cloned().collect();
    let mods = if quiet.is_empty() { mods } else { quiet };
    match mods.as_slice() {
        [first, second, ..] => found("mixin_conflict", vec![("mod_id", json!(first)), ("other_id", json!(second))]),
        [first] => found("mixin", vec![("mod_id", json!(first))]),
        [] => None,
    }
}

fn suspected(get: &dyn Fn(&str) -> Option<String>) -> Handled {
    let detail = get("detail").unwrap_or_default();
    let first = strip(detail.split(',').next().unwrap_or("")).to_owned();
    let (a, b) = (first.find('('), first.find(')'));
    let fallback = match (a, b) {
        (Some(a), Some(b)) if a < b => first[a + 1..b].to_owned(),
        _ => first.clone(),
    };
    let id = get("mod_id").unwrap_or(fallback);
    (!id.is_empty() && !builtin(&id) && ascii_lower(&id) != "none")
        .then(|| ("suspected_mod".to_owned(), OMap::from_pairs([("mod_id", json!(id))])))
}

pub fn handle(rule: &Rule, caps: &Captures<'_>, ctx: &Ctx<'_>) -> Handled {
    let get = |key: &str| capture(caps, key).map(str::to_owned);
    let (mod_id, dep, other) = (get("mod_id"), get("dep_id"), get("other_id"));
    let kind = rule.kind.as_str();
    match kind {
        "manual" => Some((rule.id.clone(), OMap::default())),
        "missing_dependency" => {
            let dep = dep.filter(|d| !builtin(d) && !ctx.index.has(&ascii_lower(d)))?;
            let range = clean_range(&get("range").unwrap_or_default());
            found(kind, vec![("mod_id", text(mod_id.as_deref())), ("dep_id", json!(dep)), ("range", json!(range))])
        }
        "dependency_version" => dependency_version(&get, text(mod_id.as_deref())),
        "declared_conflict" => {
            let other = other.filter(|o| !builtin(o))?;
            found("mod_conflict", vec![("mod_id", json!(other)), ("other_id", text(mod_id.as_deref()))])
        }
        "missing_class" => missing_class(&get, ctx),
        "wrong_loader_file" => {
            let raw = get("file").unwrap_or_default();
            let file = strip(raw.rsplit(['/', '\\']).next().unwrap_or("")).to_owned();
            if file.is_empty() {
                return None;
            }
            let loader = ascii_lower(&get("loader").unwrap_or_default()).replace("minecraft ", "");
            let id = ctx.index.id_for(Some(&file));
            found(
                "wrong_loader",
                vec![("file", json!(file)), ("mod_id", json!(id)), ("required_loader", json!(loader))],
            )
        }
        "duplicate_files" => {
            let raw = get("files")?;
            let files: Vec<&str> = raw.split(',').map(strip).filter(|f| !f.is_empty()).collect();
            found("duplicate_mod", vec![("mod_id", text(mod_id.as_deref())), ("files", json!(files.join(", ")))])
        }
        "duplicate_id" => {
            let id = mod_id.filter(|m| !builtin(m))?;
            found("duplicate_mod", vec![("mod_id", json!(id))])
        }
        "java_class_version" | "java_too_new" | "java_8" => java_kind(kind, &get, ctx.mc),
        "out_of_memory" | "heap_reserve" | "graphics" => found(kind, vec![("detail", text(get("detail").as_deref()))]),
        "mixin_failure" | "mixin_conflict" => mixin(kind, &get, ctx),
        "broken_config" => broken_config(&get, ctx),
        "suspected_mod" => suspected(&get),
        _ => None,
    }
}
