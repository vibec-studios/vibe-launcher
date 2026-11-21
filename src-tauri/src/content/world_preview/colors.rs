pub type Color = [u8; 3];

pub fn block(name: &str) -> Option<Color> {
    let name = name.strip_prefix("minecraft:").unwrap_or(name);
    Some(match name {
        "air" | "cave_air" | "void_air" => return None,
        "water" | "seagrass" | "tall_seagrass" | "kelp" | "kelp_plant" => [54, 112, 182],
        "lava" => [231, 105, 30],
        "grass_block" | "short_grass" | "tall_grass" | "fern" | "large_fern" => [107, 152, 66],
        "moss_block" | "moss_carpet" => [94, 122, 50],
        "dirt" | "coarse_dirt" | "rooted_dirt" | "farmland" | "dirt_path" | "grass_path" => {
            [125, 91, 62]
        }
        "podzol" | "mud" | "muddy_mangrove_roots" => [94, 73, 57],
        "sand" | "sandstone" | "smooth_sandstone" => [216, 203, 154],
        "red_sand" | "red_sandstone" => [174, 96, 54],
        "gravel" | "andesite" | "tuff" => [122, 121, 113],
        "stone" | "cobblestone" | "stone_bricks" => [133, 137, 139],
        "deepslate" | "cobbled_deepslate" | "bedrock" | "basalt" | "blackstone" => [72, 71, 76],
        "diorite" | "calcite" | "quartz_block" => [206, 204, 196],
        "granite" | "terracotta" => [155, 104, 86],
        "clay" => [153, 164, 177],
        "snow" | "snow_block" | "powder_snow" => [237, 246, 250],
        "ice" | "packed_ice" | "blue_ice" | "frosted_ice" => [142, 187, 232],
        "netherrack" | "crimson_nylium" => [125, 52, 54],
        "warped_nylium" | "warped_wart_block" => [52, 132, 120],
        "soul_sand" | "soul_soil" => [85, 65, 55],
        "end_stone" | "end_stone_bricks" => [214, 216, 153],
        "mycelium" | "purpur_block" | "amethyst_block" => [156, 122, 163],
        "cherry_leaves" | "pink_petals" => [229, 158, 181],
        "pale_oak_leaves" => [129, 135, 121],
        "spruce_leaves" => [62, 106, 69],
        "birch_leaves" => [116, 146, 73],
        "bricks" | "nether_bricks" | "red_nether_bricks" => [140, 68, 64],
        "obsidian" | "crying_obsidian" => [60, 48, 77],
        value if value.ends_with("_leaves") => [63, 119, 57],
        value
            if ["_log", "_wood", "_planks", "_stem"]
                .iter()
                .any(|suffix| value.ends_with(suffix)) =>
        {
            [147, 117, 76]
        }
        value if value.ends_with("_sandstone") => [205, 185, 131],
        value if value.ends_with("_ore") => [119, 121, 123],
        _ => [148, 145, 137],
    })
}

pub fn legacy(id: u16) -> Option<Color> {
    block(match id {
        0 => "air",
        1 => "stone",
        2 | 31 => "grass_block",
        3 => "dirt",
        4 => "cobblestone",
        5 | 17 | 162 => "oak_log",
        7 => "bedrock",
        8 | 9 => "water",
        10 | 11 => "lava",
        12 | 24 => "sand",
        13 => "gravel",
        18 | 161 => "oak_leaves",
        45 => "bricks",
        78 | 80 => "snow",
        79 | 174 => "ice",
        82 => "clay",
        87 => "netherrack",
        88 => "soul_sand",
        110 => "mycelium",
        121 => "end_stone",
        _ => "",
    })
}
