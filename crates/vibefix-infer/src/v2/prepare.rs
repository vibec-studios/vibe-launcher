use std::collections::HashMap;

use serde::Serialize;
use serde_json::{Map, Value};

use super::candidates::{extract, Candidate};
use super::capping::{cap_files, Budget};
use crate::host::heuristics::EXIT_BLOCKERS;
use crate::host::metadata::fatal;
use crate::host::rules::{exit_code, fatal_case};
use crate::host::table::TABLE;
use crate::host::{self, HostFinding};
use crate::select::{select_marked, Line, Marks};
use crate::LogFile;

const SESSION_END: [&str; 2] = ["Stopping!", "All dimensions are saved"];
pub const FLAGS: usize = 16;

#[derive(Serialize)]
pub struct Prepared {
    #[serde(skip)]
    pub lines: Vec<Line>,
    pub line_rules: Vec<[u32; 2]>,
    pub rule_vector: Vec<f64>,
    pub flags: Vec<f64>,
    pub candidates: Vec<Candidate>,
    pub rules: Vec<HostFinding>,
    pub heuristics: Vec<HostFinding>,
    #[serde(skip)]
    pub meta: Map<String, Value>,
}

pub fn evidence_points(findings: &[&HostFinding]) -> Vec<(String, usize)> {
    findings.iter().filter_map(|r| r.evidence.as_ref().map(|e| (e.file.clone(), e.line))).collect()
}

fn forced_marks(points: &[(String, usize)]) -> Marks {
    let mut marks = Marks::new();
    for (file, number) in points {
        if file.is_empty() || *number == 0 {
            continue;
        }
        let rows = marks.entry(file.clone()).or_default();
        for offset in [-2i64, -1, 1, 2, 3] {
            let at = *number as i64 + offset;
            if at >= 0 {
                let slot = rows.entry(at as usize).or_insert(0);
                *slot = (*slot).max(8);
            }
        }
        rows.insert(*number, 9);
    }
    marks
}

fn strongest(findings: &[&HostFinding], causes: &[String]) -> HashMap<(String, usize), u32> {
    let mut best: HashMap<(String, usize), (u32, f64)> = HashMap::new();
    for record in findings {
        let Some(i) = causes.iter().position(|c| *c == record.cause) else { continue };
        if let Some(e) = &record.evidence {
            let key = (e.file.clone(), e.line);
            if record.confidence > best.get(&key).map_or(-1.0, |b| b.1) {
                best.insert(key, (i as u32 + 1, record.confidence));
            }
        }
    }
    best.into_iter().map(|(k, v)| (k, v.0)).collect()
}

fn confidence_vector(findings: &[HostFinding], causes: &[String]) -> Vec<f64> {
    let mut vector = vec![0.0f64; causes.len()];
    for record in findings {
        if let Some(i) = causes.iter().position(|c| *c == record.cause) {
            vector[i] = vector[i].max(record.confidence);
        }
    }
    vector
}

fn flags(files: &[LogFile], meta: &Map<String, Value>, run: &host::HostResult, lines: &[Line]) -> Vec<f64> {
    let has = |kind: &str| files.iter().any(|f| f.kind == kind);
    let texts: Vec<&str> = files.iter().map(|f| f.text.as_str()).collect();
    let sources = host::sources(files);
    let exit = exit_code(meta);
    let found: Vec<&str> = run.rules.causes.iter().map(|r| r.cause.as_str()).collect();
    let crash = match meta.get("crash") {
        None | Some(Value::Null) => texts.iter().any(|t| fatal(t)),
        Some(v) => v.as_bool().unwrap_or(true),
    };
    let any_marker = |markers: &[&str]| texts.iter().any(|t| markers.iter().any(|m| t.contains(m)));
    let exceptions = meta.get("exceptions").and_then(Value::as_array).is_some_and(|a| !a.is_empty())
        || lines.iter().any(|l| l.text.contains("Exception"));
    let values = [
        fatal_case(meta, &sources, &TABLE),
        crash,
        exit.is_some_and(|v| v.as_f64() != Some(0.0)),
        exit.is_some_and(|v| v.as_f64() == Some(0.0)),
        has("crash_report"),
        has("hs_err"),
        run.rules.healthy,
        run.heuristics.healthy,
        found == ["exit_code"],
        found.iter().any(|c| *c != "exit_code"),
        !run.heuristics.causes.is_empty(),
        any_marker(&SESSION_END),
        has("latest_log"),
        texts.iter().map(|t| t.matches('\n').count()).sum::<usize>() < 60,
        exceptions,
        any_marker(&EXIT_BLOCKERS),
    ];
    values.iter().map(|&v| f64::from(u8::from(v))).collect()
}

pub fn prepare(
    files: &[LogFile],
    meta: Option<&Map<String, Value>>,
    causes: &[String],
    budget: &Budget,
    limit: usize,
) -> Prepared {
    let capped = cap_files(files, budget);
    let run = host::run(&capped, meta);
    let rule_findings: Vec<&HostFinding> = run.rules.causes.iter().filter(|r| r.cause != "exit_code").collect();
    let heuristic: Vec<&HostFinding> = run.heuristics.causes.iter().collect();
    let all: Vec<&HostFinding> = rule_findings.iter().chain(heuristic.iter()).copied().collect();
    let mut lines = select_marked(&capped, limit, &forced_marks(&evidence_points(&all)), false);
    if lines.is_empty() {
        lines.push(Line { file: String::new(), number: 0, text: String::new(), features: [0; 4], start_byte: 0 });
    }
    let rule_lines = strongest(&rule_findings, causes);
    let heuristic_lines = strongest(&heuristic, causes);
    let line_rules = lines
        .iter()
        .map(|l| {
            let key = (l.file.clone(), l.number);
            [rule_lines.get(&key).copied().unwrap_or(0), heuristic_lines.get(&key).copied().unwrap_or(0)]
        })
        .collect();
    let mut rule_vector = confidence_vector(&run.rules.causes, causes);
    rule_vector.extend(confidence_vector(&run.heuristics.causes, causes));
    let flags = flags(&capped, &run.meta, &run, &lines);
    let mods: Vec<Value> = run.meta.get("mods").and_then(Value::as_array).cloned().unwrap_or_default();
    let candidates = extract(&lines, &mods, &rule_findings, &heuristic);
    Prepared {
        lines,
        line_rules,
        rule_vector,
        flags,
        candidates,
        rules: run.rules.causes.clone(),
        heuristics: run.heuristics.causes.clone(),
        meta: run.meta,
    }
}
