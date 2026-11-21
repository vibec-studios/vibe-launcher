use super::*;

#[test]
fn names() {
    let mut l: PlayLink = serde_json::from_value(serde_json::json!({
        "code": "k3x9q2", "url": "u", "host": { "uuid": "u", "name": "Henny" }, "relay_host": "a.axolite.cc",
        "mc_version": "1.21.1", "loader": { "kind": "fabric" }, "world_name": "Neue Welt", "expires_at": "x"
    }))
    .unwrap();
    assert_eq!(new_instance_name(&l), "Neue Welt (Henny)");
    l.world_name = None;
    assert_eq!(new_instance_name(&l), "Welt von Henny");
    l.pack = Some(LinkPack { source: "modrinth".into(), project_id: "a".into(), version_id: "b".into(), title: Some("Cobblemon".into()) });
    assert_eq!(new_instance_name(&l), "Cobblemon");
    assert!(loader_kind("neoforge").is_ok());
    assert!(loader_kind("rift").is_err());
}
