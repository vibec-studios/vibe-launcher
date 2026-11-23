use super::*;
use serde_json::{json, Map, Value};
use std::panic::{catch_unwind, AssertUnwindSafe};
use vibefix_infer::{Analysis, AnyModel, LogFile};

pub fn log_files(sources: &[LogText]) -> Vec<LogFile> {
    sources
        .iter()
        .map(|s| LogFile { kind: vibefix_infer::identify(&s.text, &s.name).into(), name: s.name.clone(), text: s.text.clone() })
        .collect()
}

fn mod_entries(mods: &ModIndex) -> Vec<Value> {
    let mut ids: Vec<&String> = mods.by_id.keys().collect();
    ids.sort();
    let mut out = vec![];
    for id in ids {
        let mut mixins: Vec<&String> = mods.mixins.iter().filter(|(_, v)| *v == id).map(|(k, _)| k).collect();
        mixins.sort();
        let packages: Vec<&str> = mods.packages.iter().filter(|(_, v)| v == id).map(|(p, _)| p.trim_end_matches('.')).collect();
        for e in &mods.by_id[id] {
            out.push(json!({"id": id, "name": e.name, "version": e.version, "file": e.file, "mixins": mixins, "packages": packages}));
        }
    }
    let mut off: Vec<(&String, &ModEntry)> = mods.disabled.iter().collect();
    off.sort_by(|a, b| a.0.cmp(b.0));
    for (id, e) in off {
        out.push(json!({"id": id, "name": e.name, "version": e.version, "file": e.file, "disabled": true}));
    }
    out
}

pub fn meta(files: &[LogFile], ctx: &Ctx, mods: &ModIndex, loader_version: Option<&str>) -> Map<String, Value> {
    let mut given = Map::new();
    given.insert("loader".into(), json!(ctx.loader));
    if let Some(v) = loader_version.filter(|v| !v.is_empty()) {
        given.insert("loader_version".into(), json!(v));
    }
    if let Some(code) = ctx.exit_code {
        given.insert("exit_code".into(), json!(code));
    }
    given.insert("mods".into(), Value::Array(mod_entries(mods)));
    let mut meta = vibefix_infer::host::with_metadata(files, Some(&given));
    if let Some(mc) = ctx.mc_version.as_ref().filter(|v| !v.is_empty()) {
        meta.insert("mc".into(), json!(mc));
    }
    meta
}

pub fn run_model(model: &AnyModel, sources: &[LogText], ctx: &Ctx, mods: &ModIndex, loader_version: Option<&str>) -> Analysis {
    let files = log_files(sources);
    let meta = meta(&files, ctx, mods, loader_version);
    model.analyze_with_meta(&files, Some(&meta))
}

pub fn combine(model: Option<(&AnyModel, &str)>, notice: Option<&str>, sources: &[LogText], ctx: &Ctx, mods: &ModIndex, loader_version: Option<&str>) -> CrashAnalysis {
    let rules = analyze(sources, ctx, mods);
    let Some((model, version)) = model else {
        return CrashAnalysis { diagnoses: rules, info: AnalysisInfo::rules(notice) };
    };
    let Ok(analysis) = catch_unwind(AssertUnwindSafe(|| run_model(model, sources, ctx, mods, loader_version))) else {
        tracing::warn!("VibeFix: Analyse fehlgeschlagen, Regel-Analyse verwendet");
        return CrashAnalysis { diagnoses: rules, info: AnalysisInfo::rules(Some("error")) };
    };
    from_analysis(&analysis, version, sources, ctx, mods, rules)
}

pub fn from_analysis(analysis: &Analysis, version: &str, sources: &[LogText], ctx: &Ctx, mods: &ModIndex, rules: Vec<Diagnosis>) -> CrashAnalysis {
    let info = AnalysisInfo {
        engine: "vibefix".into(),
        status: Some(analysis.status.clone()),
        model_version: Some(version.into()),
        crash_score: analysis.crash_score.or((analysis.status == "unknown").then_some(analysis.ood_score)),
        notice: None,
    };
    CrashAnalysis { diagnoses: merge(analysis, sources, ctx, mods, rules), info }
}
