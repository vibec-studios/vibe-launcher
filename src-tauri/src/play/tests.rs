use super::*;
use crate::content::index::IndexEntry;
use crate::instance::{Loader, LoaderKind, PackSource};

fn inst(mc: &str, kind: LoaderKind, ver: Option<&str>, source: Option<PackSource>) -> Instance {
    let mut i: Instance = serde_json::from_value(serde_json::json!({
        "id": "a", "name": "Cobblemon Abenteuer", "mc_version": mc,
        "loader": { "kind": "fabric", "version": null }, "created_at": 0
    }))
    .unwrap();
    i.loader = Loader { kind, version: ver.map(str::to_string) };
    i.source = source;
    i
}

fn entry(source: Source, pid: &str, vid: &str) -> IndexEntry {
    serde_json::from_value(serde_json::json!({ "source": source.as_string(), "project_id": pid, "version_id": vid })).unwrap()
}

fn mrpack() -> PackSource {
    PackSource { kind: PackSourceKind::Modrinth, project_id: Some("abc".into()), version_id: Some("def".into()), name: Some("Cobblemon Official".into()), version_name: None }
}

fn link(pack: bool) -> PlayLink {
    serde_json::from_value(serde_json::json!({
        "code": "k3x9q2", "url": "https://axolite.cc/j/k3x9q2",
        "host": { "uuid": "u", "name": "Henny" }, "relay_host": "mossy-otter-27.axolite.cc",
        "mc_version": "1.21.1", "loader": { "kind": "fabric", "version": "0.16.9" },
        "pack": if pack { serde_json::json!({ "source": "modrinth", "project_id": "abc", "version_id": "def", "title": "Cobblemon Official" }) } else { serde_json::Value::Null },
        "mods": [ { "source": "modrinth", "project_id": "AANobbMI", "version_id": "xyz", "kind": "mod" } ],
        "client_pack": "vibey", "world_name": "Neue Welt", "max_players": 8, "active": true, "expires_at": "2026-11-19T12:00:00Z"
    }))
    .unwrap()
}

#[test]
fn vibe_pack_matching() {
    let mut l = link(false);
    l.vibe_pack = Some(serde_json::from_value(serde_json::json!({ "code": "AB12CD34", "version_id": "v2", "version": "1.4.0", "name": "Insel" })).unwrap());
    let vibe = |vid: &str| inst("1.21.1", LoaderKind::Fabric, None, Some(PackSource { kind: PackSourceKind::Vibe, project_id: Some("ab12cd34".into()), version_id: Some(vid.into()), name: None, version_name: None }));
    let idx = ContentIndex::default();
    assert_eq!(match_score(&l, &vibe("v2"), &idx), Some(1));
    assert_eq!(match_score(&l, &vibe("v1"), &idx), None);
    assert_eq!(vibe_pack_match(l.vibe_pack.as_ref().unwrap(), &vibe("v1")), Some(VibeMatch::OtherVersion));
    assert_eq!(match_score(&l, &inst("1.21.1", LoaderKind::Fabric, Some("0.16.9"), None), &idx), None);
    let f = build_instance_file(&vibe("v2"), &idx, None);
    assert_eq!(f.vibe_pack, Some(LinkVibePackRef { code: "ab12cd34".into(), version_id: Some("v2".into()) }));
    assert_eq!(vibe_pack_of(&inst("1.21.1", LoaderKind::Fabric, None, None), Some("XY12".into())).unwrap().code, "XY12");
}

#[test]
fn instance_file_contract() {
    let i = inst("1.21.1", LoaderKind::Fabric, Some("0.16.9"), Some(mrpack()));
    let mut idx = ContentIndex::default();
    idx.files.insert("mods/sodium.jar".into(), entry(Source::Modrinth, "AANobbMI", "xyz"));
    idx.files.insert("resourcepacks/fa.zip".into(), entry(Source::Curseforge, "123", "456"));
    idx.files.insert("mods/store.jar".into(), entry(Source::store("x"), "s", "v"));
    let f = build_instance_file(&i, &idx, Some("essential".into()));
    let v = serde_json::to_value(&f).unwrap();
    assert_eq!(
        v,
        serde_json::json!({
            "schema": 1, "name": "Cobblemon Abenteuer", "mc_version": "1.21.1",
            "loader": { "kind": "fabric", "version": "0.16.9" },
            "pack": { "source": "modrinth", "project_id": "abc", "version_id": "def", "title": "Cobblemon Official" },
            "mods": [
                { "source": "curseforge", "project_id": "123", "version_id": "456", "kind": "resourcepack" },
                { "source": "modrinth", "project_id": "AANobbMI", "version_id": "xyz", "kind": "mod" }
            ],
            "client_pack": "essential"
        })
    );
    // ohne Modpack: pack = null
    let i = inst("1.21.1", LoaderKind::Fabric, None, Some(PackSource { kind: PackSourceKind::Vibe, ..mrpack() }));
    assert!(build_instance_file(&i, &idx, None).pack.is_none());
}

#[test]
fn session_parse() {
    let now = 1_795_040_030;
    let ok = br#"{ "schema": 1, "state": "hosting", "world": "Neue Welt", "play_link": "https://axolite.cc/j/k3x9q2", "players": 3, "max_players": 8, "updated_at": 1795040000 }"#;
    let s = parse_session(ok, now).unwrap();
    assert_eq!(s.state, "hosting");
    assert_eq!(s.players, Some(3));
    // veraltet
    assert!(parse_session(ok, now + 61).is_none());
    // unbekannter Zustand / Schema
    assert!(parse_session(br#"{ "schema": 1, "state": "afk", "updated_at": 1795040000 }"#, now).is_none());
    assert!(parse_session(br#"{ "schema": 2, "state": "menu", "updated_at": 1795040000 }"#, now).is_none());
    assert!(parse_session(b"kaputt", now).is_none());
    // Millisekunden
    assert!(parse_session(br#"{ "schema": 1, "state": "menu", "updated_at": 1795040000000 }"#, now).is_some());
}

#[test]
fn link_urls_and_codes() {
    assert!(valid_code("k3x9q2"));
    assert!(valid_code("k3x9q2ab"));
    assert!(!valid_code("k3x9q"));
    assert!(!valid_code("k3x9q0"));
    assert!(!valid_code("K3X9Q2"));
    let base = "https://vibe.axolite.app";
    assert!(is_play_link_url(base, "https://axolite.cc/j/k3x9q2"));
    assert!(is_play_link_url(base, "https://vibe.axolite.app/j/k3x9q2"));
    // Alte Links (ältere Clients) gelten weiter
    assert!(is_play_link_url(base, "https://vibe.henny.dev/j/k3x9q2"));
    assert!(!is_play_link_url(base, "http://axolite.cc/j/k3x9q2"));
    assert!(!is_play_link_url(base, "http://vibe.henny.dev/j/k3x9q2"));
    assert!(!is_play_link_url(base, "https://evil.example/j/k3x9q2"));
    assert!(!is_play_link_url(base, "https://axolite.cc/p/k3x9q2"));
    assert!(!is_play_link_url(base, "https://axolite.cc/j/k3x9q2?x=1"));
    assert!(!is_play_link_url(base, "https://vibe.henny.dev/j/k3x9q2?x=1"));
    assert!(is_play_link_url("http://127.0.0.1:3000", "http://127.0.0.1:3000/j/k3x9q2"));
    // Lokales Test-Backend: keine Links des echten Backends
    assert!(!is_play_link_url("http://127.0.0.1:3000", "https://axolite.cc/j/k3x9q2"));
}

#[test]
fn matching() {
    let l = link(true);
    let mut idx = ContentIndex::default();
    let pack_inst = inst("1.21.1", LoaderKind::Fabric, Some("0.16.8"), Some(mrpack()));
    // Modpack passt, ein Zusatz-Mod fehlt noch
    assert_eq!(match_score(&l, &pack_inst, &idx), Some(1));
    idx.files.insert("mods/sodium.jar".into(), entry(Source::Modrinth, "AANobbMI", "old"));
    assert_eq!(match_score(&l, &pack_inst, &idx), Some(0));
    // andere Pack-Version → keine Übereinstimmung
    let other = inst("1.21.1", LoaderKind::Fabric, None, Some(PackSource { version_id: Some("zzz".into()), ..mrpack() }));
    assert_eq!(match_score(&l, &other, &idx), None);
    // ohne Modpack: Version + Loader + alle Mods
    let l = link(false);
    let plain = inst("1.21.1", LoaderKind::Fabric, Some("0.16.9"), None);
    assert_eq!(match_score(&l, &plain, &idx), Some(0));
    assert_eq!(match_score(&l, &plain, &ContentIndex::default()), None);
    assert_eq!(match_score(&l, &inst("1.21.1", LoaderKind::Fabric, Some("0.15.0"), None), &idx), None);
    assert_eq!(match_score(&l, &inst("1.21.1", LoaderKind::Quilt, Some("0.16.9"), None), &idx), None);
    assert_eq!(match_score(&l, &inst("1.20.1", LoaderKind::Fabric, Some("0.16.9"), None), &idx), None);
}
