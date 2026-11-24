use super::super::{ensure_profile, import, pack_dir, resolve, version_id};
use super::*;
use crate::instance::{CustomLoaderRef, Instance, LoaderKind};
use crate::minecraft::meta::{self, Env as MetaEnv};

fn vanilla(paths: &Paths, mc: &str) {
    let v = json!({
        "id": mc,
        "mainClass": "net.minecraft.client.main.Main",
        "arguments": { "game": ["--username", "${auth_player_name}"], "jvm": ["-cp", "${classpath}"] },
        "libraries": [{ "name": "org.ow2.asm:asm:9.6", "downloads": { "artifact": { "path": "org/ow2/asm/asm/9.6/asm-9.6.jar", "url": "https://example.com/asm.jar", "size": 1 } } }]
    });
    let p = paths.version_json(mc);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, v.to_string()).unwrap();
}

fn r() -> CustomLoaderRef {
    CustomLoaderRef { id: "example".into(), version: "0.1.0".into() }
}

#[test]
fn profile_inherits_vanilla_and_copies_libraries() {
    let env = Env::new("cl-install");
    import(&env.paths, &env.pack(&manifest()), false).unwrap();
    vanilla(&env.paths, "26.3");
    let vid = ensure_profile(&env.paths, &r(), "26.3").unwrap();
    assert_eq!(vid, "vibe-example-0.1.0-26.3");
    assert_eq!(vid, version_id("example", "0.1.0", "26.3"));
    let jar = env.paths.libraries().join("com/example/example-loader/0.1.0/example-loader-0.1.0.jar");
    assert_eq!(std::fs::read(&jar).unwrap(), JAR);
    let merged = meta::merge(&meta::load_chain(&env.paths, &vid).unwrap(), &MetaEnv::current());
    assert_eq!((merged.id.as_str(), merged.base_id.as_str(), merged.main_class.as_str()), (vid.as_str(), "26.3", "com.example.loader.Main"));
    let names: Vec<&str> = merged.libraries.iter().map(|l| l.name.as_str()).collect();
    assert!(names.contains(&"com.example:example-loader:0.1.0") && names.contains(&"org.ow2.asm:asm:9.7") && !names.contains(&"org.ow2.asm:asm:9.6"), "{names:?}");
    let local = merged.libraries.iter().find(|l| l.name.starts_with("com.example")).unwrap().artifact(&env.paths.libraries()).unwrap();
    assert!(local.url.is_empty() && local.path == jar && local.sha1.as_deref() == Some(sha1(JAR).as_str()));
    let remote = merged.libraries.iter().find(|l| l.name == "org.ow2.asm:asm:9.7").unwrap().artifact(&env.paths.libraries()).unwrap();
    assert_eq!((remote.sha1.as_deref(), remote.size), (Some(ASM_SHA1), Some(123)));
    let jvm = meta::eval_args(&merged.jvm_args, &MetaEnv::current());
    assert!(jvm.contains(&"-Dexample.flag=true".to_string()), "{jvm:?}");
    std::fs::write(&jar, b"tampered").unwrap();
    ensure_profile(&env.paths, &r(), "26.3").unwrap();
    assert_eq!(std::fs::read(&jar).unwrap(), JAR);
}

#[test]
fn clear_errors_for_missing_pack_unsupported_version_and_tampering() {
    let env = Env::new("cl-install-err");
    let missing = ensure_profile(&env.paths, &r(), "26.3").unwrap_err().to_string();
    assert!(missing.contains("nicht installiert"), "{missing}");
    import(&env.paths, &env.pack(&manifest()), false).unwrap();
    let unsupported = ensure_profile(&env.paths, &r(), "1.20.1").unwrap_err().to_string();
    assert!(unsupported.contains("unterstützt Minecraft 1.20.1 nicht"), "{unsupported}");
    let src = pack_dir(&env.paths, "example", "0.1.0").join("libraries/com/example/example-loader/0.1.0/example-loader-0.1.0.jar");
    std::fs::write(src, b"evil").unwrap();
    let broken = ensure_profile(&env.paths, &r(), "26.3").unwrap_err().to_string();
    assert!(broken.contains("beschädigt"), "{broken}");
}

#[test]
fn resolve_sets_loader_from_pack() {
    let env = Env::new("cl-resolve");
    let mut m = manifest();
    m["mods"] = json!("neoforge");
    import(&env.paths, &env.pack(&m), false).unwrap();
    let (loader, rf) = resolve(&env.paths, &r(), "26.2").unwrap();
    assert_eq!((loader.kind, loader.version.as_deref()), (LoaderKind::Neoforge, Some("0.1.0")));
    assert_eq!(rf, r());
    assert!(resolve(&env.paths, &r(), "26.1").is_err());
}

#[test]
fn instance_field_is_backwards_compatible() {
    let base = json!({
        "id": "i1", "name": "Test", "icon": null, "accent": null, "group": null, "mc_version": "26.3",
        "loader": { "kind": "fabric", "version": "0.16.9" }, "created_at": 0
    });
    let old: Instance = serde_json::from_value(base.clone()).unwrap();
    assert!(old.custom_loader.is_none());
    assert!(serde_json::to_value(&old).unwrap().get("custom_loader").is_none());
    let mut with = base;
    with["custom_loader"] = json!({ "id": "example", "version": "0.1.0" });
    let inst: Instance = serde_json::from_value(with).unwrap();
    assert_eq!(inst.custom_loader, Some(r()));
    assert_eq!(serde_json::to_value(&inst).unwrap()["custom_loader"]["id"], "example");
}
