use super::super::nbt::{self, Tag};
use super::{contained, open_file, read_limited};
use crate::error::{AppError, AppResult};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const NBT_LIMIT: usize = 8 * 1024 * 1024;
const MAX_COORDINATE: i32 = 30_000_000;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Center {
    Spawn,
    Player,
}

impl Center {
    pub fn name(self) -> &'static str {
        match self {
            Self::Spawn => "spawn",
            Self::Player => "player",
        }
    }
}

#[derive(Serialize)]
pub struct Position {
    pub x: i32,
    pub z: i32,
    pub dimension: String,
}

impl Position {
    fn new(x: i32, z: i32, dimension: String) -> Option<Self> {
        let range = -MAX_COORDINATE..=MAX_COORDINATE;
        (range.contains(&x) && range.contains(&z)).then_some(Self { x, z, dimension })
    }

    pub fn region(&self, world: &Path) -> Option<PathBuf> {
        let (namespace, name) = self.dimension.split_once(':')?;
        let modern = world
            .join("dimensions")
            .join(namespace)
            .join(name)
            .join("region");
        if modern.exists() {
            return contained(world, &modern).ok();
        }
        let legacy = match self.dimension.as_str() {
            "minecraft:overworld" => world.join("region"),
            "minecraft:the_nether" => world.join("DIM-1/region"),
            "minecraft:the_end" => world.join("DIM1/region"),
            _ => return None,
        };
        contained(world, &legacy).ok()
    }
}

#[derive(Serialize)]
pub struct WorldInfo {
    seed: Option<String>,
    version: Option<String>,
    data_version: Option<i64>,
    play_seconds: Option<u64>,
    pub spawn: Option<Position>,
    pub player: Option<Position>,
}

pub fn read_info(world: &Path) -> AppResult<WorldInfo> {
    let root = level(world)?;
    let data = root.get("Data").unwrap_or(&root);
    let seed = data
        .get("WorldGenSettings")
        .and_then(|tag| number(tag, "seed"))
        .or_else(|| number(data, "RandomSeed"))
        .or_else(|| {
            let settings = read_nbt(world, &world.join("data/minecraft/world_gen_settings.dat"))?;
            number(settings.get("data").unwrap_or(&settings), "seed")
        });
    let version = data.get("Version");
    let owner = owner(data);
    Ok(WorldInfo {
        seed: seed.map(|seed| seed.to_string()),
        version: version
            .and_then(|tag| tag.get("Name"))
            .and_then(Tag::as_str)
            .map(str::to_owned),
        data_version: number(data, "DataVersion").or_else(|| number(version?, "Id")),
        play_seconds: play_seconds(world, owner),
        spawn: spawn_pos(data),
        player: last_position(world, data, owner),
    })
}

pub fn read_position(world: &Path, center: Center) -> AppResult<Option<Position>> {
    let root = level(world)?;
    let data = root.get("Data").unwrap_or(&root);
    Ok(match center {
        Center::Spawn => spawn_pos(data),
        Center::Player => last_position(world, data, owner(data)),
    })
}

fn level(world: &Path) -> AppResult<Tag> {
    read_nbt(world, &world.join("level.dat"))
        .or_else(|| read_nbt(world, &world.join("level.dat_old")))
        .ok_or_else(|| AppError::NotFound("level.dat".into()))
}

fn owner(data: &Tag) -> Option<Uuid> {
    data.get("singleplayer_uuid")
        .and_then(uuid_tag)
        .or_else(|| {
            let player = data.get("Player")?;
            player.get("UUID").and_then(uuid_tag).or_else(|| {
                let most = number(player, "UUIDMost")? as u64;
                let least = number(player, "UUIDLeast")? as u64;
                Some(Uuid::from_u64_pair(most, least))
            })
        })
}

fn last_position(world: &Path, data: &Tag, owner: Option<Uuid>) -> Option<Position> {
    data.get("Player").and_then(player_pos).or_else(|| {
        let id = owner?;
        ["players/data", "playerdata"].into_iter().find_map(|dir| {
            player_pos(&read_nbt(
                world,
                &world.join(dir).join(format!("{id}.dat")),
            )?)
        })
    })
}

fn read_nbt(world: &Path, path: &Path) -> Option<Tag> {
    let bytes = read_limited(open_file(world, path).ok()?, NBT_LIMIT).ok()?;
    if bytes.starts_with(&[0x1f, 0x8b]) {
        let bytes = read_limited(GzDecoder::new(bytes.as_slice()), NBT_LIMIT).ok()?;
        nbt::parse_with_arrays(&bytes).ok()
    } else {
        nbt::parse_with_arrays(&bytes).ok()
    }
}

fn number(tag: &Tag, key: &str) -> Option<i64> {
    tag.get(key)?.as_i64()
}

fn dimension(tag: Option<&Tag>) -> Option<String> {
    let value = match tag {
        None => "minecraft:overworld",
        Some(Tag::String(id)) => id,
        Some(value) => match value.as_i64()? {
            -1 => "minecraft:the_nether",
            0 => "minecraft:overworld",
            1 => "minecraft:the_end",
            _ => return None,
        },
    };
    let (ns, name) = value.split_once(':').unwrap_or(("minecraft", value));
    let valid_part = |part: &str| {
        !part.is_empty()
            && !part.ends_with('.')
            && part
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"_.-".contains(&c))
    };
    (valid_part(ns) && name.split('/').all(valid_part)).then(|| format!("{ns}:{name}"))
}

fn spawn_pos(data: &Tag) -> Option<Position> {
    if let Some(respawn) = data.get("spawn").or_else(|| data.get("respawn")) {
        let (x, z) = match respawn.get("pos")? {
            Tag::Ints(pos) => (*pos.first()?, *pos.get(2)?),
            Tag::List(pos) => (
                pos.first()?.as_i64()?.try_into().ok()?,
                pos.get(2)?.as_i64()?.try_into().ok()?,
            ),
            _ => return None,
        };
        return Position::new(x, z, dimension(respawn.get("dimension"))?);
    }
    let x = number(data, "SpawnX")?.try_into().ok()?;
    let z = number(data, "SpawnZ")?.try_into().ok()?;
    Position::new(x, z, dimension(data.get("SpawnDimension"))?)
}

fn player_pos(player: &Tag) -> Option<Position> {
    let Tag::List(pos) = player.get("Pos")? else {
        return None;
    };
    let coord = |tag: &Tag| {
        let Tag::Double(value) = tag else { return None };
        let value = value.floor();
        let max = f64::from(MAX_COORDINATE);
        (-max..=max).contains(&value).then_some(value as i32)
    };
    Position::new(
        coord(pos.first()?)?,
        coord(pos.get(2)?)?,
        dimension(player.get("Dimension"))?,
    )
}

fn uuid_tag(tag: &Tag) -> Option<Uuid> {
    match tag {
        Tag::String(id) => Uuid::parse_str(id).ok(),
        Tag::Ints(words) if words.len() == 4 => {
            let mut bytes = [0; 16];
            for (dest, word) in bytes.chunks_exact_mut(4).zip(words) {
                dest.copy_from_slice(&word.to_be_bytes());
            }
            Some(Uuid::from_bytes(bytes))
        }
        _ => None,
    }
}

fn play_seconds(world: &Path, owner: Option<Uuid>) -> Option<u64> {
    let path = ["players/stats", "stats"].into_iter().find_map(|dir| {
        let dir = contained(world, &world.join(dir)).ok()?;
        if let Some(owner) = owner {
            let file = dir.join(format!("{owner}.json"));
            return file.is_file().then_some(file);
        }
        let mut files = fs::read_dir(dir)
            .ok()?
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension().is_some_and(|ext| ext == "json")
                    && path
                        .file_stem()
                        .and_then(|id| id.to_str())
                        .is_some_and(|id| Uuid::parse_str(id).is_ok())
            });
        let file = files.next()?;
        files.next().is_none().then_some(file)
    })?;
    let bytes = read_limited(open_file(world, &path).ok()?, NBT_LIMIT).ok()?;
    let stats: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let custom = &stats["stats"]["minecraft:custom"];
    custom["minecraft:play_time"]
        .as_u64()
        .or_else(|| custom["minecraft:play_one_minute"].as_u64())
        .or_else(|| stats["stat.playOneMinute"].as_u64())
        .map(|ticks| ticks / 20)
}
