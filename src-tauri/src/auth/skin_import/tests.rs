use super::*;
use image::ImageEncoder;

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src").join("auth").join("testdata").join("skin-import")
}

fn roots(base: &Path) -> Roots {
    Roots { data: Some(base.join("data")), home: Some(base.join("home")), modrinth_override: None }
}

fn norisk_dir(base: &Path) -> PathBuf {
    let d = base.join("data");
    if cfg!(windows) {
        d.join("norisk").join("NoRiskClientV3")
    } else if cfg!(target_os = "macos") {
        d.join("gg.norisk.NoRiskClientV3")
    } else {
        d.join("noriskclientv3")
    }
}

#[test]
fn norisk_fixture() {
    let b = std::fs::read(fixtures().join("norisk-minecraft_skins.json")).unwrap();
    let v = parse_norisk(&b).unwrap();
    assert_eq!(v.len(), 2);
    assert_eq!(v[0].name.as_deref(), Some("Henny Slim"));
    assert_eq!(v[0].variant, SkinVariant::Slim);
    assert_eq!(v[1].variant, SkinVariant::Classic);
    assert_eq!(skins::png_dimensions(v[0].png.as_ref().unwrap()), Some((64, 64)));
    // data:-Präfix wird toleriert
    assert!(v[1].png.as_ref().unwrap().starts_with(b"\x89PNG"));
}

#[test]
fn lunar_fixture() {
    let b = std::fs::read(fixtures().join("lunar-saved_skins.json")).unwrap();
    let v = parse_lunar(&b).unwrap();
    // Steve/Alex und fremde Hosts fallen weg
    assert_eq!(v.len(), 2);
    let slim = v.iter().find(|r| r.name.as_deref() == Some("Mein Slim")).unwrap();
    assert_eq!(slim.variant, SkinVariant::Slim);
    assert!(slim.url.as_deref().unwrap().starts_with("http://textures.minecraft.net/texture/"));
    assert!(slim.png.is_none());
    assert!(v.iter().any(|r| r.name.is_none() && r.variant == SkinVariant::Classic));
}

/// Modrinth-Datenbank wie in der App (Migrationen skin-selector + add-saved-skin-order) nachbauen.
fn make_modrinth_db(path: &Path, pngs: &[(&str, &str, Option<&str>, Vec<u8>)]) {
    let c = rusqlite::Connection::open(path).unwrap();
    c.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE minecraft_users (uuid TEXT NOT NULL, active INTEGER NOT NULL DEFAULT FALSE, username TEXT NOT NULL,
            access_token TEXT NOT NULL, refresh_token TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY (uuid));
         CREATE TABLE custom_minecraft_skin_textures (texture_key TEXT NOT NULL, texture PNG BLOB NOT NULL, PRIMARY KEY (texture_key));
         CREATE TABLE custom_minecraft_skins (minecraft_user_uuid TEXT NOT NULL, texture_key TEXT NOT NULL,
            variant TEXT NOT NULL CHECK (variant IN ('CLASSIC', 'SLIM', 'UNKNOWN')), cape_id TEXT, display_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (minecraft_user_uuid, texture_key, variant, cape_id),
            FOREIGN KEY (texture_key) REFERENCES custom_minecraft_skin_textures(texture_key) ON DELETE CASCADE ON UPDATE CASCADE);
         INSERT INTO minecraft_users VALUES ('u-1', 1, 'Henny', 'SECRET', 'SECRET', 0);",
    )
    .unwrap();
    for (i, (key, variant, cape, png)) in pngs.iter().enumerate() {
        c.execute("INSERT OR IGNORE INTO custom_minecraft_skin_textures VALUES (?1, ?2)", rusqlite::params![key, png]).unwrap();
        c.execute(
            "INSERT INTO custom_minecraft_skins VALUES ('u-1', ?1, ?2, ?3, ?4)",
            rusqlite::params![key, variant, cape, (pngs.len() - i) as i64],
        )
        .unwrap();
    }
    // Verbindung offen lassen wäre WAL-Fall; hier schließen (Checkpoint passiert nicht zwingend)
}

fn png_fixture(name: &str) -> Vec<u8> {
    std::fs::read(fixtures().join(name)).unwrap()
}

#[test]
fn modrinth_db_read_only_copy() {
    let base = std::env::temp_dir().join(format!("vibe-skinimp-{}", uuid::Uuid::new_v4().simple()));
    let mr_dir = base.join("data").join("ModrinthApp");
    std::fs::create_dir_all(&mr_dir).unwrap();
    let db = mr_dir.join("app.db");
    make_modrinth_db(
        &db,
        &[
            ("local-aaa", "SLIM", Some("30743269-ab43-46e6-b25d-3b50b0f1ed41"), png_fixture("slim.png")),
            ("bbb", "CLASSIC", None, png_fixture("classic.png")),
        ],
    );
    let before = std::fs::read(&db).unwrap();
    let before_mtime = std::fs::metadata(&db).unwrap().modified().unwrap();
    let tmp = base.join("tmp");
    let (path, res) = read_source(ImportSource::Modrinth, &roots(&base), &tmp).unwrap();
    assert_eq!(path, db);
    let v = res.unwrap();
    assert_eq!(v.len(), 2);
    // display_order: zweiter Eintrag hat die kleinere Ordnung -> zuerst
    assert_eq!(v[0].variant, SkinVariant::Classic);
    assert_eq!(v[1].variant, SkinVariant::Slim);
    assert_eq!(v[1].cape_id.as_deref(), Some("30743269-ab43-46e6-b25d-3b50b0f1ed41"));
    assert_eq!(v[0].name.as_deref(), Some("Henny (1)"));
    // Original unverändert, Kopie aufgeräumt
    assert_eq!(std::fs::read(&db).unwrap(), before);
    assert_eq!(std::fs::metadata(&db).unwrap().modified().unwrap(), before_mtime);
    assert_eq!(std::fs::read_dir(&tmp).map(|r| r.count()).unwrap_or(0), 0);
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn sources_missing_are_hidden() {
    let base = std::env::temp_dir().join(format!("vibe-skinimp-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&base).unwrap();
    for s in ImportSource::ALL {
        assert!(read_source(s, &roots(&base), &base.join("tmp")).is_none());
    }
    // NoRisk + Lunar per Fixture an den echten relativen Pfaden
    let nd = norisk_dir(&base);
    std::fs::create_dir_all(&nd).unwrap();
    std::fs::copy(fixtures().join("norisk-minecraft_skins.json"), nd.join("minecraft_skins.json")).unwrap();
    let ld = base.join("home").join(".lunarclient").join("settings").join("game");
    std::fs::create_dir_all(&ld).unwrap();
    std::fs::copy(fixtures().join("lunar-saved_skins.json"), ld.join("saved_skins.json")).unwrap();
    assert_eq!(read_source(ImportSource::Norisk, &roots(&base), &base).unwrap().1.unwrap().len(), 2);
    assert_eq!(read_source(ImportSource::Lunar, &roots(&base), &base).unwrap().1.unwrap().len(), 2);
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn found_and_duplicates() {
    let png = png_fixture("slim.png");
    let sha = content_hash(&png);
    let raw = RawFound { name: None, variant: SkinVariant::Slim, cape_id: None, png: None, url: None };
    let f = found_from(ImportSource::Norisk, raw.clone(), png.clone(), &HashSet::new(), 3).unwrap();
    assert_eq!(f.key, format!("norisk:{sha}"));
    assert_eq!(f.name, "NoRisk Client 3");
    assert!(!f.in_library);
    let have: HashSet<String> = [sha.clone()].into_iter().collect();
    assert!(found_from(ImportSource::Norisk, raw.clone(), png, &have, 1).unwrap().in_library);
    // Ungültige Bilder (falsche Größe) werden verworfen
    assert!(found_from(ImportSource::Norisk, raw, skins_test_png(128, 128), &HashSet::new(), 1).is_none());
}

#[test]
fn same_pixels_same_hash() {
    let png = png_fixture("slim.png");
    let img = image::load_from_memory(&png).unwrap();
    let mut other = Vec::new();
    image::codecs::png::PngEncoder::new_with_quality(&mut other, image::codecs::png::CompressionType::Fast, image::codecs::png::FilterType::NoFilter)
        .write_image(img.as_bytes(), img.width(), img.height(), image::ExtendedColorType::Rgba8)
        .unwrap();
    assert_ne!(png, other);
    assert_eq!(content_hash(&png), content_hash(&other));
    assert_ne!(content_hash(&png), content_hash(&png_fixture("classic.png")));
}

fn skins_test_png(w: u32, h: u32) -> Vec<u8> {
    let mut b = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];
    b.extend_from_slice(b"IHDR");
    b.extend_from_slice(&w.to_be_bytes());
    b.extend_from_slice(&h.to_be_bytes());
    b.extend_from_slice(&[8, 6, 0, 0, 0, 1, 2, 3, 4]);
    b
}
