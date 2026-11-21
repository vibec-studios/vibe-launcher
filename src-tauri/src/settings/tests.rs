use super::*;

#[test]
fn old_settings_are_expert_without_onboarding() {
    let s: Settings = serde_json::from_str(r#"{"language":"de"}"#).unwrap();
    assert_eq!(s.ui_mode, "expert");
    assert!(s.onboarding_done);
    assert!(!s.simple_hint_seen);
    assert!(!s.simple_tour_done);
}

#[test]
fn fresh_settings_need_onboarding() {
    let s = Settings::default();
    assert!(!s.onboarding_done);
    let back: Settings = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
    assert!(!back.onboarding_done, "gespeichertes false bleibt false");
}

#[test]
fn existing_data_skips_onboarding() {
    let dir = std::env::temp_dir().join(format!("vl-onb-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let paths = crate::paths::Paths { root: dir.clone() };
    assert!(!Settings::load_for(&paths).onboarding_done, "leerer Ordner = neuer Nutzer");
    std::fs::create_dir_all(paths.instance_dir("a")).unwrap();
    std::fs::write(paths.instance_json("a"), "{}").unwrap();
    assert!(Settings::load_for(&paths).onboarding_done, "Instanz vorhanden = bestehender Nutzer");
    let s = Settings { ui_mode: "simple".into(), ..Default::default() };
    s.save(&paths.settings_file()).unwrap();
    let loaded = Settings::load_for(&paths);
    assert_eq!(loaded.ui_mode, "simple");
    assert!(!loaded.onboarding_done, "gespeicherte Einstellungen gewinnen");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn dismissed_notices() {
    let old: Settings = serde_json::from_str(r#"{"language":"de"}"#).unwrap();
    assert!(old.dismissed_notices.is_empty(), "alte Einstellungen: nichts weggeklickt");
    let mut s: Settings =
        serde_json::from_str(r#"{"dismissed_notices":["domain-move-2026-11","domain-move-2026-11"," x ","böse id","","vibey-eol:mein-pack-2","a:b:c",":x","x:"]}"#).unwrap();
    s.sanitize_notices();
    assert_eq!(s.dismissed_notices, vec!["domain-move-2026-11".to_string(), "x".to_string(), "vibey-eol:mein-pack-2".to_string()]);
    s.dismissed_notices = (0..250).map(|i| format!("n{i}")).collect();
    s.sanitize_notices();
    assert_eq!(s.dismissed_notices.len(), 200);
    assert_eq!(s.dismissed_notices[0], "n50");
}

#[test]
fn saved_legacy_store_url_is_migrated_on_load() {
    let dir = std::env::temp_dir().join(format!("vl-store-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let paths = crate::paths::Paths { root: dir.clone() };
    std::fs::write(
        paths.settings_file(),
        r#"{"onboarding_done":true,"stores":[
          {"id":"vibe-craft-studios","name":"Vibe Craft Studios","url":"https://vibec-studios.github.io/data/store.json","enabled":false},
          {"id":"mein-store","name":"Mein Store","url":"https://example.org/store.json","enabled":true}]}"#,
    )
    .unwrap();
    let s = Settings::load_for(&paths);
    assert_eq!(s.stores[0].url, crate::domains::STORE_URL);
    assert!(!s.stores[0].enabled, "deaktiviert bleibt deaktiviert");
    assert_eq!(s.stores[1].url, "https://example.org/store.json", "eigene Stores bleiben");
    // neue Installation: gleich die neue Adresse
    assert_eq!(Settings::default().stores[0].url, crate::domains::STORE_URL);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn unknown_mode_falls_back_to_expert() {
    let mut s: Settings = serde_json::from_str(r#"{"ui_mode":"wizard"}"#).unwrap();
    s.sanitize_mode();
    assert_eq!(s.ui_mode, "expert");
}

#[test]
fn old_settings_get_default_appearance() {
    let s: Settings = serde_json::from_str(r#"{"language":"de","reduce_motion":true}"#).unwrap();
    assert_eq!(s.appearance, Appearance::default());
    assert!(s.reduce_motion);
}

#[test]
fn appearance_sanitize() {
    let mut a = Appearance {
        accent: "FF00AA".into(),
        tone: "sepia".into(),
        design: "v3".into(),
        radius: "round".into(),
        density: "dense".into(),
        ui_scale: 400,
        background: Background { kind: "video".into(), dim: 120, blur: 99, ..Background::default() },
        ..Appearance::default()
    };
    a.sanitize();
    assert_eq!(a.accent, "#ff00aa");
    assert_eq!(a.tone, "dark");
    assert_eq!(a.design, "v1");
    assert_eq!(a.radius, "round");
    assert_eq!(a.density, "normal");
    assert_eq!(a.ui_scale, 130);
    assert_eq!(a.background.kind, "none");
    assert_eq!(a.background.dim, 90);
    assert_eq!(a.background.blur, 40);

    let mut bad = Appearance { accent: "#12345z".into(), ..Appearance::default() };
    bad.sanitize();
    assert_eq!(bad.accent, "#8b6cff");
}

#[test]
fn appearance_customize_sanitize() {
    let mut a = Appearance {
        theme: "summer".into(),
        font_scale: 200,
        motion: "wild".into(),
        sidebar: Sidebar {
            mode: "huge".into(),
            instances: false,
            order: vec!["skins".into(), "bogus".into(), "home".into(), "skins".into()],
            hidden: vec!["home".into(), "servers".into(), "nope".into()],
            style: "floating".into(),
        },
        status: StatusColors { ok: "00FF00".into(), warn: "zzz".into(), danger: "#FF0000".into() },
        effects: Effects { snow_amount: 0, ..Effects::default() },
        ..Appearance::default()
    };
    a.sanitize();
    assert_eq!(a.theme, "standard");
    assert_eq!(a.font_scale, 115);
    assert_eq!(a.motion, "normal");
    assert_eq!(a.sidebar.mode, "compact");
    assert!(!a.sidebar.instances);
    assert_eq!(a.sidebar.style, "floating");
    // gewählte Reihenfolge zuerst, Rest angehängt, keine Doppelten
    assert_eq!(a.sidebar.order[0], "skins");
    assert_eq!(a.sidebar.order[1], "home");
    assert_eq!(a.sidebar.order.len(), NAV_KEYS.len());
    // „Start“ lässt sich nicht ausblenden
    assert_eq!(a.sidebar.hidden, vec!["servers".to_string()]);
    assert_eq!(a.status.ok, "#00ff00");
    assert_eq!(a.status.warn, "#ffb547");
    assert_eq!(a.status.danger, "#ff0000");
    assert_eq!(a.effects.snow_amount, 10);
}

#[test]
fn old_sidebar_with_cosmetics_still_loads() {
    let mut a: Appearance = serde_json::from_str(r#"{"sidebar":{"order":["cosmetics","skins","home"],"hidden":["cosmetics","servers"]}}"#).unwrap();
    a.sanitize();
    assert!(!a.sidebar.order.iter().any(|k| k == "cosmetics"));
    assert_eq!(a.sidebar.order[0], "skins");
    assert_eq!(a.sidebar.order.len(), NAV_KEYS.len());
    assert_eq!(a.sidebar.hidden, vec!["servers".to_string()]);
}

#[test]
fn appearance_partial_json_gets_new_defaults() {
    let a: Appearance = serde_json::from_str(r##"{"accent":"#5aa9ff","sidebar":{"mode":"wide"}}"##).unwrap();
    assert_eq!(a.accent, "#5aa9ff");
    assert_eq!(a.theme, "standard");
    assert_eq!(a.sidebar.mode, "wide");
    assert!(a.sidebar.instances);
    assert_eq!(a.sidebar.order.len(), NAV_KEYS.len());
    assert!(a.effects.snow);
}

#[test]
fn appearance_new_options_sanitize() {
    let mut a = Appearance {
        theme: "pixel".into(),
        radius: "custom".into(),
        radius_px: 99,
        font: "inter_tight".into(),
        headings: "pixel_all".into(),
        cards: "pixel".into(),
        glass: 250,
        sidebar: Sidebar { style: "neon".into(), ..Sidebar::default() },
        background: Background {
            kind: "color".into(),
            gradient: "custom".into(),
            color: "ABCDEF".into(),
            gradient_from: "nope".into(),
            gradient_angle: 999,
            ..Background::default()
        },
        ..Appearance::default()
    };
    a.sanitize();
    assert_eq!(a.theme, "pixel");
    assert_eq!(a.radius, "custom");
    assert_eq!(a.radius_px, 24);
    assert_eq!(a.font, "inter_tight");
    assert_eq!(a.headings, "pixel_all");
    assert_eq!(a.cards, "pixel");
    assert_eq!(a.glass, 100);
    assert_eq!(a.sidebar.style, "solid");
    assert_eq!(a.background.kind, "color");
    assert_eq!(a.background.gradient, "custom");
    assert_eq!(a.background.color, "#abcdef");
    assert_eq!(a.background.gradient_from, "#2b1655");
    assert_eq!(a.background.gradient_angle, 360);

    let mut b = Appearance { font: "comic".into(), cards: "glass".into(), headings: "fancy".into(), ..Appearance::default() };
    b.sanitize();
    assert_eq!(b.font, "inter");
    assert_eq!(b.cards, "flat");
    assert_eq!(b.headings, "default");
}

#[test]
fn appearance_old_json_gets_customize_defaults() {
    let a: Appearance = serde_json::from_str(r##"{"theme":"ocean","background":{"kind":"gradient","gradient":"dusk"},"sidebar":{"mode":"wide"}}"##).unwrap();
    assert_eq!(a.radius_px, 6);
    assert_eq!(a.glass, 0);
    assert_eq!(a.sidebar.style, "solid");
    assert_eq!(a.background.color, "#1a1030");
    assert_eq!(a.background.gradient_angle, 160);
    assert!(a.custom_themes.is_empty());
    assert_eq!(a.active_custom, None);
    let back: Appearance = serde_json::from_str(&serde_json::to_string(&a).unwrap()).unwrap();
    assert_eq!(back, a);
}

#[test]
fn custom_themes_sanitize() {
    use theme::{CustomTheme, ThemeValues, MAX_CUSTOM_THEMES};
    let good = CustomTheme {
        id: "t1".into(),
        name: "  Mein\u{7}Theme  ".into(),
        values: ThemeValues {
            theme: "summer".into(),
            accent: "FFB37D".into(),
            cards: "pixel".into(),
            glass: 500,
            sidebar_style: "tinted".into(),
            background: Background { kind: "animated".into(), animated: "custom".into(), video: Some("x.mp4".into()), ..Background::default() },
            ..ThemeValues::default()
        },
    };
    let mut a = Appearance {
        custom_themes: vec![
            good.clone(),
            CustomTheme { id: "t1".into(), name: "doppelt".into(), ..CustomTheme::default() },
            CustomTheme { id: "../böse".into(), name: "x".into(), ..CustomTheme::default() },
            CustomTheme { id: "t2".into(), name: "   ".into(), ..CustomTheme::default() },
        ],
        active_custom: Some("weg".into()),
        ..Appearance::default()
    };
    a.sanitize();
    assert_eq!(a.custom_themes.len(), 2);
    let t = &a.custom_themes[0];
    assert_eq!(t.name, "MeinTheme");
    assert_eq!(t.values.theme, "standard");
    assert_eq!(t.values.accent, "#ffb37d");
    assert_eq!(t.values.cards, "pixel");
    assert_eq!(t.values.glass, 100);
    assert_eq!(t.values.sidebar_style, "tinted");
    assert_eq!(t.values.background.animated, "aurora");
    assert_eq!(t.values.background.video, None);
    assert_eq!(a.custom_themes[1].name, "Theme");
    assert_eq!(a.active_custom, None);

    let mut many = Appearance {
        custom_themes: (0..40).map(|i| CustomTheme { id: format!("t{i}"), name: format!("T{i}"), ..CustomTheme::default() }).collect(),
        active_custom: Some("t3".into()),
        ..Appearance::default()
    };
    many.sanitize();
    assert_eq!(many.custom_themes.len(), MAX_CUSTOM_THEMES);
    assert_eq!(many.active_custom.as_deref(), Some("t3"));
}

#[test]
fn custom_theme_partial_json() {
    let a: Appearance = serde_json::from_str(r##"{"custom_themes":[{"id":"a1","name":"Alt","values":{"accent":"#123456"}}],"active_custom":"a1"}"##).unwrap();
    assert_eq!(a.custom_themes[0].values.accent, "#123456");
    assert_eq!(a.custom_themes[0].values.tone, "dark");
    assert_eq!(a.custom_themes[0].values.background.kind, "none");
    assert_eq!(a.active_custom.as_deref(), Some("a1"));
}
