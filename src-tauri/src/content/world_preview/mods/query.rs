use super::*;

pub struct TileQuery<'a> {
    pub game: &'a Path,
    pub cache: &'a Path,
    pub source: &'a str,
    pub layer: &'a str,
    pub x: i32,
    pub z: i32,
    pub lod: u32,
}

pub fn tile(query: &TileQuery, cancel: &CancellationToken) -> AppResult<Option<Vec<u8>>> {
    let location = sources::resolve(query.game, query.source)?;
    let layer = layer_dir(&location.dir, query.layer)?;
    tiles::render(
        &tiles::TileRequest {
            cache: query.cache,
            layer: &layer,
            kind: location.kind,
            x: query.x,
            z: query.z,
            lod: query.lod,
        },
        cancel,
    )
}

pub fn world_waypoints(
    game: &Path,
    world: &str,
    dimension: &str,
    multiworld: Option<&str>,
) -> Vec<Waypoint> {
    let Ok(game) = game.canonicalize() else {
        return Vec::new();
    };
    if !sources::single(world) {
        return Vec::new();
    }
    let mut files = Vec::new();
    for root in sources::MINIMAP_ROOTS {
        for folder in names::minimap_folders(dimension) {
            let Ok(dir) = contained(&game, &game.join(root).join(world).join(folder)) else {
                continue;
            };
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten().take(256) {
                if entry.file_type().is_ok_and(|t| t.is_file()) {
                    if let Some(name) = entry.file_name().to_str() {
                        files.push((name.to_string(), entry.path()));
                    }
                }
            }
        }
    }
    let preferred: Vec<&(String, PathBuf)> = files
        .iter()
        .filter(|(name, _)| waypoints::file_matches(name, multiworld))
        .collect();
    let chosen = if preferred.is_empty() {
        files
            .iter()
            .filter(|(name, _)| waypoints::file_matches(name, None))
            .collect()
    } else {
        preferred
    };
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for (_, path) in chosen.into_iter().take(MAX_WAYPOINT_FILES) {
        let Ok(path) = contained(&game, path) else {
            continue;
        };
        let Ok(bytes) = File::open(path).and_then(|file| read_limited(file, MAX_WAYPOINT_FILE))
        else {
            continue;
        };
        waypoints::parse(&String::from_utf8_lossy(&bytes), &mut out, &mut seen);
    }
    out
}
