use super::*;
#[test]
fn accept_rules() {
    assert!(accepts(ContentKind::Mod, "a.jar", false));
    assert!(accepts(ContentKind::Mod, "a.jar.disabled", false));
    assert!(!accepts(ContentKind::Mod, "a.jar.part", false));
    assert!(!accepts(ContentKind::Mod, "notes.txt", false));
    assert!(!accepts(ContentKind::Mod, "folder", true));
    assert!(accepts(ContentKind::Resourcepack, "Pack", true));
    assert!(accepts(ContentKind::Shader, "BSL.zip", false));
    assert!(!accepts(ContentKind::Shader, "BSL.zip.txt", false));
    assert_eq!(display_stem("sodium-0.5.jar.disabled"), "sodium-0.5");
}
