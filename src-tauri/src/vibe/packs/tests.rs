use super::*;

#[test]
fn entry_names() {
    for ok in ["config/a.json", "mods/x.jar", "options.txt", "config/", "kubejs/server_scripts/a.js", "a..b/c"] {
        assert!(safe_entry_name(ok), "{ok}");
    }
    for bad in [
        "../evil.txt",
        "config/../../evil",
        "/etc/passwd",
        "C:/Windows/x",
        "C:evil",
        "config\\..\\..\\x",
        "a/./b",
        "a//b",
        "",
        "nul.txt",
        "COM1",
        "con",
        "x/...",
        "x/y ",
        "a\0b",
    ] {
        assert!(!safe_entry_name(bad), "{bad:?}");
    }
}

fn zip_with(names: &[&str]) -> PathBuf {
    let p = std::env::temp_dir().join(format!("vibe-test-{}.zip", uuid::Uuid::new_v4().simple()));
    let mut w = zip::ZipWriter::new(std::fs::File::create(&p).unwrap());
    let o = zip::write::SimpleFileOptions::default();
    for n in names {
        w.start_file(*n, o).unwrap();
        w.write_all(b"x").unwrap();
    }
    w.finish().unwrap();
    p
}

#[test]
fn overrides_check() {
    let good = zip_with(&["config/a.json", "options.txt"]);
    assert!(check_overrides(&good).is_ok());
    let bad = zip_with(&["config/a.json", "../../evil.bat"]);
    let e = check_overrides(&bad).unwrap_err().to_string();
    assert!(e.contains("unsicheren Pfad"), "{e}");
    let abs = zip_with(&["/tmp/x"]);
    assert!(check_overrides(&abs).is_err());
    for p in [good, bad, abs] {
        let _ = std::fs::remove_file(p);
    }
}

#[test]
fn roundtrip_split_build() {
    // vlpack -> split -> build -> gleiche Overrides
    let src = std::env::temp_dir().join(format!("vibe-src-{}.vlpack", uuid::Uuid::new_v4().simple()));
    {
        let mut w = zip::ZipWriter::new(std::fs::File::create(&src).unwrap());
        let o = zip::write::SimpleFileOptions::default();
        w.start_file("vlpack.json", o).unwrap();
        w.write_all(br#"{"format_version":1,"name":"T","mc_version":"1.21.1","loader":{"kind":"vanilla"},"files":[]}"#).unwrap();
        w.start_file("overrides/config/a.json", o).unwrap();
        w.write_all(b"{}").unwrap();
        w.start_file("overrides/options.txt", o).unwrap();
        w.write_all(b"fov:1").unwrap();
        w.finish().unwrap();
    }
    let ov = src.with_extension("zip");
    let parts = split_vlpack(&src, &ov).unwrap();
    assert!(parts.has_overrides);
    assert!(parts.icon.is_none());
    check_overrides(&ov).unwrap();
    let dest = src.with_extension("out.vlpack");
    build_vlpack(&dest, &parts.manifest, Some(&ov), None).unwrap();
    let mut z = zip::ZipArchive::new(std::fs::File::open(&dest).unwrap()).unwrap();
    let mut names: Vec<String> = (0..z.len()).map(|i| z.by_index(i).unwrap().name().to_string()).collect();
    names.sort();
    assert_eq!(names, vec!["overrides/config/a.json", "overrides/options.txt", "vlpack.json"]);
    for p in [src, ov, dest] {
        let _ = std::fs::remove_file(p);
    }
}

#[test]
fn codes() {
    assert!(valid_code("K7QX2M9P"));
    assert!(!valid_code("../x"));
    assert!(!valid_code("ab"));
}
