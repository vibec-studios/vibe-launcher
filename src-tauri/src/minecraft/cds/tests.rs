use super::*;
use crate::instance::LoaderKind;
use std::io::{Read, Write};

fn inputs<'a>(loader: LoaderKind, major: u32, version: &'a str, user: &'a [String], space: bool) -> Inputs<'a> {
    Inputs { loader, major, version, user_jvm: user, max_mem_mb: 4096, path_has_space: space }
}

#[test]
fn rules_cover_loader_java_flags_and_spaces() {
    let none: Vec<String> = Vec::new();
    assert!(blocked(&inputs(LoaderKind::Vanilla, 21, "21.0.7", &none, false)).is_none());
    assert!(blocked(&inputs(LoaderKind::Neoforge, 21, "21.0.7", &none, false)).is_none());
    assert!(blocked(&inputs(LoaderKind::Forge, 25, "25.0.1", &none, true)).is_none());
    assert!(blocked(&inputs(LoaderKind::Vanilla, 21, "21.0.11", &none, true)).is_none());
    assert!(blocked(&inputs(LoaderKind::Vanilla, 21, "21.0.7", &none, true)).is_some());
    assert!(blocked(&inputs(LoaderKind::Fabric, 21, "21.0.7", &none, false)).is_some());
    assert!(blocked(&inputs(LoaderKind::Quilt, 21, "21.0.7", &none, false)).is_some());
    assert!(blocked(&inputs(LoaderKind::Vanilla, 17, "17.0.15", &none, false)).is_some());
    let user = vec!["-XX:SharedArchiveFile=x.jsa".to_string()];
    assert!(blocked(&inputs(LoaderKind::Vanilla, 21, "21.0.7", &user, false)).is_some());
    let mut big = inputs(LoaderKind::Vanilla, 21, "21.0.7", &none, false);
    big.max_mem_mb = 32 * 1024;
    assert!(blocked(&big).is_some());
}

fn touch(p: &Path, bytes: &[u8]) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, bytes).unwrap();
}

#[test]
fn fingerprint_changes_with_classpath_and_files() {
    let dir = crate::util::testdir::TestDir::new("cds-fp");
    let (a, b) = (dir.path().join("a.jar"), dir.path().join("b.jar"));
    touch(&a, b"a");
    touch(&b, b"b");
    let sep = if cfg!(windows) { ";" } else { ":" };
    let args = |cp: String| vec!["-Xmx4G".to_string(), "-cp".into(), cp, "Main".into()];
    let one = args(a.display().to_string());
    let two = args(format!("{}{sep}{}", a.display(), b.display()));
    let fp1 = fingerprint("java", "21.0.7", "1.21.11", "Main", &one);
    assert_eq!(fp1, fingerprint("java", "21.0.7", "1.21.11", "Main", &one));
    assert_ne!(fp1, fingerprint("java", "21.0.7", "1.21.11", "Main", &two));
    assert_ne!(fp1, fingerprint("java", "21.0.8", "1.21.11", "Main", &one));
    assert_ne!(fp1, fingerprint("java", "21.0.7", "neoforge-21.1.267", "Main", &one));
    touch(&a, b"geaendert");
    assert_ne!(fp1, fingerprint("java", "21.0.7", "1.21.11", "Main", &one));
    assert_eq!(fp1.len(), 16);
}

#[test]
fn strip_removes_signature_and_keeps_entries() {
    let dir = crate::util::testdir::TestDir::new("cds-jar");
    let src = dir.path().join("client.jar");
    let mut w = zip::ZipWriter::new(std::fs::File::create(&src).unwrap());
    let o = zip::write::SimpleFileOptions::default();
    let entries: [(&str, &[u8]); 6] = [
        ("META-INF/MANIFEST.MF", b"Manifest-Version: 1.0\r\nMain-Class: net.minecraft.client.main.Main\r\n\r\nName: a.class\r\nSHA-384-Digest: xyz\r\n"),
        ("META-INF/MOJANGCS.SF", b"sig"),
        ("META-INF/MOJANGCS.RSA", b"rsa"),
        ("META-INF/services/x", b"svc"),
        ("a.class", b"cafebabe"),
        ("assets/x.png", b"png"),
    ];
    for (n, b) in entries {
        w.start_file(n, o).unwrap();
        w.write_all(b).unwrap();
    }
    w.finish().unwrap();
    let dst = dir.path().join("out").join("1.21.11.jar");
    strip(&src, &dst).unwrap();
    let mut z = zip::ZipArchive::new(std::fs::File::open(&dst).unwrap()).unwrap();
    let names: Vec<String> = z.file_names().map(str::to_string).collect();
    assert!(!names.iter().any(|n| is_signature(n)));
    assert_eq!(names.len(), 4);
    let mut m = String::new();
    z.by_name("META-INF/MANIFEST.MF").unwrap().read_to_string(&mut m).unwrap();
    assert_eq!(m, "Manifest-Version: 1.0\r\nMain-Class: net.minecraft.client.main.Main\r\n\r\n");
    let mut c = Vec::new();
    z.by_name("a.class").unwrap().read_to_end(&mut c).unwrap();
    assert_eq!(c, b"cafebabe");
    assert!(is_signature("META-INF/X.EC") && !is_signature("META-INF/services/A.SF"));
}

#[test]
fn copy_path_uses_hash_and_keeps_file_name() {
    let p = jar::copy_path(Path::new("meta"), Path::new("versions/neoforge-21.1.267/neoforge-21.1.267.jar"), Some("ABCDEF0123456789")).unwrap();
    assert_eq!(p, Path::new("meta").join("cds").join("abcdef0123456789").join("neoforge-21.1.267.jar"));
}

#[test]
fn apply_inserts_before_main_class_and_cleans_old() {
    let dir = crate::util::testdir::TestDir::new("cds-apply");
    let vibe = dir.path().join(".vibe");
    touch(&vibe.join("cds-0000000000000000.jsa"), b"alt");
    let mut plan = LaunchPlan { program: "java".into(), args: vec!["-Xmx4G".into(), "Main".into(), "--demo".into()], env: HashMap::new(), cwd: dir.path().into(), display: "java -Xmx4G Main --demo".into() };
    let pending = || Pending { dir: vibe.clone(), java: "java".into(), java_version: "21.0.7".into(), version_id: "1.21.11".into(), main_class: "Main".into() };
    let line = pending().apply(&mut plan, "run-1", 1).unwrap();
    assert!(line.contains("erstellt"));
    assert!(plan.args[1].starts_with("-XX:SharedArchiveFile=") && plan.args[2] == "-XX:+AutoCreateSharedArchive" && plan.args[3] == "Main");
    assert!(plan.display.contains("-XX:+AutoCreateSharedArchive Main"));
    assert!(!vibe.join("cds-0000000000000000.jsa").exists());
    let mut second = LaunchPlan { args: vec!["Main".into()], display: String::new(), ..plan };
    assert!(pending().apply(&mut second, "run-2", 2).is_none());
    on_exit("run-1", true, 5_000);
    assert_eq!(instance_files(dir.path()).len(), 1);
    let mut third = LaunchPlan { args: vec!["Main".into()], display: String::new(), ..second };
    assert!(pending().apply(&mut third, "run-3", 1).unwrap().contains("aus"));
    clear_instance(dir.path());
    assert!(instance_files(dir.path()).is_empty());
}
