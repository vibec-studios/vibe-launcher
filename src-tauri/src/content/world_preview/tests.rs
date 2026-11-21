use super::super::nbt::writer::W;
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use flate2::{write::GzEncoder, write::ZlibEncoder, Compression};
use image::RgbaImage;
use std::collections::BTreeMap;
use std::io::Write;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

struct Fixture {
    temp: PathBuf,
    source: PathBuf,
    copy: PathBuf,
    cache: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let temp = std::env::temp_dir().join(format!("vibe-world-preview-{}", Uuid::new_v4()));
        fs::create_dir(&temp).unwrap();
        let source = temp.join("source");
        let copy = temp.join("saves/copy");
        let cache = temp.join("cache");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&cache).unwrap();
        Self {
            temp,
            source,
            copy,
            cache,
        }
    }

    fn copy_world(&self) -> PathBuf {
        for entry in walkdir::WalkDir::new(&self.source) {
            let entry = entry.unwrap();
            let target = self
                .copy
                .join(entry.path().strip_prefix(&self.source).unwrap());
            if entry.file_type().is_dir() {
                fs::create_dir_all(target).unwrap();
            } else {
                fs::copy(entry.path(), target).unwrap();
            }
        }
        world_dir(self.copy.parent().unwrap(), "copy").unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.temp);
    }
}

fn gz(path: &Path, bytes: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(bytes).unwrap();
    fs::write(path, encoder.finish().unwrap()).unwrap();
}

fn field(w: &mut W, tag: u8, name: &str) {
    w.0.push(tag);
    w.0.extend((name.len() as u16).to_be_bytes());
    w.0.extend(name.as_bytes());
}

fn list(w: &mut W, name: &str, tag: u8, len: i32) {
    field(w, 9, name);
    w.0.push(tag);
    w.0.extend(len.to_be_bytes());
}

fn ints(w: &mut W, name: &str, values: &[i32]) {
    field(w, 11, name);
    w.0.extend((values.len() as i32).to_be_bytes());
    for value in values {
        w.0.extend(value.to_be_bytes());
    }
}

fn packed(count: usize, bits: usize, padded: bool, f: impl Fn(usize) -> i64) -> Vec<i64> {
    let stride = 64 / bits;
    let len = if padded {
        count.div_ceil(stride)
    } else {
        (count * bits).div_ceil(64)
    };
    let mut words = vec![0; len];
    for i in 0..count {
        let bit = if padded {
            (i / stride) * 64 + (i % stride) * bits
        } else {
            i * bits
        };
        words[bit / 64] |= f(i) << (bit % 64);
        if bit % 64 + bits > 64 {
            words[bit / 64 + 1] |= f(i) >> (64 - bit % 64);
        }
    }
    words
}

fn palette_chunk(modern: bool, land: &str) -> Vec<u8> {
    palette_chunk_with(modern, false, land)
}

fn palette_chunk_with(modern: bool, strings: bool, land: &str) -> Vec<u8> {
    let (section_key, palette_key, storage_key, y, height) = if modern {
        ("sections", "palette", "data", -4, 1)
    } else {
        ("Sections", "Palette", "BlockStates", 0, 1)
    };
    let mut w = W::new();
    w.begin("")
        .int("DataVersion", if modern { 4786 } else { 1976 });
    if modern {
        w.int("yPos", y);
    } else {
        w.begin("Level");
    }
    w.begin("Heightmaps")
        .long_array("WORLD_SURFACE", &packed(256, 9, modern, |_| height))
        .end();
    list(&mut w, section_key, 10, 1);
    w.byte("Y", y as i8);
    if modern {
        w.begin("block_states");
    }
    let mut names = vec!["minecraft:air".to_owned(), land.to_owned()];
    names.extend((2..16).map(|_| "minecraft:sand".to_owned()));
    names.push("minecraft:water[level=0]".to_owned());
    if strings {
        list(&mut w, palette_key, 8, 17);
        for name in &names {
            w.0.extend((name.len() as u16).to_be_bytes());
            w.0.extend(name.as_bytes());
        }
    } else {
        list(&mut w, palette_key, 10, 17);
        for name in &names {
            w.string("Name", name.split('[').next().unwrap()).end();
        }
    }
    let blocks = packed(4096, 5, modern, |i| match i {
        12 | 255 => 16,
        0..=255 => 1,
        _ => 0,
    });
    w.long_array(storage_key, &blocks).end().end().end();
    w.0
}

fn region(dir: &Path, x: i32, z: i32, bytes: &[u8], external: bool, changed_length: bool) {
    fs::create_dir_all(dir).unwrap();
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(bytes).unwrap();
    let compressed = encoder.finish().unwrap();
    let mut file = vec![0; if changed_length { 16384 } else { 12288 }];
    let slot = (x.rem_euclid(32) + z.rem_euclid(32) * 32) as usize * 4;
    file[slot..slot + 4].copy_from_slice(&[0, 0, 2, 1]);
    let length = if external {
        1
    } else {
        compressed.len() as u32 + 1
    };
    file[8192..8196].copy_from_slice(&length.to_be_bytes());
    file[8196] = if external { 0x82 } else { 2 };
    if external {
        fs::write(dir.join(format!("c.{x}.{z}.mcc")), compressed).unwrap();
    } else {
        file[8197..8197 + compressed.len()].copy_from_slice(&compressed);
    }
    fs::write(
        dir.join(format!("r.{}.{}.mca", x.div_euclid(32), z.div_euclid(32))),
        file,
    )
    .unwrap();
}

fn image(png: &str) -> RgbaImage {
    image::load_from_memory(&STANDARD.decode(png).unwrap())
        .unwrap()
        .into_rgba8()
}

fn snapshot(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    walkdir::WalkDir::new(root)
        .into_iter()
        .flatten()
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| {
            (
                entry.path().strip_prefix(root).unwrap().to_owned(),
                fs::read(entry.path()).unwrap(),
            )
        })
        .collect()
}

#[test]
fn world_preview_reads_current_layout_and_caches_read_only() {
    let fixture = Fixture::new();
    let mut level = W::new();
    level
        .begin("")
        .begin("Data")
        .int("DataVersion", 4786)
        .begin("Version")
        .string("Name", "26.1")
        .end()
        .begin("spawn")
        .string("dimension", "minecraft:overworld");
    ints(&mut level, "pos", &[0, 64, 0]);
    level.end();
    ints(&mut level, "singleplayer_uuid", &[0, 0, 0, 1]);
    level.end().end();
    gz(&fixture.source.join("level.dat"), &level.0);

    let mut settings = W::new();
    settings
        .begin("")
        .begin("data")
        .long("seed", i64::MIN + 1)
        .end()
        .end();
    gz(
        &fixture.source.join("data/minecraft/world_gen_settings.dat"),
        &settings.0,
    );

    let owner = Uuid::from_u128(1);
    let mut player = W::new();
    player.begin("").string("Dimension", "minecraft:overworld");
    list(&mut player, "Pos", 6, 3);
    for position in [-0.1f64, 64.0, -0.1] {
        player.0.extend(position.to_be_bytes());
    }
    player.end();
    gz(
        &fixture.source.join(format!("players/data/{owner}.dat")),
        &player.0,
    );
    fs::create_dir_all(fixture.source.join("players/stats")).unwrap();
    fs::write(
        fixture.source.join(format!("players/stats/{owner}.json")),
        br#"{"stats":{"minecraft:custom":{"minecraft:play_time":73000}}}"#,
    )
    .unwrap();

    let region_dir = "dimensions/minecraft/overworld/region";
    region(
        &fixture.source.join(region_dir),
        -1,
        -1,
        &palette_chunk(true, "minecraft:grass_block"),
        true,
        false,
    );
    let world = fixture.copy_world();
    let original = snapshot(&world);
    let info = serde_json::to_value(read_info(&world).unwrap()).unwrap();
    assert_eq!(info["seed"], (i64::MIN + 1).to_string());
    assert_eq!(info["version"], "26.1");
    assert_eq!(info["play_seconds"], 3650);
    assert_eq!(info["player"]["x"], -1);
    assert_eq!(info["player"]["z"], -1);

    let token = CancellationToken::new();
    let map = render(&world, &fixture.cache, Center::Player, &token)
        .unwrap()
        .unwrap();
    let picture = image(&map.png);
    assert_eq!(picture.dimensions(), (SIDE, SIDE));
    assert_eq!(picture.get_pixel(128, 128).0, [54, 112, 182, 255]);
    assert_eq!(picture.get_pixel(127, 128).0, [107, 152, 66, 255]);
    assert_eq!(picture.get_pixel(129, 129).0, [0; 4]);
    let cached = snapshot(&fixture.cache);
    assert_eq!(cached.len(), 1);
    assert_eq!(
        render(&world, &fixture.cache, Center::Player, &token)
            .unwrap()
            .unwrap()
            .png,
        map.png
    );
    assert_eq!(snapshot(&fixture.cache), cached);
    assert_eq!(snapshot(&world), original);

    region(
        &world.join(region_dir),
        -1,
        -1,
        &palette_chunk(true, "minecraft:sand"),
        true,
        true,
    );
    let updated = render(&world, &fixture.cache, Center::Player, &token)
        .unwrap()
        .unwrap();
    assert_eq!(
        image(&updated.png).get_pixel(127, 128).0,
        [216, 203, 154, 255]
    );
    assert_eq!(snapshot(&fixture.cache).len(), 1);
    token.cancel();
    assert!(matches!(
        render(&world, &fixture.cache, Center::Player, &token),
        Err(AppError::Cancelled)
    ));
}

#[test]
fn world_preview_renders_dense_anvil_palette_at_spawn() {
    let fixture = Fixture::new();
    let mut level = W::new();
    level
        .begin("")
        .begin("Data")
        .int("SpawnX", 0)
        .int("SpawnZ", 0)
        .end()
        .end();
    gz(&fixture.source.join("level.dat_old"), &level.0);
    region(
        &fixture.source.join("region"),
        0,
        0,
        &palette_chunk(false, "minecraft:grass_block"),
        false,
        false,
    );
    let world = fixture.copy_world();
    let map = render(
        &world,
        &fixture.cache,
        Center::Spawn,
        &CancellationToken::new(),
    )
    .unwrap()
    .unwrap();
    let picture = image(&map.png);
    assert_eq!(picture.get_pixel(128, 128).0, [107, 152, 66, 255]);
    assert_eq!(picture.get_pixel(140, 128).0, [54, 112, 182, 255]);
    assert!(world_dir(world.parent().unwrap(), "../source").is_err());
    assert!(!outside_worlds(&world));
}

#[test]
fn world_preview_reads_string_palette_of_newer_versions() {
    let fixture = Fixture::new();
    let mut level = W::new();
    level
        .begin("")
        .begin("Data")
        .int("DataVersion", 5023)
        .begin("spawn")
        .string("dimension", "minecraft:overworld");
    ints(&mut level, "pos", &[3, 64, 3]);
    level.end().end().end();
    gz(&fixture.source.join("level.dat"), &level.0);
    region(
        &fixture.source.join("dimensions/minecraft/overworld/region"),
        0,
        0,
        &palette_chunk_with(true, true, "minecraft:grass_block"),
        false,
        false,
    );
    let world = fixture.copy_world();
    let map = render(&world, &fixture.cache, Center::Spawn, &CancellationToken::new())
        .unwrap()
        .unwrap();
    let picture = image(&map.png);
    assert_eq!(picture.get_pixel(125, 125).0, [107, 152, 66, 255]);
    assert_eq!(picture.get_pixel(137, 125).0, [54, 112, 182, 255]);
}

#[test]
#[ignore = "requires copies of real worlds under TEMP/.../saves"]
fn world_preview_renders_world_copies() {
    let saves = PathBuf::from(std::env::var_os("VIBE_WORLD_PREVIEW_FIXTURE_SAVES").unwrap())
        .canonicalize()
        .unwrap();
    assert!(saves.starts_with(std::env::temp_dir().canonicalize().unwrap()));
    assert_eq!(saves.file_name().unwrap(), "saves");
    let out = std::env::var_os("VIBE_WORLD_PREVIEW_OUT").map(PathBuf::from);
    let fixture = Fixture::new();
    let mut rendered = 0;
    for entry in fs::read_dir(&saves).unwrap().flatten() {
        let folder = entry.file_name().into_string().unwrap();
        let world = world_dir(&saves, &folder).unwrap();
        let before = snapshot(&world);
        let info = serde_json::to_value(read_info(&world).unwrap()).unwrap();
        println!("{folder}: {info}");
        for center in [Center::Spawn, Center::Player] {
            let started = std::time::Instant::now();
            let Some(map) = render(&world, &fixture.cache, center, &CancellationToken::new()).unwrap() else {
                println!("{folder}/{}: keine Karte", center.name());
                continue;
            };
            let first = started.elapsed();
            let again = std::time::Instant::now();
            let cached = render(&world, &fixture.cache, center, &CancellationToken::new())
                .unwrap()
                .unwrap();
            assert_eq!(cached.png, map.png);
            let picture = image(&map.png);
            let filled = picture.pixels().filter(|pixel| pixel.0[3] == 255).count();
            println!(
                "{folder}/{}: {filled} Pixel, {first:?}, Cache {:?}",
                center.name(),
                again.elapsed()
            );
            assert_eq!(picture.dimensions(), (SIDE, SIDE));
            assert!(filled > 1_000);
            if let Some(out) = &out {
                fs::write(
                    out.join(format!("{folder}-{}.png", center.name())),
                    STANDARD.decode(&map.png).unwrap(),
                )
                .unwrap();
            }
            rendered += 1;
        }
        assert_eq!(snapshot(&world), before);
    }
    assert!(rendered > 0);
}
