#[test]
fn free_names() {
    let taken = |list: &'static [&'static str]| move |n: &str| list.iter().any(|x| x.eq_ignore_ascii_case(n));
    assert_eq!(super::free_name("Vibey Client", taken(&[])), "Vibey Client");
    assert_eq!(super::free_name("Vibey Client", taken(&["vibey client"])), "Vibey Client (2)");
    assert_eq!(super::free_name("Vibey Client", taken(&["Vibey Client", "Vibey Client (2)"])), "Vibey Client (3)");
    // Lücken werden gefüllt
    assert_eq!(super::free_name("Vibey Client", taken(&["Vibey Client", "Vibey Client (3)"])), "Vibey Client (2)");
}

#[test]
fn patch_null_clears() {
    let p: super::InstancePatch = serde_json::from_str(r#"{"accent":null,"auto_update_content":true}"#).unwrap();
    assert_eq!(p.accent, Some(None));
    assert_eq!(p.auto_update_content, Some(Some(true)));
    assert_eq!(p.group, None);
    let b: super::InstancePatch = serde_json::from_str(r#"{"icon":"block:grass@sky"}"#).unwrap();
    assert_eq!(b.icon, Some(Some("block:grass@sky".into())));
    assert!(super::icon::check(b.icon.as_ref().and_then(|v| v.as_deref())).is_ok());
}

/// Instanzdateien älterer Versionen (ohne `bedrock`) bleiben Java-Instanzen; neue Felder überstehen die Rundreise.
#[test]
fn serde_old_files_and_bedrock() {
    let old = r#"{"id":"x","name":"Alt","icon":null,"accent":null,"group":null,"mc_version":"1.20.1",
        "loader":{"kind":"fabric","version":"0.15.0"},"created_at":1}"#;
    let i: super::Instance = serde_json::from_str(old).unwrap();
    assert!(!i.is_bedrock());
    assert_eq!(i.bedrock, None);
    assert_eq!(i.install_state, super::InstallState::NotInstalled);

    let mut b = i.clone();
    b.bedrock = Some(super::BedrockOptions { channel: super::BedrockChannel::Preview, profile: super::BedrockProfile::Shared });
    let json = serde_json::to_string(&b).unwrap();
    assert!(json.contains(r#""bedrock":{"channel":"preview","profile":"shared"}"#));
    let back: super::Instance = serde_json::from_str(&json).unwrap();
    assert!(back.is_bedrock());
    assert_eq!(back.bedrock, b.bedrock);

    // Teilweise Angaben -> Standardwerte (Release, eigenes Profil)
    let partial = old.replace(r#""created_at":1"#, r#""created_at":1,"bedrock":{}"#);
    let p: super::Instance = serde_json::from_str(&partial).unwrap();
    assert_eq!(p.bedrock, Some(super::BedrockOptions::default()));
    assert_eq!(p.bedrock.unwrap().profile, super::BedrockProfile::Isolated);
    // Patch mit Bedrock-Optionen
    let patch: super::InstancePatch = serde_json::from_str(r#"{"bedrock":{"channel":"preview"}}"#).unwrap();
    assert_eq!(patch.bedrock.unwrap().channel, super::BedrockChannel::Preview);
}

#[test]
fn slug() {
    assert_eq!(super::slugify("Mein Tolles Pack!"), "mein-tolles-pack");
    assert_eq!(super::slugify("Größe 1.21"), "groesse-1.21");
    assert_eq!(super::slugify("///"), "instance");
}
