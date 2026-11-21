use super::super::colors::{self, Color};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Tint {
    None,
    Grass,
    Water,
}

#[derive(Clone, Copy)]
pub struct Block {
    pub color: Option<Color>,
    pub tint: Tint,
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum Climate {
    #[default]
    Temperate,
    Dry,
    Snowy,
    Swamp,
    Lush,
    Dark,
    Warm,
    Cold,
}

pub const GRASS: Block = Block {
    color: Some([107, 152, 66]),
    tint: Tint::Grass,
};

pub const WATER: Block = Block {
    color: Some([54, 112, 182]),
    tint: Tint::Water,
};

pub fn block(name: &str) -> Block {
    let short = name.strip_prefix("minecraft:").unwrap_or(name);
    let tint = match short {
        "water" | "bubble_column" => Tint::Water,
        "grass_block" | "short_grass" | "grass" | "tall_grass" | "fern" | "large_fern" | "vine"
        | "oak_leaves" | "jungle_leaves" | "acacia_leaves" | "dark_oak_leaves"
        | "mangrove_leaves" | "sugar_cane" => Tint::Grass,
        _ => Tint::None,
    };
    let color = match short {
        "grass" => colors::block("short_grass"),
        "bubble_column" => colors::block("water"),
        _ => colors::block(short),
    };
    Block { color, tint }
}

pub fn legacy_block(packed: i32) -> Block {
    let id = (packed & 0xFFF) as u16;
    let tint = match id {
        2 | 18 | 31 | 106 | 161 => Tint::Grass,
        8 | 9 => Tint::Water,
        _ => Tint::None,
    };
    Block {
        color: colors::legacy(id),
        tint,
    }
}

pub fn climate(name: &str) -> Climate {
    let short = name.strip_prefix("minecraft:").unwrap_or(name);
    if short.contains("swamp") {
        Climate::Swamp
    } else if short.contains("snow") || short.contains("frozen") || short.contains("ice") {
        Climate::Snowy
    } else if short.contains("desert") || short.contains("savanna") || short.contains("badlands") {
        Climate::Dry
    } else if short.contains("jungle") || short.contains("mushroom") {
        Climate::Lush
    } else if short == "dark_forest" || short == "pale_garden" {
        Climate::Dark
    } else if short.starts_with("warm") || short.starts_with("lukewarm") {
        Climate::Warm
    } else if short.starts_with("cold") || short.starts_with("deep_cold") {
        Climate::Cold
    } else {
        Climate::Temperate
    }
}

pub fn legacy_climate(id: i32) -> Climate {
    match id {
        2 | 17 | 35 | 36 | 37 | 38 | 39 | 130 | 163 | 164 | 165 | 166 | 167 => Climate::Dry,
        10 | 11 | 12 | 13 | 26 | 30 | 31 | 140 | 158 => Climate::Snowy,
        6 | 134 => Climate::Swamp,
        14 | 15 | 21 | 22 | 23 | 149 | 151 => Climate::Lush,
        29 | 157 => Climate::Dark,
        44 | 45 | 47 | 48 => Climate::Warm,
        46 | 49 => Climate::Cold,
        _ => Climate::Temperate,
    }
}

pub fn apply(color: Color, tint: Tint, climate: Climate) -> Color {
    let target: Option<Color> = match (tint, climate) {
        (Tint::Grass, Climate::Dry) => Some([174, 164, 84]),
        (Tint::Grass, Climate::Snowy) => Some([128, 180, 151]),
        (Tint::Grass, Climate::Swamp) => Some([106, 112, 57]),
        (Tint::Grass, Climate::Lush) => Some([89, 201, 60]),
        (Tint::Grass, Climate::Dark) => Some([80, 122, 50]),
        (Tint::Water, Climate::Swamp) => Some([97, 123, 100]),
        (Tint::Water, Climate::Warm) => Some([67, 213, 238]),
        (Tint::Water, Climate::Cold | Climate::Snowy) => Some([61, 87, 214]),
        _ => None,
    };
    match target {
        Some(target) => mix(color, target, 0.7),
        None => color,
    }
}

pub fn mix(base: Color, over: Color, alpha: f32) -> Color {
    let mut out = [0; 3];
    for i in 0..3 {
        out[i] = (f32::from(base[i]) * (1.0 - alpha) + f32::from(over[i]) * alpha).round() as u8;
    }
    out
}
