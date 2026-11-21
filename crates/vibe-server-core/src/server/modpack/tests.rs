use super::*;
use std::io::Write;

fn zip_with(path: &Path, files: &[(&str, &[u8])]) {
    let f = std::fs::File::create(path).unwrap();
    let mut z = zip::ZipWriter::new(f);
    for (n, b) in files {
        z.start_file(*n, zip::write::SimpleFileOptions::default()).unwrap();
        z.write_all(b).unwrap();
    }
    z.finish().unwrap();
}

fn tmp() -> PathBuf {
    let d = std::env::temp_dir().join(format!("vsc-modpack-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn mrpack_server_files_only() {
    let d = tmp();
    let p = d.join("x.mrpack");
    let idx = br#"{"formatVersion":1,"game":"minecraft","name":"Pack","dependencies":{"minecraft":"1.21.1","fabric-loader":"0.16.9"},
        "files":[{"path":"mods/a.jar","hashes":{"sha1":"aa"},"env":{"client":"required","server":"required"},"downloads":["https://x/a.jar"],"fileSize":3},
                 {"path":"mods/shader.jar","hashes":{"sha1":"bb"},"env":{"client":"required","server":"unsupported"},"downloads":["https://x/b.jar"]}]}"#;
    zip_with(&p, &[("modrinth.index.json", idx), ("overrides/config/a.toml", b"x=1"), ("overrides/options.txt", b"o"), ("client-overrides/config/c.toml", b"c"), ("server-overrides/server.properties", b"motd=hi")]);
    let info = inspect(&p, PackFormat::Mrpack).unwrap();
    assert_eq!(info.mc_version.as_deref(), Some("1.21.1"));
    assert_eq!(info.loader.as_ref().unwrap().kind, LoaderKind::Fabric);
    assert_eq!(info.files.len(), 1);
    let out = d.join("srv");
    std::fs::create_dir_all(&out).unwrap();
    extract(&p, &info, &out).unwrap();
    assert!(out.join("config/a.toml").exists());
    assert!(out.join("server.properties").exists());
    assert!(!out.join("options.txt").exists());
    assert!(!out.join("config/c.toml").exists());
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn zip_strips_top_folder() {
    let d = tmp();
    let p = d.join("x.zip");
    zip_with(&p, &[("MyServer/mods/a.jar", b"j"), ("MyServer/config/b.json", b"{}"), ("MyServer/../evil", b"e")]);
    let info = inspect(&p, PackFormat::Zip).unwrap();
    assert_eq!(info.strip_prefix.as_deref(), Some("MyServer"));
    let out = d.join("srv");
    std::fs::create_dir_all(&out).unwrap();
    extract(&p, &info, &out).unwrap();
    assert!(out.join("mods/a.jar").exists() && out.join("config/b.json").exists());
    assert!(!d.join("evil").exists());
    let _ = std::fs::remove_dir_all(d);
}
