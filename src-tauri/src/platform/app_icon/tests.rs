use super::*;

#[test]
fn renders_all_sizes() {
    for m in ["seal", "penguin", "custom"] {
        let spec = IconSpec::new(m, "#22aa66", None);
        for s in [16, 32, 256] {
            let img = render(&spec, s);
            assert_eq!(img.dimensions(), (s, s));
            // Mitte ist deckend, Ecke (gerundet) transparent
            assert_eq!(img.get_pixel(s / 2, s / 2)[3], 255);
        }
        assert_eq!(render(&spec, 256).get_pixel(0, 0)[3], 0);
    }
    // Kachelfarbe kommt an
    let p = *render(&IconSpec::new("seal", "#22aa66", None), 64).get_pixel(4, 20);
    assert_eq!((p[0], p[1], p[2]), (0x22, 0xaa, 0x66));
    assert!(ico_bytes(&IconSpec::new("penguin", "#000000", None)).unwrap().len() > 1000);
}

#[test]
fn spec_sanitizes() {
    let s = IconSpec::new("quatsch", "rot", Some(""));
    assert_eq!(s.motif, "seal");
    assert_eq!(s.color, [0x8b, 0x6c, 0xff]);
    assert!(s.image.is_none());
    assert!(s.is_default());
    assert!(!IconSpec::new("penguin", DEFAULT_COLOR, None).is_default());
}

#[test]
#[ignore]
fn export_discord_assets() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs/discord-assets");
    for m in ["seal", "penguin"] {
        render(&IconSpec::new(m, DEFAULT_COLOR, None), 1024).save(dir.join(format!("{m}.png"))).unwrap();
    }
}

#[test]
fn custom_image() {
    let dir = std::env::temp_dir().join(format!("vl-appicon-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let src = dir.join("me.png");
    RgbaImage::from_pixel(8, 8, Rgba([200, 10, 10, 255])).save(&src).unwrap();
    let stored = import_image(&dir, &src, "custom").unwrap();
    let other = import_image(&dir, &src, "discord").unwrap();
    assert!(stored.exists() && other.exists());
    let spec = IconSpec::new("custom", DEFAULT_COLOR, stored.to_str());
    let p = *render(&spec, 64).get_pixel(32, 32);
    assert_eq!((p[0], p[1], p[2]), (200, 10, 10));
    assert!(import_image(&dir, &dir.join("nope.txt"), "custom").is_err());
    let _ = std::fs::remove_dir_all(&dir);
}
