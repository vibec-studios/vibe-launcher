use serde::Serialize;

use crate::math::sigmoid;
use crate::net::Outputs;
use crate::package::Calibration;
use crate::select::Line;
use crate::tokenizer::Tokenizer;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Location {
    pub file: String,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct Finding {
    pub cause: String,
    pub confidence: f64,
    pub actions: Vec<String>,
    pub evidence: Vec<Location>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Entity {
    pub entity: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cause: Option<String>,
    pub file: Option<String>,
    pub line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_byte: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_byte: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Prediction {
    pub status: String,
    pub ood_score: f64,
    pub causes: Vec<Finding>,
    pub entities: Vec<Entity>,
}

pub struct Context<'a> {
    pub causes: &'a [String],
    pub actions: &'a std::collections::HashMap<String, Vec<String>>,
    pub calibration: &'a Calibration,
    pub prototypes: &'a [Vec<f32>],
}

fn logaddexp(x: f32, y: f32) -> f32 {
    if x == y {
        return x + std::f32::consts::LN_2;
    }
    let diff = x - y;
    if diff > 0.0 {
        x + (-diff).exp().ln_1p()
    } else {
        y + diff.exp().ln_1p()
    }
}

pub fn ood_score(logits: &[f32], embedding: &[f32], cal: &Calibration, prototypes: &[Vec<f32>]) -> f32 {
    let energy = -logits[1..].iter().fold(logits[0], |acc, &v| logaddexp(acc, v));
    let distance = if prototypes.is_empty() {
        0.0
    } else {
        let norm = embedding.iter().map(|v| v * v).sum::<f32>().sqrt().max(1e-8);
        let best = prototypes
            .iter()
            .map(|p| p.iter().zip(embedding).map(|(a, b)| a * (b / norm)).sum::<f32>())
            .fold(f32::NEG_INFINITY, f32::max);
        1.0 - best
    };
    let mut score = (energy - cal.energy_center as f32) / cal.energy_scale as f32;
    score += (distance - cal.distance_center as f32) / cal.distance_scale as f32;
    sigmoid(score / 2.0)
}

pub fn top_indices(values: impl Iterator<Item = f32>, count: usize) -> Vec<usize> {
    let mut order: Vec<(usize, f32)> = values.enumerate().collect();
    order.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    order.into_iter().take(count).map(|(i, _)| i).collect()
}

pub fn argmax(values: &[f32]) -> usize {
    let mut best = 0;
    for (i, &v) in values.iter().enumerate() {
        if v > values[best] {
            best = i;
        }
    }
    best
}

pub fn decode_entities(
    lines: &[Line],
    tokens: &[Vec<u32>],
    outputs: &Outputs,
    tags: &[String],
    tok: &Tokenizer,
) -> Vec<Entity> {
    let width = tags.len();
    let mut found = Vec::new();
    for ((line, ids), logits) in lines.iter().zip(tokens).zip(&outputs.entities) {
        let plain = line.text.as_bytes();
        let mut current: Option<(&str, usize, usize)> = None;
        let emit = |name: &str, start: usize, end: usize, found: &mut Vec<Entity>| {
            let end = end.min(plain.len());
            found.push(Entity {
                entity: name.to_owned(),
                text: String::from_utf8_lossy(&plain[start.min(end)..end]).into_owned(),
                cause: None,
                file: Some(line.file.clone()),
                line: Some(line.number),
                start_byte: Some(start + line.start_byte),
                end_byte: Some(end + line.start_byte),
                score: None,
            });
        };
        for ((lo, hi), scores) in tok.offsets(ids).into_iter().zip(logits.chunks_exact(width)) {
            let tag = if hi > lo { tags[argmax(scores)].as_str() } else { "O" };
            if let Some((name, start, _)) = current {
                if tag.strip_prefix("I-") == Some(name) {
                    current = Some((name, start, hi));
                    continue;
                }
                let (name, start, end) = current.take().unwrap();
                emit(name, start, end, &mut found);
            }
            if tag != "O" {
                current = Some((tag.get(2..).unwrap_or(tag), lo, hi));
            }
        }
        if let Some((name, start, end)) = current {
            emit(name, start, end, &mut found);
        }
    }
    found
}

pub fn diagnose(lines: &[Line], outputs: &Outputs, ctx: &Context<'_>) -> (String, f32, Vec<Finding>) {
    let cal = ctx.calibration;
    let temperature = cal.temperature as f32;
    let probabilities: Vec<f32> = outputs.causes.iter().map(|&l| sigmoid(l / temperature)).collect();
    let ood = ood_score(&outputs.causes, &outputs.embedding, cal, ctx.prototypes);
    let mut findings = Vec::new();
    if f64::from(ood) > cal.ood_threshold {
        return ("unknown".into(), ood, findings);
    }
    let count = ctx.causes.len();
    for i in top_indices(probabilities.iter().copied(), count) {
        if probabilities[i] < cal.threshold as f32 {
            break;
        }
        let column = outputs.pointer.iter().skip(i).step_by(count).copied();
        let evidence = top_indices(column, 3)
            .into_iter()
            .filter(|&j| lines[j].number != 0)
            .map(|j| Location { file: lines[j].file.clone(), line: lines[j].number })
            .collect();
        let name = &ctx.causes[i];
        findings.push(Finding {
            cause: name.clone(),
            confidence: f64::from(probabilities[i]),
            actions: ctx.actions.get(name).cloned().unwrap_or_default(),
            evidence,
        });
    }
    let status = if findings.is_empty() { "healthy" } else { "diagnosed" };
    (status.into(), ood, findings)
}
