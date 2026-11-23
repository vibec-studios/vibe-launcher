use crate::error::Result;
use crate::gemm::{gemm, Shape};
use crate::math::{gelu, softmax, Linear, Norm};
use crate::weights::Weights;

#[derive(Default)]
pub struct Scratch {
    normed: Vec<f32>,
    qkv: Vec<f32>,
    context: Vec<f32>,
    hidden: Vec<f32>,
    out: Vec<f32>,
    queries: Vec<f32>,
    keys: Vec<f32>,
    heads: Vec<f32>,
    values: Vec<f32>,
    scores: Vec<f32>,
}

pub struct Block {
    norm1: Norm,
    qkv: Linear,
    proj: Linear,
    norm2: Norm,
    up: Linear,
    down: Linear,
    width: usize,
    heads: usize,
}

impl Block {
    pub fn load(weights: &mut Weights, key: &str, width: usize, heads: usize) -> Result<Self> {
        let qkv = Linear::load(weights, &format!("{key}.qkv"), width)?;
        if qkv.outputs != 3 * width || width % heads != 0 {
            return Err(crate::error::Error::tensor(&format!("{key}.qkv"), "passt nicht zu width/heads"));
        }
        let up = Linear::load(weights, &format!("{key}.up"), width)?;
        let down = Linear::load(weights, &format!("{key}.down"), up.outputs)?;
        let proj = Linear::load(weights, &format!("{key}.proj"), width)?;
        if down.outputs != width || proj.outputs != width {
            return Err(crate::error::Error::tensor(key, "Ausgangsbreite passt nicht"));
        }
        Ok(Self {
            norm1: Norm::load(weights, &format!("{key}.norm1"), width)?,
            norm2: Norm::load(weights, &format!("{key}.norm2"), width)?,
            qkv,
            proj,
            up,
            down,
            width,
            heads,
        })
    }

    #[inline(always)]
    fn attention(&self, len: usize, s: &mut Scratch) {
        let width = self.width;
        let depth = width / self.heads;
        let scale = (depth as f64).powf(-0.5) as f32;
        s.context.clear();
        s.context.resize(len * width, 0.0);
        s.queries.resize(len * depth, 0.0);
        s.keys.resize(depth * len, 0.0);
        s.values.resize(len * depth, 0.0);
        s.scores.resize(len * len, 0.0);
        s.heads.resize(len * depth, 0.0);
        for head in 0..self.heads {
            let base = head * depth;
            for (j, row) in s.qkv.chunks_exact(3 * width).enumerate() {
                for d in 0..depth {
                    s.queries[j * depth + d] = row[base + d];
                    s.keys[d * len + j] = row[width + base + d];
                    s.values[j * depth + d] = row[2 * width + base + d];
                }
            }
            gemm(&s.queries, &s.keys, None, &mut s.scores, &Shape { rows: len, inputs: depth, outputs: len });
            for row in s.scores.chunks_exact_mut(len) {
                for v in row.iter_mut() {
                    *v *= scale;
                }
                softmax(row);
            }
            gemm(&s.scores, &s.values, None, &mut s.heads, &Shape { rows: len, inputs: len, outputs: depth });
            for (target, part) in s.context.chunks_exact_mut(width).zip(s.heads.chunks_exact(depth)) {
                target[base..base + depth].copy_from_slice(part);
            }
        }
    }

    #[inline(always)]
    pub fn forward(&self, x: &mut [f32], s: &mut Scratch) {
        let len = x.len() / self.width;
        self.norm1.apply(x, &mut s.normed);
        self.qkv.apply(&s.normed, &mut s.qkv);
        self.attention(len, s);
        self.proj.add_to(&s.context, &mut s.out, x);
        self.norm2.apply(x, &mut s.normed);
        self.up.apply(&s.normed, &mut s.hidden);
        gelu(&mut s.hidden);
        self.down.add_to(&s.hidden, &mut s.out, x);
    }
}
