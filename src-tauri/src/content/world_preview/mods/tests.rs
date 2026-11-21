use super::xaero::{decode, Decoded};
use super::*;
use crate::platform::servers::ServerEntry;
use image::ImageEncoder as _;
use sha2::{Digest, Sha256};
use std::io::Write as _;
use uuid::Uuid;

const NOT_GRASS: u32 = 1;
const OVERLAYS: u32 = 2;
const BIOME: u32 = 1 << 20;
const STATE_NEW: u32 = 1 << 21;
const BIOME_NEW: u32 = 1 << 22;

fn state_nbt(key: &str, name: &str) -> Vec<u8> {
    let mut out = vec![10, 0, 0];
    out.push(8);
    out.extend((key.len() as u16).to_be_bytes());
    out.extend(key.as_bytes());
    out.extend((name.len() as u16).to_be_bytes());
    out.extend(name.as_bytes());
    out.push(10);
    out.extend(10u16.to_be_bytes());
    out.extend(b"Properties");
    out.push(8);
    out.extend(4u16.to_be_bytes());
    out.extend(b"axis");
    out.extend(1u16.to_be_bytes());
    out.extend(b"y");
    out.push(0);
    out.push(0);
    out
}

fn height(y: i32) -> u32 {
    let raw = (y as u32) & 0xFFF;
    ((raw & 0xFF) << 12) | ((raw >> 8) << 25)
}

fn modern(major: u16, key: &str) -> Vec<u8> {
    let mut out = vec![0xFF];
    out.extend((((major as i32) << 16) | 8).to_be_bytes());
    out.push(0x21);
    for tile in 0..16 {
        if tile != 5 {
            out.extend((-1i32).to_be_bytes());
            continue;
        }
        for index in 0..256 {
            match index {
                0 => {
                    out.extend((NOT_GRASS | STATE_NEW | height(70)).to_be_bytes());
                    out.extend(state_nbt(key, "minecraft:stone"));
                }
                1 => {
                    out.extend((BIOME | BIOME_NEW | height(-12)).to_be_bytes());
                    out.extend(16u16.to_be_bytes());
                    out.extend(b"minecraft:desert");
                }
                2 => {
                    out.extend((NOT_GRASS | OVERLAYS | height(62)).to_be_bytes());
                    out.extend(0i32.to_be_bytes());
                    out.push(1);
                    out.extend((6u32 << 11).to_be_bytes());
                }
                3 => {
                    out.extend((NOT_GRASS | STATE_NEW | height(64)).to_be_bytes());
                    out.extend(state_nbt(key, "minecraft:air"));
                }
                _ => {
                    out.extend((NOT_GRASS | height(64)).to_be_bytes());
                    out.extend(0i32.to_be_bytes());
                }
            }
        }
        out.push(1);
        out.extend(i32::MAX.to_be_bytes());
        out.push(32);
    }
    out.extend([0x77, 0, 0]);
    out
}

fn pixel(canvas: &Canvas, x: u32, z: u32) -> [u8; 4] {
    canvas.image.get_pixel(x, z).0
}

#[test]
fn world_map_xaero_decodes_modern_palette_versions() {
    for (major, key) in [(7, "Name"), (8, "id")] {
        let mut canvas = Canvas::new();
        assert_eq!(
            decode(&modern(major, key), &mut canvas, &|| false),
            Decoded::Image
        );
        let (left, top) = (2 * 64 + 16, 64 + 16);
        let stone = pixel(&canvas, left, top);
        assert_eq!(stone, [133, 137, 139, 255]);
        let desert = pixel(&canvas, left, top + 1);
        assert_eq!(desert[3], 255);
        assert!(desert[0] > 150 && desert[2] < 100, "{desert:?}");
        let water = pixel(&canvas, left, top + 2);
        assert!(water[2] > water[0], "{water:?}");
        assert_eq!(pixel(&canvas, left, top + 3)[3], 0);
        assert_eq!(pixel(&canvas, left + 15, top + 15), stone);
        assert_eq!(pixel(&canvas, left + 16, top)[3], 0);
        assert_eq!(canvas.heights[(top * REGION + left) as usize], Some(70));
        assert_eq!(
            canvas.heights[((top + 1) * REGION + left) as usize],
            Some(-12)
        );
    }
}

#[test]
fn world_map_xaero_skips_unknown_versions_and_garbage() {
    let mut future = vec![0xFF];
    future.extend(((9i32 << 16) | 1).to_be_bytes());
    future.extend([0; 64]);
    let mut canvas = Canvas::new();
    assert_eq!(
        decode(&future, &mut canvas, &|| false),
        Decoded::Unsupported { major: 9, minor: 1 }
    );
    let mut minor = vec![0xFF];
    minor.extend(((7i32 << 16) | 9).to_be_bytes());
    assert!(matches!(
        decode(&minor, &mut Canvas::new(), &|| false),
        Decoded::Unsupported { .. }
    ));
    assert_eq!(decode(&[], &mut Canvas::new(), &|| false), Decoded::Empty);
    assert_eq!(
        decode(&[0x88, 1, 2], &mut Canvas::new(), &|| false),
        Decoded::Empty
    );
    let mut truncated = modern(7, "Name");
    truncated.truncate(truncated.len() / 2);
    let mut canvas = Canvas::new();
    assert_eq!(decode(&truncated, &mut canvas, &|| false), Decoded::Image);
    assert_eq!(
        decode(&modern(7, "Name"), &mut Canvas::new(), &|| true),
        Decoded::Cancelled
    );
    for seed in 0..64u32 {
        let mut noise = modern(7, "Name");
        for (i, byte) in noise.iter_mut().enumerate().skip(6) {
            if (i as u32).wrapping_mul(2_654_435_761).wrapping_add(seed) % 7 == 0 {
                *byte = byte.wrapping_add(seed as u8 | 1);
            }
        }
        let _ = decode(&noise, &mut Canvas::new(), &|| false);
    }
}

#[test]
fn world_map_xaero_decodes_legacy_unversioned_regions() {
    let mut out = vec![0x10];
    for tile in 0..16 {
        if tile != 0 {
            out.extend((-1i32).to_be_bytes());
            continue;
        }
        for index in 0..256u32 {
            if index % 2 == 0 {
                out.extend((NOT_GRASS | (64 << 12)).to_be_bytes());
                out.extend(12i32.to_be_bytes());
            } else {
                out.extend(((1u32 << 2) | (64 << 12)).to_be_bytes());
                out.push(2);
            }
        }
    }
    let mut canvas = Canvas::new();
    assert_eq!(decode(&out, &mut canvas, &|| false), Decoded::Image);
    assert_eq!(pixel(&canvas, 64, 0), [216, 203, 154, 255]);
    let grass = pixel(&canvas, 64, 1);
    assert!(grass[0] > 150, "{grass:?}");
}

fn region_zip(path: &Path, stream: &[u8]) {
    let file = File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    zip.start_file("region.xaero", zip::write::SimpleFileOptions::default())
        .unwrap();
    zip.write_all(stream).unwrap();
    zip.finish().unwrap();
}

fn tree_hash(dir: &Path) -> String {
    let mut files = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(dir).unwrap().flatten() {
            if entry.file_type().unwrap().is_dir() {
                stack.push(entry.path());
            } else {
                files.push(entry.path());
            }
        }
    }
    files.sort();
    let mut hash = Sha256::new();
    for file in files {
        hash.update(file.to_string_lossy().as_bytes());
        hash.update(fs::read(&file).unwrap());
    }
    hex::encode(hash.finalize())
}

fn server(name: &str, ip: &str) -> ServerEntry {
    ServerEntry {
        name: name.into(),
        ip: ip.into(),
        icon: None,
        accept_textures: None,
        hidden: false,
    }
}

#[test]
fn world_map_sources_overview_and_tiles_read_copies_only() {
    let temp = std::env::temp_dir().join(format!("vibe-world-map-{}", Uuid::new_v4()));
    let game = temp.join("minecraft");
    let mw = game.join("xaero/world-map/Multiplayer_play.example.net/null/mw$default");
    fs::create_dir_all(&mw).unwrap();
    region_zip(&mw.join("-1_2.zip"), &modern(7, "Name"));
    fs::write(mw.join("notes.txt"), "x").unwrap();
    let nether = game.join("XaeroWorldMap/Neue Welt/DIM-1/mw$default/caves/4");
    fs::create_dir_all(&nether).unwrap();
    region_zip(&nether.join("0_0.zip"), &modern(8, "id"));
    let minimap = game.join("xaero/minimap/Multiplayer_play.example.net/dim%0");
    fs::create_dir_all(&minimap).unwrap();
    fs::write(
        minimap.join("mw$default_1.txt"),
        "waypoint:Basis:B:-300:70:1100:10:false:0:gui.xaero_default:false:0:0:false\n",
    )
    .unwrap();
    fs::write(
        minimap.join("mw$other_1.txt"),
        "waypoint:Fremd:F:1:70:1:10:false:0:gui.xaero_default:false:0:0:false\n",
    )
    .unwrap();
    let jm = game.join("journeymap/data/mp/Example Server~abc/overworld/day");
    fs::create_dir_all(&jm).unwrap();
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(
            RgbaImage::from_pixel(512, 512, Rgba([10, 200, 30, 255])).as_raw(),
            512,
            512,
            image::ExtendedColorType::Rgba8,
        )
        .unwrap();
    fs::write(jm.join("3,-4.png"), &png).unwrap();
    let before = tree_hash(&game);

    let servers = [
        server("Example Server", "Play.Example.net:25565"),
        server("Andere", "other.net"),
    ];
    let mut found = list_sources(&game, &servers);
    found.sort_by(|a, b| a.id.cmp(&b.id));
    assert_eq!(found.len(), 3);
    let xaero = found.iter().find(|s| s.id.starts_with("xaero:0:")).unwrap();
    assert!(xaero.multiplayer);
    assert_eq!(xaero.name, "play.example.net");
    assert_eq!(xaero.servers, vec!["Play.Example.net:25565".to_string()]);
    assert_eq!(xaero.dimensions, vec!["minecraft:overworld".to_string()]);
    let single = found.iter().find(|s| s.id.starts_with("xaero:1:")).unwrap();
    assert!(!single.multiplayer);
    assert_eq!(single.world, "Neue Welt");
    let journey = found
        .iter()
        .find(|s| s.id.starts_with("journeymap:3:"))
        .unwrap();
    assert_eq!(journey.servers, vec!["Play.Example.net:25565".to_string()]);

    for bad in [
        "xaero:0:..",
        "xaero:0:a/b",
        "xaero:9:x",
        "journeymap:0:x",
        "xaero:0",
    ] {
        assert!(
            overview(&game, bad, "minecraft:overworld").is_err(),
            "{bad}"
        );
    }
    let view = overview(&game, &xaero.id, "minecraft:overworld")
        .unwrap()
        .unwrap();
    assert_eq!(view.layer, "null/mw$default");
    assert_eq!(view.regions, vec![[-1, 2]]);
    assert_eq!(view.latest, Some([-1, 2]));
    assert!(!view.cave);
    assert_eq!(view.waypoints.len(), 1);
    assert_eq!(view.waypoints[0].name, "Basis");
    assert!(overview(&game, &xaero.id, "minecraft:the_end")
        .unwrap()
        .is_none());
    let cave = overview(&game, &single.id, "minecraft:the_nether")
        .unwrap()
        .unwrap();
    assert_eq!(cave.layer, "DIM-1/mw$default/caves/4");
    assert!(cave.cave);

    let cache = temp.join("cache");
    let token = CancellationToken::new();
    let query = |source: &str, layer: &str, x, z, lod, token: &CancellationToken| {
        tile(
            &TileQuery {
                game: &game,
                cache: &cache,
                source,
                layer,
                x,
                z,
                lod,
            },
            token,
        )
    };
    let xaero_id = xaero.id.as_str();
    let first = query(xaero_id, "null/mw$default", -1, 2, 1, &token)
        .unwrap()
        .unwrap();
    let decoded = image::load_from_memory(&first).unwrap().into_rgba8();
    assert_eq!(decoded.dimensions(), (512, 512));
    assert_eq!(decoded.get_pixel(144, 80).0[3], 255);
    let small = query(xaero_id, "null/mw$default", -1, 2, 8, &token)
        .unwrap()
        .unwrap();
    assert_eq!(image::load_from_memory(&small).unwrap().width(), 64);
    let cached = query(xaero_id, "null/mw$default", -1, 2, 1, &token)
        .unwrap()
        .unwrap();
    assert_eq!(cached, first);
    assert!(query(xaero_id, "null/mw$default", 5, 5, 1, &token)
        .unwrap()
        .is_none());
    assert!(query(xaero_id, "null/mw$default", -1, 2, 3, &token).is_err());
    assert!(query(xaero_id, "../..", -1, 2, 1, &token).is_err());
    assert!(query(xaero_id, "null/mw$default/..", -1, 2, 1, &token).is_err());
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    assert!(matches!(
        query(xaero_id, "null/mw$default", -1, 2, 2, &cancelled),
        Ok(Some(_))
    ));

    let journey_id = journey.id.as_str();
    let jm_view = overview(&game, journey_id, "minecraft:overworld")
        .unwrap()
        .unwrap();
    assert_eq!(jm_view.layer, "overworld/day");
    assert_eq!(jm_view.regions, vec![[3, -4]]);
    let jm_tile = query(journey_id, "overworld/day", 3, -4, 2, &token)
        .unwrap()
        .unwrap();
    let jm_image = image::load_from_memory(&jm_tile).unwrap().into_rgba8();
    assert_eq!(jm_image.dimensions(), (256, 256));
    assert_eq!(jm_image.get_pixel(10, 10).0, [10, 200, 30, 255]);

    let points = world_waypoints(
        &game,
        "Multiplayer_play.example.net",
        "minecraft:overworld",
        None,
    );
    assert_eq!(points.len(), 2);
    assert!(world_waypoints(&game, "..", "minecraft:overworld", None).is_empty());

    assert_eq!(tree_hash(&game), before);
    let _ = fs::remove_dir_all(temp);
}

#[test]
fn world_map_server_matching_variants() {
    use sources::{matches_server, Kind};
    let host = server("Survival", "mc.example.org:25570");
    assert!(matches_server(
        Kind::Xaero,
        "Multiplayer_mc.example.org",
        &host
    ));
    assert!(matches_server(
        Kind::Xaero,
        "Multiplayer_mc.example.org_25570",
        &host
    ));
    assert!(matches_server(
        Kind::Xaero,
        "Multiplayer_example.org",
        &host
    ));
    assert!(matches_server(Kind::Xaero, "Multiplayer_Survival", &host));
    assert!(!matches_server(Kind::Xaero, "Multiplayer_other.org", &host));
    assert!(matches_server(Kind::Journeymap, "Survival~1234", &host));
    assert!(!matches_server(Kind::Journeymap, "Creative~1234", &host));
    let ip = server("x", "192.168.0.10");
    assert!(matches_server(Kind::Xaero, "Multiplayer_192.168.0.10", &ip));
    assert!(!matches_server(Kind::Xaero, "Multiplayer_168.0.10", &ip));
}

#[test]
fn world_map_renders_fixture_copies() {
    let Some(dir) = std::env::var_os("VIBE_WORLD_MAP_FIXTURES").map(PathBuf::from) else {
        return;
    };
    let temp = std::env::temp_dir().canonicalize().unwrap();
    let dir = dir.canonicalize().unwrap();
    assert!(
        dir.starts_with(&temp),
        "Fixtures nur als Kopie im Temp-Ordner"
    );
    let out = std::env::var_os("VIBE_WORLD_MAP_OUT").map(PathBuf::from);
    let mut count = 0;
    for entry in fs::read_dir(&dir).unwrap().flatten() {
        let path = entry.path();
        let before = fs::read(&path).unwrap();
        let kind = match path.extension().and_then(|e| e.to_str()) {
            Some("zip") => sources::Kind::Xaero,
            Some("png") => sources::Kind::Journeymap,
            _ => continue,
        };
        let mut canvas = Canvas::new();
        let painted = match kind {
            sources::Kind::Xaero => {
                let mut archive = zip::ZipArchive::new(File::open(&path).unwrap()).unwrap();
                let mut stream = Vec::new();
                std::io::Read::read_to_end(&mut archive.by_index(0).unwrap(), &mut stream).unwrap();
                let result = decode(&stream, &mut canvas, &|| false);
                println!("{}: {result:?}", path.display());
                result == Decoded::Image
            }
            sources::Kind::Journeymap => journeymap::decode(&before, &mut canvas).unwrap(),
        };
        assert!(painted, "{}", path.display());
        canvas.shade();
        if let Some(out) = &out {
            fs::create_dir_all(out).unwrap();
            let name = path.file_stem().unwrap().to_string_lossy().to_string();
            canvas.image.save(out.join(format!("{name}.png"))).unwrap();
        }
        assert_eq!(fs::read(&path).unwrap(), before);
        count += 1;
    }
    assert!(count > 0);
}
