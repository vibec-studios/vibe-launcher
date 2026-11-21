use super::*;
use std::path::PathBuf;

fn tmp(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("vl-skinbridge-{tag}-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn png(dir: &Path, name: &str, seed: u8) -> (PathBuf, String) {
    let p = dir.join(name);
    let b = vec![seed; 100];
    std::fs::write(&p, &b).unwrap();
    (p, hex::encode(Sha1::digest(&b)))
}

#[test]
fn writes_bridge_and_prunes() {
    let lib = tmp("lib");
    let vibe = tmp("vibe");
    let (p1, s1) = png(&lib, "a.png", 1);
    let (p2, s2) = png(&lib, "b.png", 2);
    let skins = vec![
        BridgeSkin { id: "ab12cd34ef56".into(), name: "Ritter".into(), variant: SkinVariant::Slim, path: p1, sha1: s1.clone(), added_at: 2, cape_id: Some("cape".into()) },
        BridgeSkin { id: "bad/id".into(), name: "x".into(), variant: SkinVariant::Classic, path: p2.clone(), sha1: s2.clone(), added_at: 1, cape_id: None },
    ];
    std::fs::create_dir_all(vibe.join("skins")).unwrap();
    std::fs::write(vibe.join("skins").join("old.png"), b"x").unwrap();
    let input = BridgeInput {
        account: Some(BridgeAccount { uuid: "1c2d3e4f-0000-4000-8000-00000000abcd".into(), name: "Alex".into(), kind: "microsoft".into() }),
        blocked: None,
        active_sha1: Some((s1.clone(), SkinVariant::Slim)),
    };
    write_skin_bridge(&vibe, &skins, &input, 1795040000).unwrap();
    let v: Value = serde_json::from_slice(&std::fs::read(vibe.join("skins.json")).unwrap()).unwrap();
    assert_eq!(v["schema"], 1);
    assert_eq!(v["can_change"], true);
    assert!(v.get("reason").is_none());
    assert_eq!(v["account"]["name"], "Alex");
    assert_eq!(v["active"]["library_id"], "ab12cd34ef56");
    assert_eq!(v["active"]["variant"], "slim");
    assert_eq!(v["skins"].as_array().unwrap().len(), 1);
    assert_eq!(v["skins"][0]["file"], "ab12cd34ef56.png");
    assert_eq!(v["skins"][0]["cape_id"], "cape");
    assert!(vibe.join("skins").join("ab12cd34ef56.png").is_file());
    assert!(!vibe.join("skins").join("old.png").exists());
    let blocked = BridgeInput { account: None, blocked: Some("no_account"), active_sha1: Some(("ff".into(), SkinVariant::Classic)) };
    write_skin_bridge(&vibe, &skins, &blocked, 1).unwrap();
    let v: Value = serde_json::from_slice(&std::fs::read(vibe.join("skins.json")).unwrap()).unwrap();
    assert_eq!(v["can_change"], false);
    assert_eq!(v["reason"], "no_account");
    assert!(v["active"].get("library_id").is_none());
    let _ = std::fs::remove_dir_all(lib);
    let _ = std::fs::remove_dir_all(vibe);
}

#[test]
fn requests() {
    let now = 1795040100;
    let ok = br#"{"schema":1,"id":"5b0c","action":"apply","skin_id":"ab12cd34ef56","variant":"slim","requested_at":1795040100}"#;
    assert_eq!(parse_request(ok, now), Taken::Request(SkinRequest { id: "5b0c".into(), skin_id: "ab12cd34ef56".into(), variant: Some(SkinVariant::Slim) }));
    let no_variant = br#"{"schema":1,"id":"5b0c","action":"apply","skin_id":"ab12","requested_at":1795040090}"#;
    assert!(matches!(parse_request(no_variant, now), Taken::Request(SkinRequest { variant: None, .. })));
    let old = br#"{"schema":1,"id":"5b0c","action":"apply","skin_id":"ab12","requested_at":1795040000}"#;
    assert_eq!(parse_request(old, now), Taken::Invalid(Some("5b0c".into())));
    let action = br#"{"schema":1,"id":"5b0c","action":"delete","skin_id":"ab12","requested_at":1795040100}"#;
    assert_eq!(parse_request(action, now), Taken::Invalid(Some("5b0c".into())));
    let path = br#"{"schema":1,"id":"5b0c","action":"apply","skin_id":"../x","requested_at":1795040100}"#;
    assert_eq!(parse_request(path, now), Taken::Invalid(Some("5b0c".into())));
    let schema = br#"{"schema":2,"id":"5b0c","action":"apply","skin_id":"ab12","requested_at":1795040100}"#;
    assert_eq!(parse_request(schema, now), Taken::Invalid(Some("5b0c".into())));
    assert_eq!(parse_request(b"{nope", now), Taken::Invalid(None));
}

#[test]
fn take_deletes_request_and_results() {
    let vibe = tmp("req");
    std::fs::write(vibe.join(REQUEST_FILE), br#"{"schema":1,"id":"r1","action":"apply","skin_id":"ab","requested_at":100}"#).unwrap();
    assert!(matches!(take_request(&vibe, 100), Some(Taken::Request(_))));
    assert!(!vibe.join(REQUEST_FILE).exists());
    assert_eq!(take_request(&vibe, 100), None);
    write_result(&vibe, "r1", &Outcome::Working, 5).unwrap();
    let v: Value = serde_json::from_slice(&std::fs::read(vibe.join(RESULT_FILE)).unwrap()).unwrap();
    assert_eq!(v["status"], "working");
    write_result(&vibe, "r1", &Outcome::Ok { skin_id: "ab".into(), variant: SkinVariant::Classic }, 6).unwrap();
    let v: Value = serde_json::from_slice(&std::fs::read(vibe.join(RESULT_FILE)).unwrap()).unwrap();
    assert_eq!((v["status"].as_str(), v["skin_id"].as_str(), v["variant"].as_str()), (Some("ok"), Some("ab"), Some("classic")));
    write_result(&vibe, "r1", &Outcome::Error { code: "rate_limited", message: Some("x".repeat(300)) }, 7).unwrap();
    let v: Value = serde_json::from_slice(&std::fs::read(vibe.join(RESULT_FILE)).unwrap()).unwrap();
    assert_eq!(v["error"], "rate_limited");
    assert_eq!(v["message"].as_str().unwrap().len(), 200);
    let _ = std::fs::remove_dir_all(vibe);
}

#[test]
fn error_codes() {
    use crate::auth::skins::services_error;
    assert_eq!(error_code(&services_error(401, b"")), "signed_out");
    assert_eq!(error_code(&services_error(429, b"")), "rate_limited");
    assert_eq!(error_code(&services_error(400, b"")), "mojang");
    assert_eq!(error_code(&services_error(403, b"")), "mojang");
    assert_eq!(error_code(&services_error(503, b"")), "mojang");
    assert_eq!(error_code(&AppError::NotFound("Skin".into())), "not_found");
    assert_eq!(error_code(&AppError::NotConfigured("x".into())), "no_account");
    assert_eq!(error_code(&AppError::Cancelled), "other");
}
