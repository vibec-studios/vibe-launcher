use super::*;

#[derive(Serialize)]
pub struct Overview {
    pub layer: String,
    pub cave: bool,
    pub regions: Vec<[i32; 2]>,
    pub truncated: bool,
    pub latest: Option<[i32; 2]>,
    pub waypoints: Vec<Waypoint>,
}

pub(super) struct Scan {
    pub(super) regions: Vec<[i32; 2]>,
    pub(super) truncated: bool,
    pub(super) latest: Option<(SystemTime, [i32; 2])>,
}

pub(super) fn scan(kind: sources::Kind, dir: &Path) -> Scan {
    let mut out = Scan {
        regions: Vec::new(),
        truncated: false,
        latest: None,
    };
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let region = match kind {
            sources::Kind::Xaero => names::xaero_region(name),
            sources::Kind::Journeymap => names::journeymap_region(name),
        };
        let Some((x, z)) = region else { continue };
        if out.regions.len() >= MAX_REGIONS {
            out.truncated = true;
            break;
        }
        out.regions.push([x, z]);
        if let Ok(time) = entry.metadata().and_then(|meta| meta.modified()) {
            if out.latest.is_none_or(|(latest, _)| time > latest) {
                out.latest = Some((time, [x, z]));
            }
        }
    }
    out.regions.sort_unstable();
    out.regions.dedup();
    out
}

pub(super) fn subdirs(dir: &Path) -> Vec<(String, PathBuf)> {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .take(512)
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|entry| Some((entry.file_name().to_str()?.to_string(), entry.path())))
        .filter(|(name, _)| sources::single(name))
        .collect()
}

pub(super) fn best(candidates: Vec<(Vec<String>, Scan, i32)>) -> Option<(Vec<String>, Scan)> {
    candidates
        .into_iter()
        .filter(|(_, scan, _)| !scan.regions.is_empty())
        .max_by_key(|(_, scan, rank)| {
            (*rank, scan.latest.map(|(time, _)| time), scan.regions.len())
        })
        .map(|(path, scan, _)| (path, scan))
}
