use crate::block::Scratch;
use crate::error::Result;
use crate::math::Linear;
use crate::package::Network as NetworkConfig;
use crate::trunk::{check, Shape, Trunk};
use crate::weights::Weights;

pub use crate::trunk::FEATURES;

pub struct Outputs {
    pub causes: Vec<f32>,
    pub pointer: Vec<f32>,
    pub entities: Vec<Vec<f32>>,
    pub embedding: Vec<f32>,
    pub lines: usize,
}

pub struct Network {
    pub config: NetworkConfig,
    trunk: Trunk,
    cause: Linear,
    pointer: Linear,
    entity: Linear,
}

impl Network {
    pub fn load(config: NetworkConfig, mut weights: Weights, tags: usize) -> Result<Self> {
        let shape = Shape {
            width: config.width,
            heads: config.heads,
            line_layers: config.line_layers,
            document_layers: config.document_layers,
            vocab: config.vocab,
            max_tokens: config.max_tokens,
            max_lines: config.max_lines,
        };
        let trunk = Trunk::load(&mut weights, &shape)?;
        let w = config.width;
        let net = Self {
            trunk,
            cause: Linear::load(&mut weights, "cause", w)?,
            pointer: Linear::load(&mut weights, "pointer", w)?,
            entity: Linear::load(&mut weights, "entity", w)?,
            config,
        };
        weights.finish()?;
        let causes = net.config.causes.len();
        check("cause.weight", net.cause.outputs, causes)?;
        check("pointer.weight", net.pointer.outputs, causes)?;
        check("entity.weight", net.entity.outputs, tags)?;
        Ok(net)
    }

    pub fn forward(&self, lines: &[Vec<u32>], features: &[[u32; FEATURES]]) -> Outputs {
        #[cfg(target_arch = "x86_64")]
        if crate::gemm::simd_enabled() {
            return unsafe { self.forward_avx2(lines, features) };
        }
        self.forward_impl(lines, features)
    }

    #[cfg(target_arch = "x86_64")]
    #[target_feature(enable = "avx2")]
    unsafe fn forward_avx2(&self, lines: &[Vec<u32>], features: &[[u32; FEATURES]]) -> Outputs {
        self.forward_impl(lines, features)
    }

    #[inline(always)]
    fn forward_impl(&self, lines: &[Vec<u32>], features: &[[u32; FEATURES]]) -> Outputs {
        let w = self.config.width;
        let mut scratch = Scratch::default();
        let states: Vec<Vec<f32>> = lines.iter().map(|ids| self.trunk.encode_line(ids, &mut scratch)).collect();
        let mut document = self.trunk.lines(&states, features);
        self.trunk.position(&mut document);
        let (normed, pooled) = self.trunk.document(&mut document, &mut scratch);
        let mut causes = Vec::new();
        self.cause.apply(&pooled, &mut causes);
        let mut pointer = Vec::new();
        self.pointer.apply(&normed, &mut pointer);
        let mut mixed = Vec::new();
        let entities = states
            .iter()
            .zip(normed.chunks_exact(w))
            .map(|(state, context)| {
                mixed.clear();
                for token in state.chunks_exact(w) {
                    mixed.extend(token.iter().zip(context).map(|(a, b)| a + b));
                }
                let mut logits = Vec::new();
                self.entity.apply(&mixed, &mut logits);
                logits
            })
            .collect();
        Outputs { causes, pointer, entities, embedding: pooled, lines: lines.len() }
    }
}
