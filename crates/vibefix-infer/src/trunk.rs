use crate::block::{Block, Scratch};
use crate::error::{Error, Result};
use crate::math::{softmax, Linear, Norm};
use crate::weights::Weights;

pub const FEATURES: usize = 4;

pub struct Table {
    pub rows: usize,
    data: Vec<f32>,
}

impl Table {
    pub fn load(weights: &mut Weights, name: &str, width: usize) -> Result<Self> {
        let (rows, data) = weights.take_rows(name, width)?;
        Ok(Self { rows, data })
    }

    #[inline(always)]
    pub fn row(&self, index: usize, width: usize) -> &[f32] {
        &self.data[index.min(self.rows - 1) * width..][..width]
    }
}

pub struct Shape {
    pub width: usize,
    pub heads: usize,
    pub line_layers: usize,
    pub document_layers: usize,
    pub vocab: usize,
    pub max_tokens: usize,
    pub max_lines: usize,
}

pub struct Trunk {
    pub width: usize,
    tokens: Table,
    token_position: Table,
    line_position: Table,
    features: Vec<Table>,
    line_blocks: Vec<Block>,
    doc_blocks: Vec<Block>,
    doc_norm: Norm,
    pool: Linear,
}

pub fn check(name: &str, found: usize, expected: usize) -> Result<()> {
    if found == expected {
        Ok(())
    } else {
        Err(Error::tensor(name, format!("hat {found} Zeilen, erwartet {expected}")))
    }
}

impl Trunk {
    pub fn load(weights: &mut Weights, s: &Shape) -> Result<Self> {
        let w = s.width;
        let blocks = |weights: &mut Weights, prefix: &str, count: usize| {
            (0..count).map(|i| Block::load(weights, &format!("{prefix}.{i}"), w, s.heads)).collect::<Result<Vec<_>>>()
        };
        let trunk = Self {
            line_blocks: blocks(weights, "line_blocks", s.line_layers)?,
            doc_blocks: blocks(weights, "doc_blocks", s.document_layers)?,
            features: (0..FEATURES)
                .map(|i| Table::load(weights, &format!("features.{i}.weight"), w))
                .collect::<Result<Vec<_>>>()?,
            tokens: Table::load(weights, "tokens.weight", w)?,
            token_position: Table::load(weights, "token_position.weight", w)?,
            line_position: Table::load(weights, "line_position.weight", w)?,
            doc_norm: Norm::load(weights, "doc_norm", w)?,
            pool: Linear::load(weights, "pool", w)?,
            width: w,
        };
        check("tokens.weight", trunk.tokens.rows, s.vocab)?;
        check("token_position.weight", trunk.token_position.rows, s.max_tokens)?;
        check("line_position.weight", trunk.line_position.rows, s.max_lines)?;
        check("pool.weight", trunk.pool.outputs, 1)?;
        Ok(trunk)
    }

    #[inline(always)]
    pub fn encode_line(&self, ids: &[u32], scratch: &mut Scratch) -> Vec<f32> {
        let w = self.width;
        let mut x = vec![0f32; ids.len() * w];
        for (t, (&id, row)) in ids.iter().zip(x.chunks_exact_mut(w)).enumerate() {
            for ((v, a), b) in row.iter_mut().zip(self.tokens.row(id as usize, w)).zip(self.token_position.row(t, w)) {
                *v = a + b;
            }
        }
        for block in &self.line_blocks {
            block.forward(&mut x, scratch);
        }
        x
    }

    #[inline(always)]
    pub fn lines(&self, states: &[Vec<f32>], features: &[[u32; FEATURES]]) -> Vec<f32> {
        let w = self.width;
        let mut document = vec![0f32; states.len() * w];
        for (j, row) in document.chunks_exact_mut(w).enumerate() {
            row.copy_from_slice(&states[j][..w]);
            for (i, table) in self.features.iter().enumerate() {
                for (v, f) in row.iter_mut().zip(table.row(features[j][i] as usize, w)) {
                    *v += f;
                }
            }
        }
        document
    }

    #[inline(always)]
    pub fn position(&self, document: &mut [f32]) {
        let w = self.width;
        for (j, row) in document.chunks_exact_mut(w).enumerate() {
            for (v, p) in row.iter_mut().zip(self.line_position.row(j, w)) {
                *v += p;
            }
        }
    }

    #[inline(always)]
    pub fn document(&self, document: &mut [f32], scratch: &mut Scratch) -> (Vec<f32>, Vec<f32>) {
        let w = self.width;
        for block in &self.doc_blocks {
            block.forward(document, scratch);
        }
        let mut normed = Vec::new();
        self.doc_norm.apply(document, &mut normed);
        let mut focus = Vec::new();
        self.pool.apply(&normed, &mut focus);
        softmax(&mut focus);
        let mut pooled = vec![0f32; w];
        for (row, f) in normed.chunks_exact(w).zip(&focus) {
            for (p, v) in pooled.iter_mut().zip(row) {
                *p += v * f;
            }
        }
        (normed, pooled)
    }
}
