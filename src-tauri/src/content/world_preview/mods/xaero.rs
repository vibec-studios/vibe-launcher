use super::stream::{Eof, Reader};
use super::tint::{self, Block, Climate, Tint, GRASS, WATER};
use super::Canvas;
use crate::content::world_preview::colors::Color;

const NOT_GRASS: u32 = 1;
const OVERLAYS: u32 = 1 << 1;
const VERTICAL_SLOPE: u32 = 1 << 4;
const HEIGHT_BYTE: u32 = 1 << 6;
const BIOME: u32 = 1 << 20;
const STATE_NEW: u32 = 1 << 21;
const BIOME_NEW: u32 = 1 << 22;
const BIOME_NUMERIC: u32 = 1 << 23;
const TOP_HEIGHT: u32 = 1 << 24;
const OVERLAY_NOT_WATER: u32 = 1;
const OVERLAY_OPACITY: u32 = 1 << 3;
const OVERLAY_STATE_NEW: u32 = 1 << 10;
pub const MAX_MAJOR: u16 = 8;
pub const MAX_MINOR: i32 = 8;

#[derive(Debug, PartialEq, Eq)]
pub enum Decoded {
    Image,
    Empty,
    Cancelled,
    Unsupported { major: u16, minor: i32 },
}

#[derive(Clone, Copy)]
struct Framing {
    major: u16,
    minor: i32,
    v2: bool,
}

impl Framing {
    fn legacy_slope(self) -> bool {
        self.minor < 5 || (self.major <= 2 && !self.v2)
    }

    fn height_shift(self) -> u32 {
        if self.minor >= 4 {
            25
        } else {
            24
        }
    }
}

#[derive(Default)]
struct Palettes {
    states: Vec<Block>,
    biomes: Vec<Climate>,
}

struct Overlay {
    block: Block,
    opacity: i32,
}

pub fn decode(stream: &[u8], canvas: &mut Canvas, cancelled: &dyn Fn() -> bool) -> Decoded {
    let mut reader = Reader::new(stream);
    let Ok(first) = reader.u8() else {
        return Decoded::Empty;
    };
    let (framing, mut pending) = if first == 0xFF {
        let Ok(packed) = reader.i32() else {
            return Decoded::Empty;
        };
        let major = ((packed >> 16) & 0xFFFF) as u16;
        let minor = packed & 0xFFFF;
        if major > MAX_MAJOR || minor > MAX_MINOR {
            return Decoded::Unsupported { major, minor };
        }
        let v2 = major == 2 && minor >= 5 && reader.u8().is_ok_and(|flag| flag == 1);
        (Framing { major, minor, v2 }, None)
    } else {
        (
            Framing {
                major: 0,
                minor: -1,
                v2: false,
            },
            Some(first),
        )
    };
    let mut palettes = Palettes::default();
    loop {
        if cancelled() {
            return Decoded::Cancelled;
        }
        let marker = match pending.take() {
            Some(marker) => marker,
            None if reader.is_done() => break,
            None => match reader.u8() {
                Ok(marker) => marker,
                Err(Eof) => break,
            },
        };
        if marker & 0x88 != 0 {
            break;
        }
        let cx = u32::from(marker >> 4);
        let cz = u32::from(marker & 15);
        if chunk(&mut reader, framing, &mut palettes, canvas, cx, cz).is_err() {
            break;
        }
    }
    if canvas.painted {
        Decoded::Image
    } else {
        Decoded::Empty
    }
}

fn chunk(
    reader: &mut Reader,
    framing: Framing,
    palettes: &mut Palettes,
    canvas: &mut Canvas,
    cx: u32,
    cz: u32,
) -> Result<(), Eof> {
    for tile in 0..16u32 {
        let first = reader.i32()?;
        if first == -1 {
            continue;
        }
        let left = cx * 64 + (tile / 4) * 16;
        let top = cz * 64 + (tile % 4) * 16;
        let mut params = first as u32;
        for index in 0..256u32 {
            if index > 0 {
                params = reader.i32()? as u32;
            }
            let (color, height) = pixel(reader, params, framing, palettes)?;
            if let Some(color) = color {
                canvas.put(left + index / 16, top + index % 16, color, height);
            }
        }
        if framing.minor >= 4 {
            reader.u8()?;
        }
        if framing.minor >= 6 {
            reader.i32()?;
        }
        if framing.minor >= 7 {
            reader.u8()?;
        }
    }
    Ok(())
}

fn state(
    reader: &mut Reader,
    framing: Framing,
    palettes: &mut Palettes,
    new: bool,
) -> Result<Block, Eof> {
    if framing.major == 0 {
        return Ok(tint::legacy_block(reader.i32()?));
    }
    if new {
        let block = reader
            .state_name()?
            .map(|name| tint::block(&name))
            .unwrap_or(Block {
                color: None,
                tint: Tint::None,
            });
        palettes.states.push(block);
        return Ok(block);
    }
    let index = reader.i32()?;
    Ok(usize::try_from(index)
        .ok()
        .and_then(|i| palettes.states.get(i).copied())
        .unwrap_or(Block {
            color: None,
            tint: Tint::None,
        }))
}

fn pixel(
    reader: &mut Reader,
    params: u32,
    framing: Framing,
    palettes: &mut Palettes,
) -> Result<(Option<Color>, i32), Eof> {
    let block = if params & NOT_GRASS != 0 {
        state(reader, framing, palettes, params & STATE_NEW != 0)?
    } else {
        GRASS
    };
    let height = if params & HEIGHT_BYTE != 0 {
        i32::from(reader.u8()?)
    } else {
        let raw = ((params >> 12) & 0xFF) | (((params >> framing.height_shift()) & 0xF) << 8);
        ((raw as i32) << 20) >> 20
    };
    if framing.minor >= 4 && params & TOP_HEIGHT != 0 {
        reader.u8()?;
    }
    let mut overlays = Vec::new();
    if params & OVERLAYS != 0 {
        let count = reader.u8()?;
        for _ in 0..count {
            overlays.push(overlay(reader, framing, palettes)?);
        }
    }
    let slope = if framing.legacy_slope() {
        (params >> 2) & 3
    } else {
        0
    };
    if slope == 3 {
        reader.i32()?;
    }
    let mut climate = Climate::Temperate;
    if slope == 1 || slope == 2 || params & BIOME != 0 {
        climate = biome(reader, params, framing, palettes)?;
    }
    if framing.minor == 2 && params & VERTICAL_SLOPE != 0 {
        reader.u8()?;
    }
    let mut color = block
        .color
        .map(|color| tint::apply(color, block.tint, climate));
    for layer in &overlays {
        let Some(over) = layer.block.color else {
            continue;
        };
        let over = tint::apply(over, layer.block.tint, climate);
        let alpha = if layer.block.tint == Tint::Water {
            (0.5 + 0.06 * layer.opacity.clamp(0, 15) as f32).min(0.9)
        } else {
            0.5
        };
        color = Some(match color {
            Some(base) => tint::mix(base, over, alpha),
            None => over,
        });
    }
    Ok((color, height))
}

fn biome(
    reader: &mut Reader,
    params: u32,
    framing: Framing,
    palettes: &mut Palettes,
) -> Result<Climate, Eof> {
    if framing.major < 4 {
        let value = i32::from(reader.u8()?);
        let id = if framing.minor < 3 || value < 255 {
            value
        } else {
            reader.i32()?
        };
        return Ok(tint::legacy_climate(id));
    }
    if params & BIOME_NEW != 0 {
        let climate = if params & BIOME_NUMERIC != 0 {
            tint::legacy_climate(reader.i32()?)
        } else {
            let len = reader.u16()? as usize;
            tint::climate(&String::from_utf8_lossy(reader.take(len)?))
        };
        palettes.biomes.push(climate);
        return Ok(climate);
    }
    let index = reader.i32()?;
    Ok(usize::try_from(index)
        .ok()
        .and_then(|i| palettes.biomes.get(i).copied())
        .unwrap_or_default())
}

fn overlay(reader: &mut Reader, framing: Framing, palettes: &mut Palettes) -> Result<Overlay, Eof> {
    let params = reader.i32()? as u32;
    let block = if params & OVERLAY_NOT_WATER != 0 {
        state(reader, framing, palettes, params & OVERLAY_STATE_NEW != 0)?
    } else {
        WATER
    };
    if framing.minor < 1 && params & (1 << 1) != 0 {
        reader.i32()?;
    }
    let slope = if framing.legacy_slope() {
        (params >> 8) & 3
    } else {
        0
    };
    if slope == 2 || params & (1 << 2) != 0 {
        reader.i32()?;
    }
    let opacity = if framing.minor < 8 {
        if params & OVERLAY_OPACITY != 0 {
            reader.i32()?
        } else {
            1
        }
    } else {
        ((params >> 11) & 15) as i32
    };
    Ok(Overlay { block, opacity })
}
