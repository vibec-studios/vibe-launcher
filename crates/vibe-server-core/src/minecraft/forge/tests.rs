use super::*;
#[test]
fn tokens() {
    let mut d = HashMap::new();
    d.insert("SIDE".to_string(), "client".to_string());
    d.insert("MAPPINGS".to_string(), "/x/m.txt".to_string());
    let libs = Path::new("L");
    assert_eq!(replace_tokens("{SIDE}", &d, libs), "client");
    assert_eq!(replace_tokens("--side={SIDE}", &d, libs), "--side=client");
    assert_eq!(replace_tokens("'abc'", &d, libs), "abc");
    assert_eq!(replace_tokens("{UNKNOWN}", &d, libs), "{UNKNOWN}");
    let p = replace_tokens("[net.minecraft:client:1.20.1-2023:srg]", &d, libs);
    assert!(p.replace('\\', "/").ends_with("net/minecraft/client/1.20.1-2023/client-1.20.1-2023-srg.jar"));
}
