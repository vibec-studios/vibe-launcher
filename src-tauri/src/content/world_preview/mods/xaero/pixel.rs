use super::*;

pub(super) fn chunk(
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

pub(super) fn state(
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

pub(super) fn pixel(
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

pub(super) fn biome(
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

pub(super) fn overlay(reader: &mut Reader, framing: Framing, palettes: &mut Palettes) -> Result<Overlay, Eof> {
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
