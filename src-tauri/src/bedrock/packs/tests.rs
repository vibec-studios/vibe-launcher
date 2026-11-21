use super::super::manifest::tests::{manifest, zip_of};
use super::*;

#[test]
fn install_list_update_remove_export() {
    let tmp = super::super::tempdir("packs");
    let packs = tmp.join("Users/Shared/games/com.mojang");
    let worlds = tmp.join("Users/1/games/com.mojang/minecraftWorlds");
    let addon = zip_of(&[
        ("RP/manifest.json", &manifest("Glanz", "r-1", "resources")),
        ("RP/pack_icon.png", &tiny_png()),
        ("BP/manifest.json", &manifest("Mobs", "b-1", "data")),
        ("BP/entities/x.json", b"{}"),
    ]);
    let entries = manifest::read_zip(&addon).unwrap();
    let src = PackSource { project_id: "123".into(), file_id: "9".into(), title: Some("Addon".into()) };
    let r = import_entries(&packs, Some(&worlds), &entries, Some(&src)).unwrap();
    assert_eq!(r.packs.len(), 2);
    assert!(r.updated.is_empty());
    let l = list(&packs, true);
    assert_eq!(l.len(), 2);
    let rp = l.iter().find(|p| p.kind == PackKind::Resource).unwrap();
    assert_eq!(rp.id, "resource_packs/Glanz");
    assert!(rp.icon.as_deref().is_some_and(|i| i.starts_with("data:image/png;base64,")));
    assert_eq!(rp.source.as_ref(), Some(&src));
    // Gleiche UUID erneut -> Update im selben Ordner
    let r2 = import_entries(&packs, Some(&worlds), &entries, None).unwrap();
    assert_eq!(r2.updated.len(), 2);
    assert_eq!(list(&packs, false).len(), 2);
    assert!(list(&packs, false).iter().all(|p| p.source.is_none()));
    // Anderes Pack mit gleichem Namen -> eigener Ordner
    let other = zip_of(&[("manifest.json", &manifest("Glanz", "r-2", "resources"))]);
    import_entries(&packs, None, &manifest::read_zip(&other).unwrap(), None).unwrap();
    assert!(packs.join("resource_packs/Glanz (2)/manifest.json").is_file());
    // Export als .mcpack und wieder einlesbar
    let dir = resolve(&packs, "resource_packs/Glanz").unwrap();
    let out = tmp.join("export.mcpack");
    zip_dir(&dir, &out).unwrap();
    let back = manifest::analyze(&manifest::read_zip(&std::fs::read(&out).unwrap()).unwrap()).unwrap();
    assert!(matches!(&back[..], [Found::Pack { manifest, root, .. }] if manifest.uuid == "r-1" && root.is_empty()));
    // Ungültige IDs
    assert!(resolve(&packs, "../x").is_err());
    assert!(resolve(&packs, "resource_packs/..").is_err());
    assert!(resolve(&packs, "mods/x").is_err());
    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn world_import_needs_player_folder_and_world_packs() {
    let tmp = super::super::tempdir("wpacks");
    let packs = tmp.join("p");
    let worlds = tmp.join("w");
    let mcworld = zip_of(&[("level.dat", b"x"), ("levelname.txt", b"Insel"), ("db/CURRENT", b"1")]);
    let e = manifest::read_zip(&mcworld).unwrap();
    assert!(import_entries(&packs, None, &e, None).is_err());
    let r = import_entries(&packs, Some(&worlds), &e, None).unwrap();
    assert_eq!(r.worlds.len(), 1);
    let w = worlds.join(&r.worlds[0]);
    assert_eq!(std::fs::read_to_string(w.join("levelname.txt")).unwrap(), "Insel");
    // Packs je Welt: an, Reihenfolge, fremde Felder bleiben, aus
    std::fs::write(w.join("world_resource_packs.json"), r#"[{"pack_id":"ALT","version":[1,0,0],"subpack":"hd"},]"#).unwrap();
    set_world_pack(&w, PackKind::Resource, "neu", &[2, 0, 0], true).unwrap();
    let l = read_world_packs(&w, PackKind::Resource);
    assert_eq!(l.iter().map(|x| x.pack_id.as_str()).collect::<Vec<_>>(), vec!["neu", "alt"]);
    assert!(std::fs::read_to_string(w.join("world_resource_packs.json")).unwrap().contains("subpack"));
    set_world_pack(&w, PackKind::Resource, "NEU", &[2, 0, 0], false).unwrap();
    assert_eq!(read_world_packs(&w, PackKind::Resource).len(), 1);
    assert!(set_world_pack(&w, PackKind::Skin, "x", &[1], true).is_err());
    assert!(set_world_pack(&tmp.join("gibtsnicht"), PackKind::Behavior, "x", &[1], true).is_err());
    let _ = std::fs::remove_dir_all(&tmp);
}

fn tiny_png() -> Vec<u8> {
    let img = image::RgbaImage::from_pixel(4, 4, image::Rgba([10, 200, 90, 255]));
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img).write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}
