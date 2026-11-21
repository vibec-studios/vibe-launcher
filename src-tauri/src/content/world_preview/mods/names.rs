pub fn journeymap_dimension(folder: &str) -> Option<String> {
    let id = folder.strip_prefix("minecraft~").unwrap_or(folder);
    Some(match id {
        "DIM0" | "overworld" => "minecraft:overworld".into(),
        "DIM-1" | "the_nether" => "minecraft:the_nether".into(),
        "DIM1" | "the_end" => "minecraft:the_end".into(),
        _ => {
            let (namespace, path) = folder.split_once('~')?;
            valid_id(namespace, path)?
        }
    })
}

pub fn journeymap_folders(dimension: &str) -> Vec<String> {
    let name = dimension.strip_prefix("minecraft:").unwrap_or(dimension);
    let legacy = match name {
        "overworld" => Some("DIM0"),
        "the_nether" => Some("DIM-1"),
        "the_end" => Some("DIM1"),
        _ => None,
    };
    let mut folders = vec![dimension.replacen(':', "~", 1)];
    if let Some(legacy) = legacy {
        folders.push(name.to_string());
        folders.push(legacy.to_string());
    }
    folders
}

pub fn journeymap_region(name: &str) -> Option<(i32, i32)> {
    let (x, z) = name.strip_suffix(".png")?.split_once(',')?;
    Some((parse_coordinate(x)?, parse_coordinate(z)?))
}

pub fn layer_rank(name: &str) -> Option<i32> {
    match name {
        "day" => Some(4),
        "topo" => Some(2),
        "night" => Some(1),
        _ if name.parse::<i32>().is_ok() => Some(0),
        _ => None,
    }
}

fn parse_coordinate(value: &str) -> Option<i32> {
    if value.starts_with('+') {
        return None;
    }
    value
        .parse()
        .ok()
        .filter(|v: &i32| v.unsigned_abs() <= 60_000)
}

fn valid_id(namespace: &str, path: &str) -> Option<String> {
    let valid = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"_.-/".contains(&c))
    };
    (valid(namespace) && valid(path)).then(|| format!("{namespace}:{path}"))
}

pub fn xaero_dimension(folder: &str) -> Option<String> {
    match folder {
        "null" | "DIM0" => Some("minecraft:overworld".into()),
        "DIM-1" => Some("minecraft:the_nether".into()),
        "DIM1" => Some("minecraft:the_end".into()),
        _ if folder.starts_with("mw$") || folder.starts_with("cm$") => None,
        _ => {
            let (namespace, path) = folder.split_once('$')?;
            valid_id(namespace, &path.replace('%', "/"))
        }
    }
}

pub fn xaero_folders(dimension: &str) -> Vec<String> {
    match dimension {
        "minecraft:overworld" => vec!["null".into(), "DIM0".into()],
        "minecraft:the_nether" => vec!["DIM-1".into()],
        "minecraft:the_end" => vec!["DIM1".into()],
        _ => vec![dimension.replacen(':', "$", 1).replace('/', "%")],
    }
}

pub fn minimap_folders(dimension: &str) -> Vec<String> {
    match dimension {
        "minecraft:overworld" => vec!["dim%0".into(), "Overworld".into()],
        "minecraft:the_nether" => vec!["dim%-1".into(), "Nether".into()],
        "minecraft:the_end" => vec!["dim%1".into(), "The End".into()],
        _ => vec![format!(
            "dim%{}",
            dimension.replacen(':', "$", 1).replace('/', "%")
        )],
    }
}

pub fn xaero_region(name: &str) -> Option<(i32, i32)> {
    let stem = name
        .strip_suffix(".zip")
        .or_else(|| name.strip_suffix(".xaero"))?;
    let (x, z) = stem.split_once('_')?;
    Some((parse_coordinate(x)?, parse_coordinate(z)?))
}

pub fn is_multiworld(name: &str) -> bool {
    name.starts_with("mw$")
        || name.starts_with("cm$")
        || name.strip_prefix("mw").is_some_and(|rest| {
            let parts: Vec<&str> = rest.split(',').collect();
            parts.len() == 3
                && parts.iter().all(|part| {
                    let digits = part.strip_prefix('-').unwrap_or(part);
                    !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
                })
        })
}
