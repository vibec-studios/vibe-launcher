use super::*;
use crate::instance::Loader;
use serde_json::json;
use std::path::Path;

const DEAD: &str = "http://127.0.0.1:9";

fn write(p: &Path, bytes: &[u8]) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, bytes).unwrap();
}

fn setup() -> (Paths, PathBuf) {
    let root = std::env::temp_dir().join(format!("vibe-fastpath-{}", uuid::Uuid::new_v4().simple()));
    let paths = Paths { root: root.clone() };
    let index = json!({ "objects": { "icons/a.png": { "hash": "aa11223344556677889900aabbccddeeff001122", "size": 2 } } }).to_string();
    write(&paths.assets().join("indexes").join("5.json"), index.as_bytes());
    write(&paths.assets().join("objects").join("aa").join("aa11223344556677889900aabbccddeeff001122"), b"ok");
    write(&paths.libraries().join("com/example/lib/1.0/lib-1.0.jar"), b"lib");
    write(&paths.version_jar("1.20.1"), b"jar!");
    let vanilla = json!({
        "id": "1.20.1",
        "mainClass": "net.minecraft.client.main.Main",
        "libraries": [{ "name": "com.example:lib:1.0", "downloads": { "artifact": { "path": "com/example/lib/1.0/lib-1.0.jar", "url": format!("{DEAD}/lib.jar"), "size": 3 } } }],
        "downloads": { "client": { "url": format!("{DEAD}/client.jar"), "size": 4 } },
        "assetIndex": { "id": "5", "url": format!("{DEAD}/5.json"), "size": index.len() }
    });
    write(&paths.version_json("1.20.1"), vanilla.to_string().as_bytes());
    let fabric = json!({
        "id": "fabric-loader-0.16.9-1.20.1",
        "inheritsFrom": "1.20.1",
        "mainClass": "net.fabricmc.loader.impl.launch.knot.KnotClient",
        "libraries": [{ "name": "net.fabricmc:fabric-loader:0.16.9", "url": format!("{DEAD}/maven/"), "size": 6 }]
    });
    write(&paths.version_json("fabric-loader-0.16.9-1.20.1"), fabric.to_string().as_bytes());
    write(&paths.libraries().join("net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar"), b"fabric");
    (paths, root)
}

fn instance(kind: LoaderKind, loader_version: Option<&str>, version_id: &str) -> Instance {
    serde_json::from_value(json!({
        "id": "i1", "name": "Test", "icon": null, "accent": null, "group": null, "mc_version": "1.20.1",
        "loader": Loader { kind, version: loader_version.map(str::to_string) }, "created_at": 0,
        "install_state": "installed", "version_id": version_id
    }))
    .unwrap()
}

#[tokio::test]
async fn installed_vanilla_resolves_without_network() {
    let (paths, root) = setup();
    let env = Env::current();
    let inst = instance(LoaderKind::Vanilla, None, "1.20.1");
    let (vanilla, resolved) = resolve_local(&paths, &inst, &env).await.unwrap().expect("Schnellpfad");
    assert_eq!(vanilla.id, "1.20.1");
    assert_eq!(resolved.id, "1.20.1");
    std::fs::remove_file(paths.assets().join("objects").join("aa").join("aa11223344556677889900aabbccddeeff001122")).unwrap();
    assert_eq!(missing_files(&paths, &vanilla, &env).await.unwrap(), 1);
    assert!(resolve_local(&paths, &inst, &env).await.unwrap().is_none());
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn installed_fabric_resolves_without_network() {
    let (paths, root) = setup();
    let env = Env::current();
    let inst = instance(LoaderKind::Fabric, Some("0.16.9"), "fabric-loader-0.16.9-1.20.1");
    let (_, resolved) = resolve_local(&paths, &inst, &env).await.unwrap().expect("Schnellpfad");
    assert_eq!(resolved.base_id, "1.20.1");
    let changed = instance(LoaderKind::Fabric, Some("0.17.0"), "fabric-loader-0.16.9-1.20.1");
    assert!(resolve_local(&paths, &changed, &env).await.unwrap().is_none());
    std::fs::write(paths.version_jar("1.20.1"), b"x").unwrap();
    assert!(resolve_local(&paths, &inst, &env).await.unwrap().is_none());
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn missing_version_json_is_not_fatal_for_fallback() {
    let (paths, root) = setup();
    std::fs::remove_file(paths.version_json("1.20.1")).unwrap();
    let inst = instance(LoaderKind::Vanilla, None, "1.20.1");
    assert!(resolve_local(&paths, &inst, &Env::current()).await.is_err());
    let _ = std::fs::remove_dir_all(root);
}
