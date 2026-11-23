use super::*;
use vibefix_infer::{Analysis, AnyModel, Cause, EntityMap, Location};

fn cause(id: &str, conf: f64, ents: &[(&str, &[&str])], file: &str, line: usize) -> Cause {
    let at = Location { file: file.into(), line };
    Cause {
        cause: id.into(),
        confidence: conf,
        actions: vec![],
        entities: EntityMap(ents.iter().map(|(k, v)| (k.to_string(), v.iter().map(|s| s.to_string()).collect())).collect()),
        evidence: Some(at.clone()),
        locations: vec![at],
    }
}

fn analysis(status: &str, causes: Vec<Cause>) -> Analysis {
    Analysis { status: status.into(), crash_score: Some(0.91), ood: 0.0, ood_score: 0.0, healthy: status == "healthy", causes, entities: vec![] }
}

fn sodium_extra() -> ModIndex {
    idx(&[("sodium-extra", "sodium-extra-0.5.4.jar", Some("Sodium Extra"), Some("0.5.4")), ("modmenu", "modmenu-9.0.0.jar", Some("Mod Menu"), Some("9.0.0"))])
}

#[test]
fn taxonomy_maps_to_launcher_diagnoses() {
    assert_eq!(launcher_id("driver_amd"), "graphics");
    assert_eq!(launcher_id("java_too_new"), "java_version");
    assert_eq!(launcher_id("disabled_dependency"), "missing_dependency");
    assert_eq!(launcher_id("mixin_target_missing"), "mixin");
    assert_eq!(launcher_id("ticking_entity"), "ticking_entity");
    assert_eq!(launcher_id("missing_dependency"), "missing_dependency");
}

#[test]
fn model_confirms_rule_findings() {
    let src = vec![fixture("fabric-missing-dependency.txt")];
    let c = ctx("fabric", "1.20.4");
    let mods = sodium_extra();
    let rules = analyze(&src, &c, &mods);
    let a = analysis("diagnosed", vec![cause("missing_dependency", 0.49, &[("mod_id", &["sodium-extra", "modmenu"]), ("dep_id", &["fabric-api", "cloth-config"])], "fabric-missing-dependency.txt", 8)]);
    let r = from_analysis(&a, "3", &src, &c, &mods, rules.clone());
    assert_eq!(r.info.engine, "vibefix");
    assert_eq!(r.info.status.as_deref(), Some("diagnosed"));
    let deps: Vec<&Diagnosis> = r.diagnoses.iter().filter(|d| d.id == "missing_dependency").collect();
    assert_eq!(deps.len(), rules.iter().filter(|d| d.id == "missing_dependency").count());
    assert!(deps.iter().all(|d| d.origin.as_deref() == Some("both") && d.model_confidence == Some(0.49)));
    assert!(deps.iter().all(|d| d.actions.iter().any(|a| matches!(a, Action::InstallDependency { .. }))));
}

#[test]
fn model_only_causes_get_launcher_actions_and_location() {
    let text = "[12:00:00] [main/INFO]: Loading Minecraft 1.18.2\nline two\njava.lang.IllegalArgumentException: Unsupported class file major version 65\n";
    let src = vec![LogText::new("logs/latest.log", text)];
    let c = ctx("forge", "1.18.2");
    let a = analysis("diagnosed", vec![cause("java_too_new", 0.45, &[("java_major", &["17"]), ("present_version", &["21"])], "logs/latest.log", 3)]);
    let r = from_analysis(&a, "3", &src, &c, &ModIndex::default(), vec![]);
    let d = &r.diagnoses[0];
    assert_eq!((d.id.as_str(), d.origin.as_deref(), d.model_cause.as_deref()), ("java_version", Some("vibefix"), Some("java_too_new")));
    assert_eq!(d.params.get("direction").map(String::as_str), Some("older"));
    assert_eq!(d.actions.first(), Some(&Action::SetJava { major: 17 }));
    assert_eq!(d.actions.last(), Some(&Action::Upload));
    assert_eq!((d.source.as_deref(), d.line), (Some("logs/latest.log"), Some(3)));
    assert!(d.evidence.as_deref().unwrap_or("").contains("major version 65"));
}

#[test]
fn model_entities_resolve_files_from_the_mods_folder() {
    let src = vec![LogText::new("logs/latest.log", "a\nb\n")];
    let mods = idx(&[("cloth-config", "cloth-config-15.0.127.jar", Some("Cloth Config"), Some("15.0.127")), ("rei", "rei.jar", Some("REI"), None)]);
    let a = analysis(
        "diagnosed",
        vec![
            cause("outdated_dependency", 0.47, &[("mod_id", &["rei"]), ("dep_id", &["cloth-config"]), ("range", &["15.0.140 or later"])], "logs/latest.log", 1),
            cause("mixin", 0.4, &[("mod_id", &["rei"])], "logs/latest.log", 2),
            cause("broken_config", 0.4, &[("config_path", &["config\\sodium-options.json"])], "logs/latest.log", 2),
        ],
    );
    let r = from_analysis(&a, "3", &src, &ctx("fabric", "1.21.1"), &mods, vec![]);
    let up = find(&r.diagnoses, "outdated_dependency");
    assert_eq!(up.actions[0], Action::UpdateMod { file: "cloth-config-15.0.127.jar".into(), mod_id: "cloth-config".into() });
    assert_eq!(up.params.get("present").map(String::as_str), Some("15.0.127"));
    let mixin = find(&r.diagnoses, "mixin");
    assert_eq!(mixin.actions[0], Action::DisableMod { file: "rei.jar".into() });
    assert_eq!(mixin.culprit.as_ref().and_then(|c| c.name.as_deref()), Some("REI"));
    let cfg = find(&r.diagnoses, "broken_config");
    assert_eq!(cfg.actions[0], Action::ResetConfig { path: "config/sodium-options.json".into() });
}

#[test]
fn unknown_crash_asks_to_share_the_log() {
    let src = vec![fixture("normal-fabric.txt")];
    let c = ctx("fabric", "1.21.1");
    let rules = analyze(&src, &c, &ModIndex::default());
    assert!(rules.iter().any(|d| d.id == "exit_code"));
    let r = from_analysis(&analysis("unknown", vec![]), "3", &src, &c, &ModIndex::default(), rules);
    assert_eq!(r.info.status.as_deref(), Some("unknown"));
    assert_eq!(r.diagnoses[0].id, "unknown");
    assert_eq!(r.diagnoses[0].actions, vec![Action::Upload]);
    assert!(!r.diagnoses.iter().any(|d| d.id == "exit_code"));
}

#[test]
fn rule_findings_stay_visible_when_the_model_disagrees() {
    let src = vec![fixture("oom.txt")];
    let c = Ctx { crash_report: true, ..ctx("fabric", "1.21.1") };
    let rules = analyze(&src, &c, &ModIndex::default());
    let r = from_analysis(&analysis("healthy", vec![]), "3", &src, &c, &ModIndex::default(), rules.clone());
    assert_eq!(r.diagnoses.len(), rules.len());
    assert!(r.diagnoses.iter().all(|d| d.origin.as_deref() == Some("rules")));
}

#[test]
fn evidence_lines_follow_streamed_logs() {
    let t = crate::util::testdir::TestDir::new("vibefix-lines");
    let mut s = String::new();
    for i in 1..=200_000u32 {
        if i == 123_456 {
            s.push_str("[main/ERROR]: java.lang.OutOfMemoryError: Java heap space\n");
        } else {
            s.push_str(&format!("[12:00:00] [Server thread/INFO]: Saving chunks for level 'ServerLevel[World]' {i}\n"));
        }
    }
    let p = t.path().join("latest.log");
    std::fs::write(&p, &s).unwrap();
    let src = vec![LogText::read(&p, "logs/latest.log").unwrap()];
    let pos = src[0].text.find("OutOfMemoryError").unwrap();
    let n = src[0].text[..pos].matches('\n').count() + 1;
    assert!(n < 123_456);
    let a = analysis("diagnosed", vec![cause("out_of_memory", 0.5, &[], "logs/latest.log", n)]);
    let r = from_analysis(&a, "3", &src, &ctx("fabric", "1.21.1"), &ModIndex::default(), vec![]);
    assert_eq!(find(&r.diagnoses, "out_of_memory").line, Some(123_456));
}

#[test]
fn without_model_the_rules_answer() {
    let src = vec![fixture("fabric-missing-dependency.txt")];
    let c = ctx("fabric", "1.20.4");
    let mods = sodium_extra();
    let r = combine(None, Some("unavailable"), &src, &c, &mods, None);
    assert_eq!(r.info, AnalysisInfo::rules(Some("unavailable")));
    assert_eq!(r.diagnoses, analyze(&src, &c, &mods));
    assert!(r.diagnoses.iter().all(|d| d.origin.is_none()));
}

#[test]
fn meta_carries_instance_details() {
    let src = vec![fixture("fabric-missing-dependency.txt")];
    let files = log_files(&src);
    assert_eq!(files[0].kind, "latest_log");
    let m = meta(&files, &ctx("fabric", "1.20.4"), &sodium_extra(), Some("0.16.9"));
    assert_eq!(m["mc"], "1.20.4");
    assert_eq!(m["loader"], "fabric");
    assert_eq!(m["exit_code"], 1);
    let mods = m["mods"].as_array().unwrap();
    assert!(mods.iter().any(|e| e["id"] == "modmenu" && e["file"] == "modmenu-9.0.0.jar"));
}

#[test]
fn packaged_model_runs_on_fixtures() {
    let Some(dir) = std::env::var_os("VIBEFIX_MODEL_DIR") else { return };
    let model = AnyModel::load(dir).unwrap();
    let mods = sodium_extra();
    let src = vec![fixture("fabric-missing-dependency.txt")];
    let r = combine(Some((&model, "3")), None, &src, &ctx("fabric", "1.20.4"), &mods, Some("0.16.9"));
    assert_eq!(r.info.engine, "vibefix");
    assert_eq!(r.diagnoses[0].id, "missing_dependency");
    assert!(r.diagnoses[0].origin.as_deref() != Some("rules"));
    let healthy = vec![fixture("normal-fabric.txt")];
    let r = combine(Some((&model, "3")), None, &healthy, &Ctx { exit_code: Some(0), ..ctx("fabric", "1.21.1") }, &ModIndex::default(), None);
    assert_eq!(r.info.status.as_deref(), Some("healthy"));
}
