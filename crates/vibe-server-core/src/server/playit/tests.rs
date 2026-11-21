#[test]
fn address() {
    let run = serde_json::json!({ "tunnels": [
        { "display_address": "a.gl.joinmc.link", "tunnel_type": "minecraft-java", "agent_config": { "fields": [ { "name": "local_port", "value": "25570" } ] } },
        { "display_address": "b.gl.joinmc.link", "tunnel_type": "minecraft-java", "agent_config": { "fields": [ { "name": "local_port", "value": "25565" } ] } }
    ]});
    assert_eq!(super::pick_address(&run, 25565).as_deref(), Some("b.gl.joinmc.link"));
    assert_eq!(super::pick_address(&run, 1).as_deref(), Some("a.gl.joinmc.link"));
    assert_eq!(super::pick_address(&serde_json::json!({ "tunnels": [] }), 1), None);
}
