use super::net::Inputs2;
use super::pool::BITS;
use super::prepare::Prepared;
use crate::tokenizer::{ChunkCache, Tokenizer, LINE};

fn token_span(tokenizer: &Tokenizer, ids: &[u32], start: usize, end: usize) -> Option<(usize, usize)> {
    let mut offset = 0;
    let mut span: Option<(usize, usize)> = None;
    for (position, &token) in ids.iter().enumerate().skip(1) {
        let lo = offset;
        offset += tokenizer.token_len(token);
        if offset > start && lo < end {
            span = Some((span.map_or(position, |s| s.0), position));
        }
    }
    span
}

fn bits(value: u32, width: usize) -> impl Iterator<Item = f32> {
    (0..width).map(move |i| (value >> i & 1) as f32)
}

pub fn encode(prepared: &Prepared, tokenizer: &Tokenizer, max_tokens: usize, entity_types: usize) -> Inputs2 {
    let mut cache = ChunkCache::new();
    let tokens: Vec<Vec<u32>> = prepared
        .lines
        .iter()
        .map(|line| {
            let mut ids = vec![LINE];
            ids.extend(tokenizer.encode(&line.text, max_tokens - 1, &mut cache));
            ids
        })
        .collect();
    let spans = prepared
        .candidates
        .iter()
        .map(|c| {
            let line = usize::try_from(c.line).ok().filter(|&l| l < tokens.len())?;
            token_span(tokenizer, &tokens[line], c.start, c.end).map(|(a, b)| (line, a, b))
        })
        .collect();
    let candidate_features = prepared
        .candidates
        .iter()
        .map(|c| {
            bits(c.bits, BITS.len()).chain(bits(c.rule, entity_types)).chain(bits(c.heuristic, entity_types)).collect()
        })
        .collect();
    let case = prepared.rule_vector.iter().chain(&prepared.flags).map(|&v| v as f32).collect();
    Inputs2 {
        tokens,
        features: prepared.lines.iter().map(|l| l.features).collect(),
        line_rules: prepared.line_rules.clone(),
        case,
        spans,
        candidate_features,
    }
}
