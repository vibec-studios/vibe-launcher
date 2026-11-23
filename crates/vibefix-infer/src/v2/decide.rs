use std::collections::HashMap;

use serde::Serialize;

use super::candidates::{entity_pairs, norm, ENTITY_TYPES};
use super::net::Outputs2;
use super::package::Calibration2;
use super::prepare::Prepared;
use crate::diagnosis::{top_indices, Entity, Finding, Location};
use crate::host::HostFinding;

const SKIP: [&str; 3] = ["exit_code", "healthy", "unknown"];
const GENERIC: [(&str, &[&str]); 5] = [
    ("java_version", &["java_too_old", "java_too_new"]),
    ("native_memory", &["metaspace_exhausted", "direct_buffer_exhausted", "native_thread_exhausted"]),
    ("graphics", &["glfw_context", "opengl_version", "driver_intel", "driver_amd", "driver_nvidia", "shader_compile"]),
    ("mixin", &["mixin_conflict", "mixin_target_missing"]),
    ("missing_class", &["missing_dependency", "wrong_mod_environment"]),
];
const FALLBACK: &str = "suspected_mod";

#[derive(Debug, Clone, Serialize)]
pub struct Prediction2 {
    pub status: String,
    pub crash_score: f64,
    pub ood_score: f64,
    pub causes: Vec<Finding>,
    pub entities: Vec<Entity>,
}

pub struct Context2<'a> {
    pub causes: &'a [String],
    pub actions: &'a HashMap<String, Vec<String>>,
    pub types: &'a HashMap<String, Vec<usize>>,
    pub calibration: &'a Calibration2,
}

fn sigmoid64(v: f64) -> f64 {
    1.0 / (1.0 + (-v.clamp(-60.0, 60.0)).exp())
}

fn sigmoid32(v: f32) -> f32 {
    1.0 / (1.0 + (-v.clamp(-60.0, 60.0)).exp())
}

type Chosen = Vec<(String, f64)>;

fn order_desc(values: &[f64]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..values.len()).collect();
    order.sort_by(|&a, &b| values[b].total_cmp(&values[a]));
    order
}

fn set_default(chosen: &mut Chosen, cause: &str, value: f64) {
    if !chosen.iter().any(|(c, _)| c == cause) {
        chosen.push((cause.to_owned(), value));
    }
}

fn specific_only(chosen: Chosen) -> Chosen {
    let names: Vec<&str> = chosen.iter().map(|(c, _)| c.as_str()).collect();
    let mut drop: Vec<&str> = GENERIC
        .iter()
        .filter(|(g, s)| names.contains(g) && s.iter().any(|x| names.contains(x)))
        .map(|(g, _)| *g)
        .collect();
    if names.iter().any(|n| !drop.contains(n) && *n != FALLBACK) && names.contains(&FALLBACK) {
        drop.push(FALLBACK);
    }
    let drop: Vec<String> = drop.into_iter().map(str::to_owned).collect();
    chosen.into_iter().filter(|(c, _)| !drop.contains(c)).collect()
}

const DEBUG_CRASH: &str = "Manually triggered debug crash";

fn debug_crash(p: &Prepared) -> bool {
    p.lines.iter().any(|l| l.text.contains(DEBUG_CRASH))
}

fn fatal(p: &Prepared, level: f64) -> bool {
    if debug_crash(p) {
        false
    } else if level == 2.0 {
        p.flags[1] > 0.0
    } else {
        p.flags[0] > 0.0 || p.flags[1] > 0.0
    }
}

fn certain<'a>(p: &'a Prepared, cal: &Calibration2, crash: f64) -> Vec<(String, Vec<&'a HostFinding>)> {
    let gated = crash >= cal.crash || p.flags[0] > 0.0;
    let trusted = crash >= cal.rule_crash && (cal.rule_fatal == 0.0 || fatal(p, 1.0));
    let mut sources: Vec<(&[HostFinding], f64)> = Vec::new();
    if trusted {
        sources.push((&p.rules, cal.rule_floor));
    }
    if gated {
        sources.push((&p.heuristics, cal.heuristic_floor));
    }
    let mut chosen: Vec<(String, Vec<&HostFinding>)> = Vec::new();
    for (findings, floor) in sources {
        for record in findings {
            if SKIP.contains(&record.cause.as_str()) || record.confidence < floor {
                continue;
            }
            match chosen.iter_mut().find(|(c, _)| *c == record.cause) {
                Some(slot) => slot.1.push(record),
                None => chosen.push((record.cause.clone(), vec![record])),
            }
        }
    }
    chosen
}

fn evidence_for(cause: &str, index: Option<usize>, p: &Prepared, out: &Outputs2, count: usize) -> Vec<Location> {
    let mut points: Vec<Location> = p
        .rules
        .iter()
        .chain(&p.heuristics)
        .filter(|r| r.cause == cause)
        .filter_map(|r| {
            r.evidence.as_ref().filter(|e| e.line > 0).map(|e| Location { file: e.file.clone(), line: e.line })
        })
        .collect();
    if let Some(i) = index {
        let column = out.pointer.iter().skip(i).step_by(count).copied();
        for j in top_indices(column, 3) {
            let line = &p.lines[j];
            if line.number > 0 {
                points.push(Location { file: line.file.clone(), line: line.number });
            }
        }
    }
    let mut unique: Vec<Location> = Vec::new();
    for point in points {
        if !unique.contains(&point) {
            unique.push(point);
        }
    }
    unique.truncate(3);
    unique
}

fn entities_for(
    p: &Prepared,
    out: &Outputs2,
    chosen: &Chosen,
    certain: &[(String, Vec<&HostFinding>)],
    ctx: &Context2<'_>,
) -> Vec<Entity> {
    let mut allowed: Vec<(usize, String)> = Vec::new();
    for (cause, _) in chosen {
        for &kind in ctx.types.get(cause).map_or(&[][..], Vec::as_slice) {
            if !allowed.iter().any(|(k, _)| *k == kind) {
                allowed.push((kind, cause.clone()));
            }
        }
    }
    let mut found: Vec<((usize, String), Entity)> = Vec::new();
    for (cause, records) in certain.iter().filter(|(c, _)| chosen.iter().any(|(x, _)| x == c)) {
        for (kind, value) in entity_pairs(records) {
            let key = (kind, norm(&value));
            if !found.iter().any(|(k, _)| *k == key) {
                let entity = Entity {
                    entity: ENTITY_TYPES[kind].into(),
                    text: value,
                    cause: Some(cause.clone()),
                    file: None,
                    line: None,
                    start_byte: None,
                    end_byte: None,
                    score: Some(1.0),
                };
                found.push((key, entity));
            }
        }
    }
    for (k, logits) in out.candidates.iter().enumerate() {
        for (t, &logit) in logits.iter().enumerate() {
            let score = sigmoid32(logit);
            if score < ctx.calibration.entity as f32 {
                continue;
            }
            let Some((_, cause)) = allowed.iter().find(|(kind, _)| *kind == t) else { continue };
            let candidate = &p.candidates[k];
            let key = (t, norm(&candidate.value));
            if found.iter().any(|(x, _)| *x == key) {
                continue;
            }
            let line = usize::try_from(candidate.line).ok().and_then(|j| p.lines.get(j));
            let entity = Entity {
                entity: ENTITY_TYPES[t].into(),
                text: candidate.value.clone(),
                cause: Some(cause.clone()),
                file: line.map(|l| l.file.clone()),
                line: line.map(|l| l.number),
                start_byte: None,
                end_byte: None,
                score: Some(f64::from(score)),
            };
            found.push((key, entity));
        }
    }
    let mut entities: Vec<Entity> = found.into_iter().map(|(_, e)| e).collect();
    entities.sort_by(|a, b| b.score.unwrap_or(0.0).total_cmp(&a.score.unwrap_or(0.0)));
    entities
}

pub fn decide(p: &Prepared, out: &Outputs2, ctx: &Context2<'_>) -> Prediction2 {
    let cal = ctx.calibration;
    let probabilities: Vec<f64> = out.causes.iter().map(|&l| sigmoid64(f64::from(l) / cal.temperature)).collect();
    let crash = if cal.debug_crash != 0.0 && debug_crash(p) { 0.0 } else { sigmoid64(f64::from(out.crash)) };
    let index = |cause: &str| ctx.causes.iter().position(|c| c == cause);
    let certain = certain(p, cal, crash);
    let mut chosen: Chosen = certain
        .iter()
        .map(|(c, records)| (c.clone(), records.iter().map(|r| r.confidence).fold(f64::NEG_INFINITY, f64::max)))
        .collect();
    for (cause, value) in chosen.iter_mut() {
        if let Some(i) = index(cause) {
            if probabilities[i] > *value {
                *value = probabilities[i];
            }
        }
    }
    let open = crash >= cal.crash && (cal.require_fatal == 0.0 || fatal(p, 1.0));
    if open || !certain.is_empty() {
        for i in order_desc(&probabilities) {
            if probabilities[i] < cal.cause || chosen.len() as f64 >= cal.max_causes {
                break;
            }
            if !SKIP.contains(&ctx.causes[i].as_str()) {
                set_default(&mut chosen, &ctx.causes[i], probabilities[i]);
            }
        }
    }
    if cal.specific != 0.0 {
        chosen = specific_only(chosen);
    }
    for (_, value) in chosen.iter_mut() {
        *value = (*value * cal.conf_scale).min(1.0);
    }
    let mut ordered = chosen.clone();
    ordered.sort_by(|a, b| b.1.total_cmp(&a.1));
    let count = ctx.causes.len();
    let findings: Vec<Finding> = ordered
        .iter()
        .map(|(cause, value)| Finding {
            cause: cause.clone(),
            confidence: *value,
            actions: ctx.actions.get(cause).cloned().unwrap_or_default(),
            evidence: evidence_for(cause, index(cause), p, out, count),
        })
        .collect();
    let status = if !findings.is_empty() {
        "diagnosed"
    } else if crash >= cal.unknown && (cal.require_fatal == 0.0 || fatal(p, cal.require_fatal)) {
        "unknown"
    } else {
        "healthy"
    };
    let entities = if findings.is_empty() { Vec::new() } else { entities_for(p, out, &chosen, &certain, ctx) };
    let ood = if status == "unknown" { crash } else { 0.0 };
    Prediction2 { status: status.into(), crash_score: crash, ood_score: ood, causes: findings, entities }
}
