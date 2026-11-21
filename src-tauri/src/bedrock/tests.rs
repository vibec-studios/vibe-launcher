use super::*;

#[test]
fn slots_and_layout_choice() {
    let tmp = tempdir("layout");
    let gdk = tmp.join("Minecraft Bedrock");
    let uwp = tmp.join("uwp");
    // Nichts vorhanden -> GDK (aktuelle Versionen)
    assert_eq!(choose(BedrockChannel::Release, gdk.clone(), uwp.clone()).layout, Layout::Gdk);
    std::fs::create_dir_all(uwp.join("games/com.mojang")).unwrap();
    assert_eq!(choose(BedrockChannel::Release, gdk.clone(), uwp.clone()).layout, Layout::Uwp);
    std::fs::create_dir_all(gdk.join("Users/Shared/games/com.mojang")).unwrap();
    std::fs::create_dir_all(gdk.join("Users/123456/games/com.mojang")).unwrap();
    std::fs::create_dir_all(gdk.join("Users/nur-ordner")).unwrap();
    std::fs::create_dir_all(gdk.join("Users/.versteckt/games/com.mojang")).unwrap();
    let t = choose(BedrockChannel::Release, gdk.clone(), uwp);
    assert_eq!(t.layout, Layout::Gdk);
    assert_eq!(Layout::Gdk.slots(&gdk), vec!["Users/123456/games/com.mojang", "Users/Shared/games/com.mojang"]);
    assert_eq!(Layout::Gdk.world_slots(&gdk), vec!["Users/123456/games/com.mojang"]);
    assert_eq!(t.packs_dir(), gdk.join("Users").join("Shared").join("games").join("com.mojang"));
    let _ = std::fs::remove_dir_all(&tmp);
}
