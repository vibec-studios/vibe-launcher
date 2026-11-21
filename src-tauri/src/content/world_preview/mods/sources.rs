use super::super::contained;
use super::names;
use crate::error::{AppError, AppResult};
use crate::platform::servers::ServerEntry;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const MAX_SOURCES: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Xaero,
    Journeymap,
}

struct Root {
    kind: Kind,
    path: &'static str,
    multiplayer: Option<bool>,
}

const ROOTS: [Root; 4] = [
    Root {
        kind: Kind::Xaero,
        path: "xaero/world-map",
        multiplayer: None,
    },
    Root {
        kind: Kind::Xaero,
        path: "XaeroWorldMap",
        multiplayer: None,
    },
    Root {
        kind: Kind::Journeymap,
        path: "journeymap/data/sp",
        multiplayer: Some(false),
    },
    Root {
        kind: Kind::Journeymap,
        path: "journeymap/data/mp",
        multiplayer: Some(true),
    },
];

pub const MINIMAP_ROOTS: [&str; 2] = ["xaero/minimap", "XaeroWaypoints"];

#[derive(Debug, Clone, Serialize)]
pub struct MapSource {
    pub id: String,
    pub kind: Kind,
    pub world: String,
    pub multiplayer: bool,
    pub name: String,
    pub servers: Vec<String>,
    pub dimensions: Vec<String>,
    pub modified: Option<u64>,
}

pub struct Location {
    pub kind: Kind,
    pub dir: PathBuf,
    pub world: String,
}

pub fn list(game: &Path, servers: &[ServerEntry]) -> Vec<MapSource> {
    let Ok(game) = game.canonicalize() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (index, root) in ROOTS.iter().enumerate() {
        let Ok(base) = contained(&game, &game.join(root.path)) else {
            continue;
        };
        let Ok(entries) = fs::read_dir(&base) else {
            continue;
        };
        for entry in entries.flatten().take(MAX_SOURCES * 4) {
            if out.len() >= MAX_SOURCES {
                return out;
            }
            let Some(world) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if !entry.file_type().is_ok_and(|t| t.is_dir()) || !single(&world) {
                continue;
            }
            let dimensions = dimensions(root.kind, &entry.path());
            if dimensions.is_empty() {
                continue;
            }
            let multiplayer = root.multiplayer.unwrap_or_else(|| {
                world.starts_with("Multiplayer_") || world.starts_with("Realms_")
            });
            let name = display_name(root.kind, &world);
            let servers = if multiplayer {
                servers
                    .iter()
                    .filter(|server| matches_server(root.kind, &world, server))
                    .map(|server| server.ip.clone())
                    .collect()
            } else {
                Vec::new()
            };
            out.push(MapSource {
                id: format!("{}:{index}:{world}", kind_name(root.kind)),
                kind: root.kind,
                modified: modified(&entry.path()),
                world,
                multiplayer,
                name,
                servers,
                dimensions,
            });
        }
    }
    out
}

fn kind_name(kind: Kind) -> &'static str {
    match kind {
        Kind::Xaero => "xaero",
        Kind::Journeymap => "journeymap",
    }
}

pub fn resolve(game: &Path, id: &str) -> AppResult<Location> {
    let invalid = || AppError::Invalid("Kartenquelle".into());
    let mut parts = id.splitn(3, ':');
    let kind = parts.next().ok_or_else(invalid)?;
    let index: usize = parts
        .next()
        .and_then(|i| i.parse().ok())
        .ok_or_else(invalid)?;
    let world = parts.next().ok_or_else(invalid)?;
    let root = ROOTS.get(index).ok_or_else(invalid)?;
    if kind_name(root.kind) != kind || !single(world) {
        return Err(invalid());
    }
    let game = game.canonicalize()?;
    let dir = contained(&game, &game.join(root.path).join(world))?;
    if !dir.is_dir() {
        return Err(AppError::NotFound("Kartenquelle".into()));
    }
    Ok(Location {
        kind: root.kind,
        dir,
        world: world.to_string(),
    })
}

pub fn single(name: &str) -> bool {
    let mut components = Path::new(name).components();
    !name.contains(['/', '\\', ':'])
        && matches!(components.next(), Some(Component::Normal(_)))
        && components.next().is_none()
}

fn dimensions(kind: Kind, dir: &Path) -> Vec<String> {
    let mut out: Vec<String> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .take(256)
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_str()?;
            match kind {
                Kind::Xaero => names::xaero_dimension(name),
                Kind::Journeymap => names::journeymap_dimension(name),
            }
        })
        .collect();
    out.sort_by_key(|dim| match dim.as_str() {
        "minecraft:overworld" => (0, String::new()),
        "minecraft:the_nether" => (1, String::new()),
        "minecraft:the_end" => (2, String::new()),
        other => (3, other.to_string()),
    });
    out.dedup();
    out
}

fn modified(dir: &Path) -> Option<u64> {
    let time = fs::metadata(dir).ok()?.modified().ok()?;
    Some(time.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

fn display_name(kind: Kind, world: &str) -> String {
    let name = match kind {
        Kind::Xaero => world
            .strip_prefix("Multiplayer_")
            .or_else(|| world.strip_prefix("Realms_"))
            .unwrap_or(world),
        Kind::Journeymap => world.split('~').next().unwrap_or(world),
    };
    name.chars().take(80).collect()
}

fn key(value: &str) -> String {
    value
        .chars()
        .filter_map(|c| {
            let c = c.to_ascii_lowercase();
            (c.is_ascii_alphanumeric() || c == '.').then_some(c)
        })
        .collect()
}

fn server_keys(server: &ServerEntry) -> Vec<String> {
    let address = server.ip.trim().trim_end_matches('.').to_ascii_lowercase();
    let (host, port) = match address.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') && port.parse::<u16>().is_ok() => {
            (host.to_string(), Some(port.to_string()))
        }
        _ => (address.clone(), None),
    };
    let mut keys = vec![key(&address), key(&host)];
    if let Some(port) = &port {
        keys.push(format!("{}{port}", key(&host)));
    }
    let labels: Vec<&str> = host.split('.').collect();
    let numeric = labels.iter().all(|l| l.bytes().all(|b| b.is_ascii_digit()));
    if labels.len() >= 3 && !numeric {
        keys.push(key(&labels[labels.len() - 2..].join(".")));
    }
    let name = key(&server.name);
    if name.len() >= 3 {
        keys.push(name);
    }
    keys.retain(|k| k.len() >= 3);
    keys.dedup();
    keys
}

pub fn matches_server(kind: Kind, world: &str, server: &ServerEntry) -> bool {
    let folder = key(&display_name(kind, world));
    if folder.is_empty() {
        return false;
    }
    let keys = server_keys(server);
    keys.iter().any(|k| *k == folder)
        || (kind == Kind::Journeymap && keys.iter().any(|k| k.len() >= 4 && folder.starts_with(k)))
}
