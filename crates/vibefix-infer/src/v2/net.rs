use crate::block::Scratch;
use crate::error::Result;
use crate::math::{gelu, Linear};
use crate::trunk::{check, Shape, Table, Trunk, FEATURES};
use crate::v2::package::Network2;
use crate::weights::Weights;

pub struct Inputs2 {
    pub tokens: Vec<Vec<u32>>,
    pub features: Vec<[u32; FEATURES]>,
    pub line_rules: Vec<[u32; 2]>,
    pub case: Vec<f32>,
    pub spans: Vec<Option<(usize, usize, usize)>>,
    pub candidate_features: Vec<Vec<f32>>,
}

pub struct Outputs2 {
    pub causes: Vec<f32>,
    pub crash: f32,
    pub pointer: Vec<f32>,
    pub candidates: Vec<Vec<f32>>,
    pub embedding: Vec<f32>,
}

pub struct Network2Model {
    pub config: Network2,
    trunk: Trunk,
    rule_lines: Table,
    heuristic_lines: Table,
    case_in: Linear,
    cause: Linear,
    cause_skip: Linear,
    crash: Linear,
    crash_skip: Linear,
    pointer: Linear,
    candidate_in: Linear,
    candidate_hidden: Linear,
    candidate_out: Linear,
}

impl Network2Model {
    pub fn load(config: Network2, mut weights: Weights) -> Result<Self> {
        let shape = Shape {
            width: config.width,
            heads: config.heads,
            line_layers: config.line_layers,
            document_layers: config.document_layers,
            vocab: config.vocab,
            max_tokens: config.max_tokens,
            max_lines: config.max_lines,
        };
        let w = config.width;
        let c = config.causes.len();
        let case_width = 2 * c + config.flags;
        let trunk = Trunk::load(&mut weights, &shape)?;
        let net = Self {
            trunk,
            rule_lines: Table::load(&mut weights, "rule_lines.weight", w)?,
            heuristic_lines: Table::load(&mut weights, "heuristic_lines.weight", w)?,
            case_in: Linear::load(&mut weights, "case_in", case_width)?,
            cause: Linear::load(&mut weights, "cause", w)?,
            cause_skip: Linear::load(&mut weights, "cause_skip", case_width)?,
            crash: Linear::load(&mut weights, "crash", w)?,
            crash_skip: Linear::load(&mut weights, "crash_skip", case_width)?,
            pointer: Linear::load(&mut weights, "pointer", w)?,
            candidate_in: Linear::load(&mut weights, "candidate_in", config.candidate_width)?,
            candidate_hidden: Linear::load(&mut weights, "candidate_hidden", 4 * w)?,
            candidate_out: Linear::load(&mut weights, "candidate_out", 2 * w)?,
            config,
        };
        weights.finish()?;
        check("rule_lines.weight", net.rule_lines.rows, c + 1)?;
        check("heuristic_lines.weight", net.heuristic_lines.rows, c + 1)?;
        check("case_in.weight", net.case_in.outputs, w)?;
        check("cause.weight", net.cause.outputs, c)?;
        check("cause_skip.weight", net.cause_skip.outputs, c)?;
        check("crash.weight", net.crash.outputs, 1)?;
        check("crash_skip.weight", net.crash_skip.outputs, 1)?;
        check("pointer.weight", net.pointer.outputs, c)?;
        check("candidate_in.weight", net.candidate_in.outputs, w)?;
        check("candidate_hidden.weight", net.candidate_hidden.outputs, 2 * w)?;
        check("candidate_out.weight", net.candidate_out.outputs, net.config.entity_types)?;
        Ok(net)
    }

    pub fn forward(&self, inputs: &Inputs2) -> Outputs2 {
        #[cfg(target_arch = "x86_64")]
        if crate::gemm::simd_enabled() {
            return unsafe { self.forward_avx2(inputs) };
        }
        self.forward_impl(inputs)
    }

    #[cfg(target_arch = "x86_64")]
    #[target_feature(enable = "avx2")]
    unsafe fn forward_avx2(&self, inputs: &Inputs2) -> Outputs2 {
        self.forward_impl(inputs)
    }

    #[inline(always)]
    fn forward_impl(&self, inputs: &Inputs2) -> Outputs2 {
        let w = self.config.width;
        let mut case = inputs.case.clone();
        if !self.config.use_rules {
            case.iter_mut().take(2 * self.config.causes.len()).for_each(|v| *v = 0.0);
        }
        let mut scratch = Scratch::default();
        let states: Vec<Vec<f32>> = inputs.tokens.iter().map(|ids| self.trunk.encode_line(ids, &mut scratch)).collect();
        let mut document = self.trunk.lines(&states, &inputs.features);
        if self.config.use_rules {
            for (row, rules) in document.chunks_exact_mut(w).zip(&inputs.line_rules) {
                let (r, h) =
                    (self.rule_lines.row(rules[0] as usize, w), self.heuristic_lines.row(rules[1] as usize, w));
                for ((v, a), b) in row.iter_mut().zip(r).zip(h) {
                    *v += a + b;
                }
            }
        }
        self.trunk.position(&mut document);
        let mut projected = Vec::new();
        self.case_in.apply(&case, &mut projected);
        for row in document.chunks_exact_mut(w) {
            for (v, p) in row.iter_mut().zip(&projected) {
                *v += p;
            }
        }
        let (normed, pooled) = self.trunk.document(&mut document, &mut scratch);
        let add = |a: &Linear, x: &[f32], b: &Linear, y: &[f32]| {
            let (mut first, mut second) = (Vec::new(), Vec::new());
            a.apply(x, &mut first);
            b.apply(y, &mut second);
            first.iter().zip(&second).map(|(p, q)| p + q).collect::<Vec<f32>>()
        };
        let causes = add(&self.cause, &pooled, &self.cause_skip, &case);
        let crash = add(&self.crash, &pooled, &self.crash_skip, &case)[0];
        let mut pointer = Vec::new();
        self.pointer.apply(&normed, &mut pointer);
        let candidates = self.candidates(inputs, &states, &normed, &pooled);
        Outputs2 { causes, crash, pointer, candidates, embedding: pooled }
    }

    #[inline(always)]
    fn candidates(&self, inputs: &Inputs2, states: &[Vec<f32>], normed: &[f32], pooled: &[f32]) -> Vec<Vec<f32>> {
        let w = self.config.width;
        let mut joined = Vec::with_capacity(4 * w);
        let (mut projected, mut hidden, mut out) = (Vec::new(), Vec::new(), Vec::new());
        inputs
            .spans
            .iter()
            .zip(&inputs.candidate_features)
            .map(|(span, features)| {
                joined.clear();
                match span {
                    Some((line, first, last)) => {
                        let state = &states[*line];
                        let (a, b) = (&state[first * w..(first + 1) * w], &state[last * w..(last + 1) * w]);
                        joined.extend(a.iter().zip(b).map(|(x, y)| (x + y) * 0.5));
                        joined.extend_from_slice(&normed[line * w..(line + 1) * w]);
                    }
                    None => joined.extend(std::iter::repeat(0.0).take(2 * w)),
                }
                self.candidate_in.apply(features, &mut projected);
                joined.extend_from_slice(&projected);
                joined.extend_from_slice(pooled);
                self.candidate_hidden.apply(&joined, &mut hidden);
                gelu(&mut hidden);
                self.candidate_out.apply(&hidden, &mut out);
                out.clone()
            })
            .collect()
    }
}
