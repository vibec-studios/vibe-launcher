use crate::content::nbt::{self, Tag};
use crate::content::world_preview::colors::{self, Color};
use std::collections::BTreeMap;

struct Chunk<'a> {
    sections: BTreeMap<i32, Section<'a>>,
    heights: Option<Heightmap<'a>>,
}

enum Heightmap<'a> {
    Packed(Packed<'a>, i32),
    Legacy(&'a [i32]),
}

impl Heightmap<'_> {
    fn surface(&self, index: usize) -> Option<i32> {
        match self {
            Self::Packed(values, minimum) => {
                let height = values.get(index)? as i32;
                (height != 0).then_some(minimum + height - 1)
            }
            Self::Legacy(values) => values.get(index)?.checked_sub(1),
        }
    }
}

pub fn read(bytes: &[u8], dimension: &str) -> Option<Terrain> {
    let root = nbt::parse_with_arrays(bytes).ok()?;
    let data = root.get("Level").unwrap_or(&root);
    let modern = data.get("sections").is_some();
    let default_minimum = if modern && dimension == "minecraft:overworld" {
        -4
    } else {
        0
    };
    let min_section = data
        .get("yPos")
        .and_then(section_y)
        .unwrap_or(default_minimum);
    let chunk = Chunk::from_nbt(data, min_section * 16)?;
    let mut terrain = [None; 256];
    for (i, column) in terrain.iter_mut().enumerate() {
        *column = chunk.column(i);
    }
    Some(Terrain(terrain))
}

pub struct Terrain([Option<(i32, Color)>; 256]);

impl Terrain {
    pub fn surface(&self, x: usize, z: usize) -> Option<(i32, Color)> {
        self.0[z * 16 + x]
    }
}

fn section_y(tag: &Tag) -> Option<i32> {
    let y = tag.as_i64()?;
    (-128..=127).contains(&y).then_some(y as i32)
}

impl<'a> Chunk<'a> {
    fn from_nbt(data: &'a Tag, minimum: i32) -> Option<Self> {
        let Tag::List(sections) = data.get("sections").or_else(|| data.get("Sections"))? else {
            return None;
        };
        let sections: BTreeMap<_, _> = sections
            .iter()
            .filter_map(|section| {
                let y = section_y(section.get("Y")?)?;
                Some((y, Section::read(section)?))
            })
            .collect();
        if sections.is_empty() {
            return None;
        }
        let heights = data
            .get("Heightmaps")
            .and_then(|maps| {
                [
                    "WORLD_SURFACE",
                    "WORLD_SURFACE_WG",
                    "MOTION_BLOCKING",
                    "MOTION_BLOCKING_NO_LEAVES",
                ]
                .into_iter()
                .find_map(|key| {
                    Some(Heightmap::Packed(
                        Packed::new(maps.get(key)?, 256, 9)?,
                        minimum,
                    ))
                })
            })
            .or_else(|| match data.get("HeightMap") {
                Some(Tag::Ints(values)) if values.len() == 256 => Some(Heightmap::Legacy(values)),
                _ => None,
            });
        Some(Self { sections, heights })
    }

    fn column(&self, index: usize) -> Option<(i32, Color)> {
        let top = self.sections.last_key_value()?.0 * 16 + 15;
        let hint = match &self.heights {
            Some(heights) => heights.surface(index)?,
            None => top,
        };
        let start = top.min(hint);
        for (&section_y, section) in self.sections.range(..=start.div_euclid(16)).rev() {
            let base = section_y * 16;
            let max_y = (start - base).min(15) as usize;
            for y in (0..=max_y).rev() {
                if let Some(color) = section.color(y * 256 + index) {
                    return Some((base + y as i32, color));
                }
            }
        }
        None
    }
}

enum Section<'a> {
    Uniform(Color),
    Palette(Vec<Option<Color>>, Packed<'a>),
    Legacy(&'a [u8], Option<&'a [u8]>),
}

impl<'a> Section<'a> {
    fn read(section: &'a Tag) -> Option<Self> {
        if let Some(Tag::Bytes(blocks)) = section.get("Blocks") {
            let add = match section.get("Add") {
                Some(Tag::Bytes(add)) if add.len() == 2048 => Some(add.as_slice()),
                _ => None,
            };
            return (blocks.len() == 4096).then_some(Self::Legacy(blocks, add));
        }
        let (palette, storage) = match section.get("block_states") {
            Some(states) => (states.get("palette")?, states.get("data")),
            None => (section.get("Palette")?, section.get("BlockStates")),
        };
        let Tag::List(palette) = palette else {
            return None;
        };
        if palette.is_empty() || palette.len() > 4096 {
            return None;
        }
        let color = |entry: &Tag| {
            let name = match entry {
                Tag::String(name) => name.as_str(),
                entry => entry.get("Name")?.as_str()?,
            };
            colors::block(name.split('[').next()?)
        };
        if palette.len() == 1 {
            return Some(Self::Uniform(color(&palette[0])?));
        }
        let bits = (usize::BITS - (palette.len() - 1).leading_zeros()).max(4) as usize;
        let packed = Packed::new(storage?, 4096, bits)?;
        Some(Self::Palette(palette.iter().map(color).collect(), packed))
    }

    fn color(&self, index: usize) -> Option<Color> {
        match self {
            Self::Uniform(color) => Some(*color),
            Self::Palette(colors, values) => *colors.get(values.get(index)?)?,
            Self::Legacy(blocks, add) => {
                let high = add.map_or(0, |nibbles| (nibbles[index / 2] >> (index % 2 * 4)) & 15);
                colors::legacy(u16::from(high) << 8 | u16::from(blocks[index]))
            }
        }
    }
}

struct Packed<'a> {
    words: &'a [u64],
    bits: usize,
    per_word: usize,
    padded: bool,
}

impl<'a> Packed<'a> {
    fn new(tag: &'a Tag, count: usize, bits: usize) -> Option<Self> {
        let Tag::Longs(words) = tag else { return None };
        let per_word = 64 / bits;
        let padded = words.len() == count.div_ceil(per_word);
        (padded || words.len() == (count * bits).div_ceil(64)).then_some(Self {
            words,
            bits,
            per_word,
            padded,
        })
    }

    fn get(&self, index: usize) -> Option<usize> {
        let value = if self.padded {
            self.words.get(index / self.per_word)? >> (index % self.per_word * self.bits)
        } else {
            let start = index * self.bits;
            let word = start / 64;
            let shift = start % 64;
            let first = self.words.get(word)? >> shift;
            if shift + self.bits > 64 {
                first | (self.words.get(word + 1)? << (64 - shift))
            } else {
                first
            }
        };
        Some((value & ((1 << self.bits) - 1)) as usize)
    }
}
