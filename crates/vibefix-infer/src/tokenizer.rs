use std::collections::HashMap;
use std::path::Path;

use serde::Deserialize;

use crate::error::{Error, Result};
use crate::hash::FastMap;
use crate::parts::parts;

pub const PAD: u32 = 0;
pub const MASK: u32 = 1;
pub const LINE: u32 = 2;
pub const BYTE_BASE: u32 = 3;
pub const BASE: u32 = BYTE_BASE + 256;

#[derive(Deserialize)]
struct Special {
    pad: u32,
    mask: u32,
    line: u32,
}

#[derive(Deserialize)]
struct TokenizerFile {
    version: u32,
    special: Special,
    merges: Vec<[u32; 2]>,
}

pub struct Tokenizer {
    merges: Vec<(u32, u32)>,
    ranks: FastMap<u64, u32>,
    lengths: Vec<u32>,
}

pub type ChunkCache = HashMap<String, Vec<u32>>;

fn key(left: u32, right: u32) -> u64 {
    (u64::from(left) << 32) | u64::from(right)
}

impl Tokenizer {
    pub fn from_merges(merges: Vec<(u32, u32)>) -> Result<Self> {
        let mut lengths: Vec<u32> = vec![0; BYTE_BASE as usize];
        lengths.extend(std::iter::repeat(1).take(256));
        let mut ranks = FastMap::default();
        for (i, &(left, right)) in merges.iter().enumerate() {
            let id = BASE + i as u32;
            if left >= id || right >= id {
                return Err(Error::Package(format!("Tokenizer-Merge {i} verweist auf eine spätere ID")));
            }
            lengths.push(lengths[left as usize] + lengths[right as usize]);
            ranks.insert(key(left, right), id);
        }
        Ok(Self { merges, ranks, lengths })
    }

    pub fn load(path: &Path) -> Result<Self> {
        let data = std::fs::read(path).map_err(|e| Error::io(path, e))?;
        Self::parse(&data)
    }

    pub fn parse(data: &[u8]) -> Result<Self> {
        let file: TokenizerFile = serde_json::from_slice(data)?;
        if file.version != 1 {
            return Err(Error::Version { what: "tokenizer.json", found: file.version, supported: "1" });
        }
        if (file.special.pad, file.special.mask, file.special.line) != (PAD, MASK, LINE) {
            return Err(Error::Package("Tokenizer verwendet unerwartete Sonder-IDs".into()));
        }
        Self::from_merges(file.merges.into_iter().map(|[l, r]| (l, r)).collect())
    }

    pub fn len(&self) -> usize {
        self.lengths.len()
    }

    pub fn is_empty(&self) -> bool {
        self.lengths.is_empty()
    }

    pub fn token_len(&self, id: u32) -> usize {
        self.lengths[id as usize] as usize
    }

    pub fn encode_chunk(&self, chunk: &str) -> Vec<u32> {
        let mut seq: Vec<u32> = chunk.bytes().map(|b| u32::from(b) + BYTE_BASE).collect();
        let mut out = Vec::with_capacity(seq.len());
        while seq.len() > 1 {
            let best = seq.windows(2).filter_map(|w| self.ranks.get(&key(w[0], w[1])).copied()).min();
            let Some(best) = best else { break };
            let (left, right) = self.merges[(best - BASE) as usize];
            out.clear();
            let mut i = 0;
            while i < seq.len() {
                if i + 1 < seq.len() && seq[i] == left && seq[i + 1] == right {
                    out.push(best);
                    i += 2;
                } else {
                    out.push(seq[i]);
                    i += 1;
                }
            }
            std::mem::swap(&mut seq, &mut out);
        }
        seq
    }

    pub fn encode(&self, text: &str, limit: usize, cache: &mut ChunkCache) -> Vec<u32> {
        let mut result = Vec::new();
        for chunk in parts(text) {
            if let Some(ids) = cache.get(chunk) {
                result.extend_from_slice(ids);
            } else {
                let ids = self.encode_chunk(chunk);
                result.extend_from_slice(&ids);
                cache.insert(chunk.to_owned(), ids);
            }
            if result.len() >= limit {
                result.truncate(limit);
                return result;
            }
        }
        result
    }

    pub fn offsets(&self, ids: &[u32]) -> Vec<(usize, usize)> {
        let mut offset = 0;
        ids.iter()
            .map(|&id| {
                let end = offset + self.token_len(id);
                let span = (offset, end);
                offset = end;
                span
            })
            .collect()
    }
}
