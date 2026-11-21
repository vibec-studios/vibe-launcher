use super::*;

fn env_win() -> Env {
    Env { os: "windows", arch: "x86_64", os_version: "10.0.26200".into(), features: HashMap::new() }
}

#[test]
fn rules_basic() {
    let e = env_win();
    let r: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow"},{"action":"disallow","os":{"name":"osx"}}]"#).unwrap();
    assert!(rules_allow(Some(&r), &e));
    let r: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow","os":{"name":"osx"}}]"#).unwrap();
    assert!(!rules_allow(Some(&r), &e));
    let r: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow","os":{"name":"windows","version":"^10\\."}}]"#).unwrap();
    assert!(rules_allow(Some(&r), &e));
    let r: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow","os":{"arch":"x86"}}]"#).unwrap();
    assert!(!rules_allow(Some(&r), &e));
    let r: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow","features":{"is_demo_user":true}}]"#).unwrap();
    assert!(!rules_allow(Some(&r), &e));
    assert!(rules_allow(Some(&r), &e.clone().with_feature("is_demo_user", true)));
    let r: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow","os":{"name":"windows","versionRange":{"min":"10.0.17134"}}}]"#).unwrap();
    assert!(rules_allow(Some(&r), &e));
    let r: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow","os":{"name":"windows","versionRange":{"max":"10.0.17134"}}}]"#).unwrap();
    assert!(!rules_allow(Some(&r), &e));
    assert!(rules_allow(None, &e));
}

#[test]
fn args_eval() {
    let a: Vec<Argument> = serde_json::from_str(
        r#"["--a", {"rules":[{"action":"allow","features":{"has_custom_resolution":true}}],"value":["--width","${w}"]},
            {"rules":[{"action":"allow","os":{"name":"windows"}}],"value":"-Xwin"}]"#,
    )
    .unwrap();
    assert_eq!(eval_args(&a, &env_win()), vec!["--a", "-Xwin"]);
    assert_eq!(eval_args(&a, &env_win().with_feature("has_custom_resolution", true)), vec!["--a", "--width", "${w}", "-Xwin"]);
}

#[test]
fn maven_parse() {
    assert_eq!(library_key("org.lwjgl:lwjgl:3.3.3:natives-windows"), "org.lwjgl:lwjgl:natives-windows");
    assert_eq!(library_key("org.ow2.asm:asm:9.7"), "org.ow2.asm:asm");
    assert_eq!(library_key("de.oceanlabs.mcp:mcp_config:1.20.1@zip"), "de.oceanlabs.mcp:mcp_config");
    assert!(parse_maven("broken").is_none());
}

#[test]
fn library_paths_and_natives() {
    let e = env_win();
    let libs = std::path::Path::new("L");
    let l: Library = serde_json::from_str(r#"{"name":"net.fabricmc:fabric-loader:0.16.9","url":"https://maven.fabricmc.net/"}"#).unwrap();
    let a = l.artifact(libs).unwrap();
    assert_eq!(a.url, "https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar");
    let l: Library = serde_json::from_str(
        r#"{"name":"org.lwjgl.lwjgl:lwjgl-platform:2.9.4","natives":{"windows":"natives-windows-${arch}"},
            "downloads":{"classifiers":{"natives-windows-64":{"path":"x/y.jar","url":"https://u/y.jar","sha1":"ab","size":3}}}}"#,
    )
    .unwrap();
    assert!(l.artifact(libs).is_none());
    let n = l.native_artifact(libs, &e).unwrap();
    assert_eq!(n.url, "https://u/y.jar");
    let arm: Library = serde_json::from_str(r#"{"name":"org.lwjgl:lwjgl:3.3.3:natives-windows-arm64","rules":[{"action":"allow","os":{"name":"windows"}}]}"#).unwrap();
    assert!(!arm.allowed(&e));
    let x64: Library = serde_json::from_str(r#"{"name":"org.lwjgl:lwjgl:3.3.3:natives-windows","rules":[{"action":"allow","os":{"name":"windows"}}]}"#).unwrap();
    assert!(x64.allowed(&e));
}

#[test]
fn merge_chain() {
    let parent: VersionJson = serde_json::from_str(
        r#"{"id":"1.20.1","type":"release","mainClass":"net.minecraft.client.main.Main",
            "arguments":{"game":["--username","${auth_player_name}"],"jvm":["-cp","${classpath}"]},
            "libraries":[{"name":"org.ow2.asm:asm:9.3"},{"name":"com.mojang:brigadier:1.0"}],
            "logging":{"client":{"argument":"-Dlog4j.configurationFile=${path}","file":{"id":"c.xml","url":"https://x/c.xml"}}},
            "javaVersion":{"component":"java-runtime-gamma","majorVersion":17}}"#,
    )
    .unwrap();
    let child: VersionJson = serde_json::from_str(
        r#"{"id":"forge","inheritsFrom":"1.20.1","mainClass":"cpw.Bootstrap","logging":{},
            "arguments":{"game":["--launchTarget","forgeclient"],"jvm":["-DlibraryDirectory=${library_directory}"]},
            "libraries":[{"name":"org.ow2.asm:asm:9.5"}]}"#,
    )
    .unwrap();
    let r = merge(&[child, parent], &env_win());
    assert_eq!(r.id, "forge");
    assert_eq!(r.base_id, "1.20.1");
    assert_eq!(r.main_class, "cpw.Bootstrap");
    assert_eq!(r.libraries.len(), 2);
    assert_eq!(r.libraries[0].name, "org.ow2.asm:asm:9.5");
    assert_eq!(eval_args(&r.game_args, &env_win()), vec!["--username", "${auth_player_name}", "--launchTarget", "forgeclient"]);
    assert_eq!(eval_args(&r.jvm_args, &env_win()).len(), 3);
    assert!(r.logging.is_some());
    assert_eq!(required_java(&r), 17);
}
