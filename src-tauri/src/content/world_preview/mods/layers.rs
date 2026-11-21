use super::*;

pub(super) fn xaero_layer(dir: &Path, dimension: &str) -> Option<(Vec<String>, Scan, bool)> {
    let mut candidates = Vec::new();
    let mut caves = Vec::new();
    for folder in names::xaero_folders(dimension) {
        let dim_dir = dir.join(&folder);
        if !dim_dir.is_dir() {
            continue;
        }
        candidates.push((
            vec![folder.clone()],
            scan(sources::Kind::Xaero, &dim_dir),
            0,
        ));
        for (mw, mw_dir) in subdirs(&dim_dir) {
            if !names::is_multiworld(&mw) {
                continue;
            }
            let path = vec![folder.clone(), mw.clone()];
            candidates.push((path.clone(), scan(sources::Kind::Xaero, &mw_dir), 1));
            for (layer, layer_dir) in subdirs(&mw_dir.join("caves")) {
                if layer.parse::<i32>().is_err() {
                    continue;
                }
                let mut path = path.clone();
                path.extend(["caves".to_string(), layer]);
                caves.push((path, scan(sources::Kind::Xaero, &layer_dir), 0));
            }
        }
    }
    if let Some((path, scan)) = best(candidates) {
        return Some((path, scan, false));
    }
    let (path, scan) = caves
        .into_iter()
        .filter(|(_, scan, _)| !scan.regions.is_empty())
        .max_by_key(|(_, scan, _)| scan.regions.len())
        .map(|(path, scan, _)| (path, scan))?;
    Some((path, scan, true))
}

pub(super) fn journeymap_layer(dir: &Path, dimension: &str) -> Option<(Vec<String>, Scan, bool)> {
    let mut candidates = Vec::new();
    for folder in names::journeymap_folders(dimension) {
        let dim_dir = dir.join(&folder);
        if !dim_dir.is_dir() {
            continue;
        }
        for (layer, layer_dir) in subdirs(&dim_dir) {
            let Some(rank) = names::layer_rank(&layer) else {
                continue;
            };
            let scan = scan(sources::Kind::Journeymap, &layer_dir);
            let rank = rank * 100_000
                + if rank == 0 {
                    scan.regions.len() as i32
                } else {
                    0
                };
            candidates.push((vec![folder.clone(), layer], scan, rank));
        }
    }
    let cave = candidates
        .iter()
        .filter(|(_, scan, _)| !scan.regions.is_empty())
        .max_by_key(|(_, _, rank)| *rank)
        .is_some_and(|(_, _, rank)| *rank < 100_000);
    let (path, scan) = best(candidates)?;
    Some((path, scan, cave))
}

pub fn overview(game: &Path, source: &str, dimension: &str) -> AppResult<Option<Overview>> {
    let location = sources::resolve(game, source)?;
    let layer = match location.kind {
        sources::Kind::Xaero => xaero_layer(&location.dir, dimension),
        sources::Kind::Journeymap => journeymap_layer(&location.dir, dimension),
    };
    let Some((path, scan, cave)) = layer else {
        return Ok(None);
    };
    let waypoints = if location.kind == sources::Kind::Xaero {
        let multiworld = path.get(1).filter(|name| names::is_multiworld(name));
        world_waypoints(
            game,
            &location.world,
            dimension,
            multiworld.map(String::as_str),
        )
    } else {
        Vec::new()
    };
    Ok(Some(Overview {
        layer: path.join("/"),
        cave,
        regions: scan.regions,
        truncated: scan.truncated,
        latest: scan.latest.map(|(_, region)| region),
        waypoints,
    }))
}

pub(super) fn layer_dir(base: &Path, layer: &str) -> AppResult<PathBuf> {
    let parts: Vec<&str> = layer.split('/').collect();
    if parts.is_empty() || parts.len() > 6 || !parts.iter().all(|part| sources::single(part)) {
        return Err(AppError::Invalid("Kartenebene".into()));
    }
    let dir = contained(
        base,
        &parts
            .iter()
            .fold(base.to_path_buf(), |dir, part| dir.join(part)),
    )?;
    if !dir.is_dir() {
        return Err(AppError::NotFound("Kartenebene".into()));
    }
    Ok(dir)
}
