use super::*;

#[test]
fn parses_profile_with_textures() {
    let body = br#"{"animatedCape":true,"capeGlint":true,"upsideDown":false,"animated_cape_url":null,
        "cape_url":"https://textures.minecraftcapes.net/capes/6c95d3509caa","ear_url":"https://textures.minecraftcapes.net/ears/0ed6ea78",
        "textures":{"_IMPORTANT":"We are removing base64 textures","cape":"iVBORw0KGgo=","ears":null}}"#;
    let p = parse_profile(body).unwrap();
    assert!(p.cape_glint);
    assert!(!p.upside_down);
    assert_eq!(p.cape_url.as_deref(), Some("https://textures.minecraftcapes.net/capes/6c95d3509caa"));
    assert_eq!(p.ear_url.as_deref(), Some("https://textures.minecraftcapes.net/ears/0ed6ea78"));
}

#[test]
fn parses_empty_and_minimal_profiles() {
    let empty = br#"{"animatedCape":false,"capeGlint":false,"upsideDown":false,"cape_url":null,"ear_url":null,"textures":{"cape":null,"ears":null}}"#;
    assert_eq!(parse_profile(empty).unwrap(), RawProfile::default());
    // Ältere Antworten ohne die URL-Felder
    let old = br#"{"animatedCape":false,"capeGlint":false,"upsideDown":true,"textures":{}}"#;
    let p = parse_profile(old).unwrap();
    assert!(p.upside_down);
    assert!(p.cape_url.is_none() && p.ear_url.is_none());
    assert!(parse_profile(b"<html>").is_err());
}

#[test]
fn identifier_like_the_mod() {
    assert_eq!(identifier("ba4161c0-3a42-496c-8ae0-7d13372f3371", "james090500").as_deref(), Some("ba4161c03a42496c8ae07d13372f3371"));
    assert_eq!(identifier("BA4161C03A42496C8AE07D13372F3371", "x").as_deref(), Some("ba4161c03a42496c8ae07d13372f3371"));
    // Keine v4-UUID (z. B. Offline-UUID v3) -> Name
    assert_eq!(identifier("ba4161c0-3a42-396c-8ae0-7d13372f3371", "Steve").as_deref(), Some("Steve"));
    assert_eq!(identifier("", "bad name"), None);
    assert_eq!(identifier("", "../x"), None);
}

#[test]
fn cache_path_by_hash() {
    let root = Path::new("cache");
    assert_eq!(cache_path(root, "capes", "https://textures.minecraftcapes.net/capes/6c95d3"), Some(root.join("capes").join("6c").join("6c95d3")));
    assert_eq!(cache_path(root, "ears", "https://x.minecraftcapes.net/ears/ab"), Some(root.join("ears").join("xx").join("ab")));
    assert_eq!(cache_path(root, "capes", "https://x/capes/.."), None);
    assert_eq!(cache_path(root, "capes", "https://x/capes/"), None);
}

#[test]
fn only_minecraftcapes_texture_urls() {
    assert!(texture_url_ok("https://textures.minecraftcapes.net/capes/abc"));
    assert!(!texture_url_ok("http://textures.minecraftcapes.net/capes/abc"));
    assert!(!texture_url_ok("https://evil.example/capes/abc"));
    assert!(!texture_url_ok("https://minecraftcapes.net.evil.example/x"));
}

#[test]
fn static_cape_layouts() {
    let l = cape_layout(64, 32).unwrap();
    assert_eq!((l.frames, l.canvas_width, l.canvas_height), (1, 64, 32));
    let hd = cape_layout(256, 128).unwrap();
    assert_eq!((hd.frames, hd.canvas_width, hd.canvas_height), (1, 256, 128));
    // Krumme Größen werden oben links in die nächste 64×32·2ⁿ-Fläche gesetzt
    let odd = cape_layout(100, 50).unwrap();
    assert_eq!((odd.frames, odd.frame_width, odd.frame_height, odd.canvas_width, odd.canvas_height), (1, 100, 50, 128, 64));
}

#[test]
fn animated_cape_frames() {
    // 64×32-Frames, 10 Stück übereinander
    let a = cape_layout(64, 320).unwrap();
    assert_eq!((a.frames, a.frame_width, a.frame_height, a.canvas_width, a.canvas_height, a.frame_ms), (10, 64, 32, 64, 32, 100));
    // Unvollständiger letzter Frame wird ignoriert (Ganzzahldivision wie in der Mod)
    assert_eq!(cape_layout(64, 330).unwrap().frames, 10);
    // Höhe ≠ Breite/2 gilt auch bei nur einem Frame als „animiert“ (Ausschnitt oben)
    let one = cape_layout(22, 17).unwrap();
    assert_eq!((one.frames, one.frame_width, one.frame_height), (1, 22, 11));
    // Zu niedrig für einen Frame -> unbrauchbar
    assert!(cape_layout(64, 20).is_none());
    assert!(cape_layout(1, 1).is_none());
    assert!(cape_layout(64, 0).is_none());
}
