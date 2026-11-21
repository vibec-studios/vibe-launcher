#[test]
fn slugs() {
    assert_eq!(super::slug("Mein Server!"), "mein-server");
    assert_eq!(super::slug("Größe"), "groesse");
    assert_eq!(super::slug("///"), "server");
}

#[test]
fn relay_is_fixed() {
    assert_eq!(super::relay_address(None), super::DEFAULT_RELAY);
    assert_eq!(super::DEFAULT_RELAY, "relay.axolite.cc:25565");
    assert_eq!(super::relay_address(Some("vibey.henny.dev:25565".into())), super::DEFAULT_RELAY);
    assert_eq!(super::relay_address(Some("127.0.0.1:25599".into())), "127.0.0.1:25599");
    // Alte Server-Dateien mit eigener Relay-Adresse laden weiter, die Adresse wird verworfen
    let json = r#"{"id":"a","name":"A","mc_version":"1.21.1","loader":{"kind":"vanilla","version":null},"port":25565,
        "relay_address":"evil.example:25565","created_at":0}"#;
    let s: super::Server = serde_json::from_str(json).expect("alte Server-Datei");
    assert_eq!(s.relay(), super::relay_address(crate::util::debug_override("VIBE_RELAY")));
    assert!(!serde_json::to_string(&s).unwrap().contains("evil.example"));
}
