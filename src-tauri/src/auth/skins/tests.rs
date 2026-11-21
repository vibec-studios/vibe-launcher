use super::*;

/// Minimales PNG mit IHDR für Tests (Inhalt danach ist egal).
pub fn fake_png(w: u32, h: u32) -> Vec<u8> {
    let mut b = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];
    b.extend_from_slice(b"IHDR");
    b.extend_from_slice(&w.to_be_bytes());
    b.extend_from_slice(&h.to_be_bytes());
    b.extend_from_slice(&[8, 6, 0, 0, 0, 1, 2, 3, 4]);
    b
}

#[test]
fn png_checks() {
    assert_eq!(png_dimensions(&fake_png(64, 64)), Some((64, 64)));
    assert!(validate_skin_png(&fake_png(64, 64)).is_ok());
    assert!(validate_skin_png(&fake_png(64, 32)).is_ok());
    assert!(matches!(validate_skin_png(&fake_png(128, 128)), Err(AppError::Invalid(m)) if m.contains("128×128")));
    assert!(matches!(validate_skin_png(b"GIF89a....................."), Err(AppError::Invalid(m)) if m.contains("PNG")));
    assert!(validate_skin_png(&vec![0u8; MAX_PNG + 1]).is_err());
}

#[test]
fn png_payload_decoding() {
    let png = fake_png(64, 64);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    assert_eq!(decode_png_payload(&format!("data:image/png;base64,{b64}")).unwrap(), png);
    assert_eq!(decode_png_payload(&b64).unwrap(), png);
    assert!(decode_png_payload("data:image/png,abc").is_err());
    assert!(decode_png_payload("!!!").is_err());
    let big = base64::engine::general_purpose::STANDARD.encode(fake_png(32, 32));
    assert!(matches!(decode_png_payload(&big), Err(AppError::Invalid(m)) if m.contains("32×32")));
}

#[test]
fn profile_parsing() {
    let json = br#"{"id":"abc","name":"Steve","skins":[
        {"id":"s0","state":"INACTIVE","url":"http://textures.minecraft.net/texture/old","variant":"CLASSIC"},
        {"id":"s1","state":"ACTIVE","url":"http://textures.minecraft.net/texture/new","variant":"SLIM","textureKey":"new"}],
        "capes":[{"id":"c1","state":"ACTIVE","url":"http://textures.minecraft.net/texture/cape","alias":"Migrator"}]}"#;
    let p: RawProfile = serde_json::from_slice(json).unwrap();
    let s = p.active_skin().unwrap();
    assert_eq!(s.id, "s1");
    assert_eq!(SkinVariant::from_api(s.variant.as_deref().unwrap()), SkinVariant::Slim);
    assert_eq!(p.capes[0].alias.as_deref(), Some("Migrator"));
    let empty: RawProfile = serde_json::from_slice(br#"{"id":"x","name":"y"}"#).unwrap();
    assert!(empty.active_skin().is_none());
}

#[test]
fn services_errors() {
    assert!(services_error(429, b"").to_string().contains("Zu viele Skin-Änderungen"));
    assert!(matches!(services_error(401, b""), AppError::Auth(_)));
    assert!(matches!(services_error(400, br#"{"errorMessage":"Could not validate image data"}"#), AppError::Invalid(m) if m.contains("validate")));
    assert!(matches!(services_error(503, b"<html>"), AppError::Msg(_)));
}

#[test]
fn textures_property() {
    let raw = br#"{"timestamp":1,"profileId":"x","profileName":"Alex","textures":{"SKIN":{"url":"http://textures.minecraft.net/texture/abc","metadata":{"model":"slim"}}}}"#;
    let b64 = base64::engine::general_purpose::STANDARD.encode(raw);
    assert_eq!(parse_textures_property(&b64), Some(("http://textures.minecraft.net/texture/abc".into(), SkinVariant::Slim)));
    let classic = base64::engine::general_purpose::STANDARD.encode(br#"{"textures":{"SKIN":{"url":"u"}}}"#);
    assert_eq!(parse_textures_property(&classic), Some(("u".into(), SkinVariant::Classic)));
    let none = base64::engine::general_purpose::STANDARD.encode(br#"{"textures":{}}"#);
    assert_eq!(parse_textures_property(&none), None);
}

#[test]
fn player_names() {
    assert!(valid_player_name("Notch"));
    assert!(valid_player_name("jeb_"));
    assert!(!valid_player_name(""));
    assert!(!valid_player_name("a b"));
    assert!(!valid_player_name("abcdefghijklmnopq"));
}

#[test]
fn library_crud() {
    let root = std::env::temp_dir().join(format!("vl-skins-test-{}", uuid::Uuid::new_v4().simple()));
    let lib = Library::load(&root);
    let a = lib.add(&fake_png(64, 64), "  Mein Skin  ", SkinVariant::Slim, Some("file".into())).unwrap();
    assert_eq!(a.name, "Mein Skin");
    assert!(a.data_url.starts_with("data:image/png;base64,"));
    // Duplikat -> gleicher Eintrag
    assert_eq!(lib.add(&fake_png(64, 64), "Nochmal", SkinVariant::Classic, None).unwrap().id, a.id);
    let b = lib.add(&fake_png(64, 32), "", SkinVariant::Classic, None).unwrap();
    assert_eq!(b.name, "Skin");
    assert!(lib.add(&fake_png(32, 32), "x", SkinVariant::Classic, None).is_err());
    assert_eq!(lib.list().len(), 2);
    let r = lib.modify(&a.id, |e| {
        e.name = "Umbenannt".into();
        e.variant = SkinVariant::Classic;
    });
    assert_eq!(r.unwrap().name, "Umbenannt");
    // Neu laden -> persistiert
    let lib2 = Library::load(&root);
    let got = lib2.get(&a.id).unwrap();
    assert_eq!((got.name.as_str(), got.variant), ("Umbenannt", SkinVariant::Classic));
    lib2.remove(&a.id).unwrap();
    assert!(lib2.get(&a.id).is_err());
    assert!(!root.join("skins").join(&a.file).exists());
    assert_eq!(Library::load(&root).list().len(), 1);
    let _ = std::fs::remove_dir_all(&root);
}
