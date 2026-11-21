use super::*;

#[test]
fn mrpack_filters_client_only() {
    let idx = br#"{"files":[
        {"path":"mods/sodium.jar","hashes":{"sha1":"a"},"env":{"client":"required","server":"unsupported"},"downloads":["https://cdn.modrinth.com/data/AANobbMI/versions/x/sodium.jar"],"fileSize":10},
        {"path":"mods/lithium.jar","hashes":{"sha1":"b"},"env":{"client":"optional","server":"optional"},"downloads":["https://cdn.modrinth.com/data/gvQqBUqZ/versions/y/lithium.jar"]},
        {"path":"mods/servercore.jar","hashes":{"sha1":"c"},"env":{"client":"unsupported","server":"required"},"downloads":["https://example.org/servercore.jar"]},
        {"path":"resourcepacks/faithful.zip","hashes":{},"downloads":["https://example.org/f.zip"]},
        {"path":"mods/nourl.jar","hashes":{},"downloads":[]}
    ]}"#;
    let (list, skipped) = mrpack_server_files(idx).unwrap();
    let paths: Vec<&str> = list.iter().map(|e| e.info.path.as_str()).collect();
    assert_eq!(paths, vec!["mods/lithium.jar", "mods/servercore.jar"]);
    assert_eq!(skipped, 2);
    assert_eq!(list[1].info.side, Side::Server);
    assert!(list.iter().all(|e| e.info.include));
}
