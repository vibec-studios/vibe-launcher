use super::*;

#[test]
fn yaml_patch_existing_and_missing() {
    let text = "# Geyser\nbedrock:\n  # Adresse\n  address: 0.0.0.0\n  port: 19132\n\nremote:\n  address: auto\n  port: 25565\n  auth-type: online\nlog: true\n";
    let out = yaml_set(text, "bedrock", &[("address", "127.0.0.1".into()), ("port", "19500".into()), ("clone-remote-port", "false".into())]);
    assert!(out.contains("  address: 127.0.0.1\n  port: 19500\n  clone-remote-port: false\n\nremote:"));
    assert!(out.contains("  # Adresse\n"));
    let out = yaml_set(&out, "remote", &[("address", "127.0.0.1".into()), ("auth-type", "floodgate".into())]);
    assert!(out.contains("remote:\n  address: 127.0.0.1\n  port: 25565\n  auth-type: floodgate\nlog: true"));
    let fresh = yaml_set("", "bedrock", &[("port", "1".into())]);
    assert_eq!(fresh, "bedrock:\n  port: 1\n");
}

#[test]
fn geyser_and_svc_files() {
    let d = std::env::temp_dir().join(format!("vl-extras-{}", uuid::Uuid::new_v4().simple()));
    let g = d.join("config.yml");
    write_geyser(&g, true, 19555, 25570, "Meine \"Welt\"").unwrap();
    let t = std::fs::read_to_string(&g).unwrap();
    assert!(t.contains("bedrock:\n  address: 127.0.0.1\n  port: 19555\n  clone-remote-port: false\n  motd1: \"Meine \\\"Welt\\\"\""));
    assert!(t.contains("remote:\n  address: 127.0.0.1\n  port: 25570\n  auth-type: floodgate"));
    std::fs::write(&g, "java:\n  address: auto\n  port: 25565\n").unwrap();
    write_geyser(&g, false, 1, 25565, "x").unwrap();
    let t = std::fs::read_to_string(&g).unwrap();
    assert!(t.contains("java:\n  address: 127.0.0.1") && !t.contains("remote:") && t.contains("  address: 0.0.0.0\n  port: 19132"));
    let p = d.join("voicechat").join("voicechat-server.properties");
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(&p, "# Simple Voice Chat\nport=24454\nmax_voice_distance=48.0\n").unwrap();
    write_svc(&p, true, 24460).unwrap();
    let t = std::fs::read_to_string(&p).unwrap();
    assert!(t.contains("port=24460") && t.contains("bind_address=127.0.0.1") && t.contains("voice_host=24454") && t.contains("max_voice_distance=48.0"));
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn free_port_skips_taken() {
    let p = free_udp_port(24454, &[24454]);
    assert_ne!(p, 24454);
}
