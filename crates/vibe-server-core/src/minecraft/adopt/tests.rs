use super::*;
use std::io::Write;

fn proc(name: &str, start: u64, cmd: &[&str], cwd: Option<&str>) -> ProcInfo {
    ProcInfo { pid: 42, start_secs: start, name: name.into(), cmd: cmd.iter().map(|s| s.to_string()).collect(), cwd: cwd.map(PathBuf::from) }
}

#[test]
fn arg_value_supports_both_forms() {
    let cmd: Vec<String> = ["java", "-Xmx2G", "--gameDir", "C:/a b/g", "--width=854"].iter().map(|s| s.to_string()).collect();
    assert_eq!(arg_value(&cmd, "--gameDir"), Some("C:/a b/g"));
    assert_eq!(arg_value(&cmd, "--width"), Some("854"));
    assert_eq!(arg_value(&cmd, "--height"), None);
}

#[test]
fn start_time_guards_pid_reuse() {
    assert!(start_matches(1000, 1000));
    assert!(start_matches(1000, 1002));
    assert!(!start_matches(1000, 1003));
    assert!(!start_matches(1000, 500));
}

#[test]
fn same_process_needs_java_start_and_dir() {
    let dir = Path::new("/data/instances/abc/minecraft");
    let ok = proc("java", 100, &["java", "--gameDir", "/data/instances/abc/minecraft/"], None);
    assert!(is_same(&ok, 100, dir));
    assert!(!is_same(&ok, 200, dir));
    let other = proc("java", 100, &["java", "--gameDir", "/data/instances/xyz/minecraft"], None);
    assert!(!is_same(&other, 100, dir));
    let notepad = proc("notepad", 100, &["notepad", "--gameDir", "/data/instances/abc/minecraft"], None);
    assert!(!is_same(&notepad, 100, dir));
    let by_cwd = proc("javaw.exe", 100, &["javaw", "-cp", "x"], Some("/data/instances/abc/minecraft"));
    assert!(is_same(&by_cwd, 100, dir));
    let hidden = proc("java.exe", 100, &[], None);
    assert!(is_same(&hidden, 100, dir));
}

#[test]
fn normalize_ignores_separators_and_case_on_windows() {
    assert!(same_path(Path::new("C:\\Vibe\\x\\"), Path::new("C:/Vibe/x")));
    if cfg!(windows) {
        assert!(same_path(Path::new("c:/vibe/X"), Path::new("C:\\Vibe\\x")));
        assert!(same_path(Path::new("\\\\?\\C:\\Vibe\\x"), Path::new("C:/Vibe/x")));
    }
}

#[test]
fn own_process_is_found_and_alive() {
    let me = info(std::process::id()).expect("eigener Prozess");
    assert!(alive(me.pid, me.start_secs));
    assert!(!alive(me.pid, me.start_secs + 100));
}

#[test]
fn follow_reads_only_new_complete_lines_and_handles_truncation() {
    let dir = std::env::temp_dir().join(format!("vsc-tail-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("latest.log");
    std::fs::write(&file, "alt 1\nalt 2\n").unwrap();
    let mut f = Follow::at_end(&file);
    assert!(f.read(&file).is_empty());
    let mut h = std::fs::OpenOptions::new().append(true).open(&file).unwrap();
    h.write_all(b"neu 1\nhalb").unwrap();
    h.flush().unwrap();
    assert_eq!(f.read(&file), vec![b"neu 1\n".to_vec()]);
    h.write_all(b"e Zeile\n").unwrap();
    h.flush().unwrap();
    assert_eq!(f.read(&file), vec![b"halbe Zeile\n".to_vec()]);
    drop(h);
    std::fs::write(&file, "frisch\nrest").unwrap();
    assert_eq!(f.read(&file), vec![b"frisch\n".to_vec()]);
    assert_eq!(f.rest(), Some(b"rest".to_vec()));
    std::fs::remove_dir_all(&dir).ok();
}

#[tokio::test]
async fn wait_exit_returns_for_dead_pid() {
    assert_eq!(wait_exit(u32::MAX - 7, 1).await, None);
}
