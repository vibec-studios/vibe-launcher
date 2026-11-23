use crate::error::Result;
use crate::gemm::{gemm, Shape};
use crate::weights::Weights;

pub struct Linear {
    pub weight_t: Vec<f32>,
    pub bias: Vec<f32>,
    pub outputs: usize,
    pub inputs: usize,
}

impl Linear {
    pub fn load(weights: &mut Weights, key: &str, inputs: usize) -> Result<Self> {
        let (outputs, weight) = weights.take_rows(&format!("{key}.weight"), inputs)?;
        let bias = weights.take(&format!("{key}.bias"), &[outputs])?;
        let mut weight_t = vec![0f32; weight.len()];
        for (o, row) in weight.chunks_exact(inputs).enumerate() {
            for (i, &v) in row.iter().enumerate() {
                weight_t[i * outputs + o] = v;
            }
        }
        Ok(Self { weight_t, bias, outputs, inputs })
    }

    #[inline(always)]
    pub fn apply(&self, x: &[f32], out: &mut Vec<f32>) {
        let rows = x.len() / self.inputs;
        out.clear();
        out.resize(rows * self.outputs, 0.0);
        let shape = Shape { rows, inputs: self.inputs, outputs: self.outputs };
        gemm(x, &self.weight_t, Some(&self.bias), out, &shape);
    }

    #[inline(always)]
    pub fn add_to(&self, x: &[f32], scratch: &mut Vec<f32>, target: &mut [f32]) {
        self.apply(x, scratch);
        for (t, s) in target.iter_mut().zip(scratch.iter()) {
            *t += s;
        }
    }
}

pub struct Norm {
    pub weight: Vec<f32>,
    pub bias: Vec<f32>,
}

impl Norm {
    pub fn load(weights: &mut Weights, key: &str, width: usize) -> Result<Self> {
        let weight = weights.take(&format!("{key}.weight"), &[width])?;
        let bias = weights.take(&format!("{key}.bias"), &[width])?;
        Ok(Self { weight, bias })
    }

    #[inline(always)]
    pub fn apply(&self, x: &[f32], out: &mut Vec<f32>) {
        let width = self.weight.len();
        out.clear();
        out.resize(x.len(), 0.0);
        for (row, target) in x.chunks_exact(width).zip(out.chunks_exact_mut(width)) {
            let mean = row.iter().sum::<f32>() / width as f32;
            let mut var = 0f32;
            for (t, v) in target.iter_mut().zip(row) {
                *t = v - mean;
                var += *t * *t;
            }
            let scale = 1.0 / (var / width as f32 + 1e-5).sqrt();
            for ((t, w), b) in target.iter_mut().zip(&self.weight).zip(&self.bias) {
                *t = *t * scale * w + b;
            }
        }
    }
}

#[inline(always)]
pub fn exp(x: f32) -> f32 {
    const ROUND: f32 = 12_582_912.0;
    const SHIFT: f32 = 8_388_608.0;
    let x = x.clamp(-87.3, 88.3);
    let n = (x * std::f32::consts::LOG2_E + ROUND) - ROUND;
    let r = x - n * 0.693_359_4 + n * 2.121_944_4e-4;
    let mut p = 1.987_569_1e-4f32;
    p = p * r + 1.398_199_9e-3;
    p = p * r + 8.333_452e-3;
    p = p * r + 4.166_579_6e-2;
    p = p * r + 0.166_666_65;
    p = p * r + 0.5;
    let y = p * r * r + r + 1.0;
    let biased = (n + (127.0 + SHIFT)).to_bits().wrapping_sub(SHIFT.to_bits());
    y * f32::from_bits(biased << 23)
}

#[inline(always)]
pub fn gelu(values: &mut [f32]) {
    for h in values {
        let x = *h;
        let u = 0.797_884_6 * (x + 0.044715 * x * x * x);
        let tanh = 1.0 - 2.0 / (exp(2.0 * u) + 1.0);
        *h = 0.5 * x * (1.0 + tanh);
    }
}

#[inline(always)]
fn lanes(values: &[f32], start: f32, op: impl Fn(f32, f32) -> f32) -> f32 {
    let mut acc = [start; 8];
    let chunks = values.chunks_exact(8);
    let rest = chunks.remainder();
    for chunk in chunks {
        for l in 0..8 {
            acc[l] = op(acc[l], chunk[l]);
        }
    }
    let mut total = op(op(op(acc[0], acc[4]), op(acc[1], acc[5])), op(op(acc[2], acc[6]), op(acc[3], acc[7])));
    for &v in rest {
        total = op(total, v);
    }
    total
}

#[inline(always)]
pub fn softmax(values: &mut [f32]) {
    let max = lanes(values, f32::NEG_INFINITY, |a, b| if b > a { b } else { a });
    for v in values.iter_mut() {
        *v = exp(*v - max);
    }
    let scale = 1.0 / lanes(values, 0.0, |a, b| a + b);
    for v in values.iter_mut() {
        *v *= scale;
    }
}

pub fn sigmoid(value: f32) -> f32 {
    1.0 / (1.0 + (-value.clamp(-80.0, 80.0)).exp())
}
