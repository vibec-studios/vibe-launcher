use super::super::validate::{is_https, is_java_class, is_maven, parse, safe_rel};
use super::*;
use crate::instance::LoaderKind;

fn code(m: &Value) -> &'static str {
    parse(m.to_string().as_bytes()).expect_err("ungültig").code
}

fn with(f: impl FnOnce(&mut Value)) -> Value {
    let mut m = manifest();
    f(&mut m);
    m
}

#[test]
fn valid_manifest_is_normalized() {
    let m = parse(manifest().to_string().as_bytes()).unwrap();
    assert_eq!((m.id.as_str(), m.loader_version.as_str(), m.mods), ("example", "0.1.0", LoaderKind::Fabric));
    assert_eq!(m.minecraft, vec!["26.3", "26.2"]);
    assert_eq!(m.profile.arguments.jvm, vec!["-Dexample.flag=true"]);
    assert_eq!(m.profile.libraries.len(), 2);
    assert!(m.profile.libraries[0].sha1.is_none());
    assert_eq!(m.profile.libraries[1].sha1.as_deref(), Some(ASM_SHA1));
    assert_eq!(m.profile.libraries[0].maven_path(), "com/example/example-loader/0.1.0/example-loader-0.1.0.jar");
}

#[test]
fn header_rules() {
    assert_eq!(code(&with(|m| m["format"] = json!("other"))), "format_unknown");
    assert_eq!(code(&with(|m| m["version"] = json!(2))), "format_version");
    for bad in ["", "a", "-example", "Example", "ex_ample", "a".repeat(33).as_str()] {
        assert_eq!(code(&with(|m| m["id"] = json!(bad))), "id_invalid", "{bad}");
    }
    for ok in ["ex", "0x", "example-loader-2"] {
        assert!(parse(with(|m| m["id"] = json!(ok)).to_string().as_bytes()).is_ok(), "{ok}");
    }
    for bad in ["", "0.1 beta", "../1", "1/2", "a".repeat(41).as_str()] {
        assert_eq!(code(&with(|m| m["loader_version"] = json!(bad))), "version_invalid", "{bad}");
    }
    assert!(parse(with(|m| m["loader_version"] = json!("1.0.0+build_7-rc.1")).to_string().as_bytes()).is_ok());
    assert_eq!(code(&with(|m| m["name"] = json!(" "))), "name_invalid");
    assert_eq!(code(&with(|m| m["name"] = json!("n".repeat(41)))), "name_invalid");
    assert_eq!(code(&with(|m| m["description"] = json!("d".repeat(301)))), "description_too_long");
    assert_eq!(code(&with(|m| m["homepage"] = json!("http://example.com"))), "homepage_invalid");
    assert_eq!(code(&with(|m| m["icon"] = json!("../icon.png"))), "icon_invalid");
    assert_eq!(code(&with(|m| m["icon"] = json!("icon.gif"))), "icon_invalid");
}

#[test]
fn minecraft_and_mods_rules() {
    assert_eq!(code(&with(|m| m["minecraft"] = json!([]))), "mc_empty");
    assert_eq!(code(&with(|m| m["minecraft"] = json!(["1.21 1"]))), "mc_invalid");
    assert_eq!(code(&with(|m| m["minecraft"] = json!([".."]))), "mc_invalid");
    let dup = parse(with(|m| m["minecraft"] = json!(["26.3", "26.3"])).to_string().as_bytes()).unwrap();
    assert_eq!(dup.minecraft, vec!["26.3"]);
    assert_eq!(code(&with(|m| m["mods"] = json!("rift"))), "mods_invalid");
    for (s, k) in [("quilt", LoaderKind::Quilt), ("forge", LoaderKind::Forge), ("neoforge", LoaderKind::Neoforge), ("vanilla", LoaderKind::Vanilla)] {
        assert_eq!(parse(with(|m| m["mods"] = json!(s)).to_string().as_bytes()).unwrap().mods, k);
    }
}

#[test]
fn profile_rules() {
    assert_eq!(code(&with(|m| m.as_object_mut().unwrap().remove("profile").map(|_| ()).unwrap())), "profile_missing");
    assert_eq!(code(&with(|m| m["profile"]["mainClass"] = json!("com.example.1Main"))), "main_class_invalid");
    assert_eq!(code(&with(|m| m["profile"]["mainClass"] = json!("com..Main"))), "main_class_invalid");
    let rule = json!({ "rules": [{ "action": "allow" }], "value": "-Xss1M" });
    assert_eq!(code(&with(|m| m["profile"]["arguments"]["jvm"] = json!([rule]))), "arguments_not_strings");
    assert!(parse(with(|m| m["profile"].as_object_mut().unwrap().remove("arguments").map(|_| ()).unwrap()).to_string().as_bytes()).is_ok());
}

#[test]
fn library_rules() {
    let lib = |l: Value| with(move |m| m["profile"]["libraries"] = json!([l]));
    assert_eq!(code(&lib(json!({ "name": "com.example:only", "file": "a.jar" }))), "library_name_invalid");
    assert_eq!(code(&lib(json!({ "name": "com.example:..:1", "file": "a.jar" }))), "library_name_invalid");
    assert_eq!(code(&lib(json!({ "name": "com.example:a:1@zip", "file": "a.jar" }))), "library_name_invalid");
    assert_eq!(code(&lib(json!({ "name": "com.example:a:1" }))), "library_source");
    assert_eq!(code(&lib(json!({ "name": "com.example:a:1", "file": "a.jar", "url": "https://example.com/a.jar" }))), "library_source");
    assert_eq!(code(&lib(json!({ "name": "com.example:a:1", "file": "../a.jar" }))), "library_file_invalid");
    assert_eq!(code(&lib(json!({ "name": "com.example:a:1", "file": "a.zip" }))), "library_file_invalid");
    assert_eq!(code(&lib(json!({ "name": "com.example:a:1", "url": "http://example.com/a.jar", "sha1": ASM_SHA1, "size": 1 }))), "library_url_invalid");
    assert_eq!(code(&lib(json!({ "name": "com.example:a:1", "url": "https://example.com/a.jar", "size": 1 }))), "library_sha1_missing");
    assert_eq!(code(&lib(json!({ "name": "com.example:a:1", "url": "https://example.com/a.jar", "sha1": ASM_SHA1 }))), "library_size_missing");
    let two = with(|m| {
        m["profile"]["libraries"] = json!([
            { "name": "com.example:a:1", "file": "a.jar" },
            { "name": "com.example:a:1", "url": "https://example.com/a.jar", "sha1": ASM_SHA1, "size": 1 }
        ])
    });
    assert_eq!(code(&two), "library_duplicate");
    assert!(parse(lib(json!({ "name": "com.example:a:1:natives-windows", "file": "a.jar" })).to_string().as_bytes()).is_ok());
}

#[test]
fn broken_json_is_reported() {
    assert_eq!(parse(b"{ nope").unwrap_err().code, "manifest_invalid");
    assert_eq!(parse(b"[]").unwrap_err().code, "manifest_invalid");
}

#[test]
fn helpers() {
    assert!(safe_rel("libraries/a.jar") && safe_rel("a"));
    for bad in ["", "/a", "a/../b", "./a", "a//b", "a\\b", "C:/a", "a/"] {
        assert!(!safe_rel(bad), "{bad}");
    }
    assert!(is_java_class("Main") && is_java_class("com.example.Main$Inner") && !is_java_class("com.example.") && !is_java_class("1x"));
    assert!(is_maven("g:a:1") && is_maven("g.h:a-b:1.0+x:natives") && !is_maven("g:a") && !is_maven("g:a:1:c:d") && !is_maven("g/x:a:1"));
    assert!(is_https("https://example.com/x.jar") && !is_https("https://user:pw@example.com/x.jar") && !is_https("file:///x.jar"));
}
