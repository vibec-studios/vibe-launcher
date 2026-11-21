use super::*;
use serde_json::json;

struct TmpDir(PathBuf);
impl TmpDir {
    fn new(tag: &str) -> Self {
        let p = std::env::temp_dir().join(format!("vl-clips-test-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&p).unwrap();
        TmpDir(p)
    }
}
impl Drop for TmpDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

const ID: &str = "2026-11-19_21-04-33_multikill";

fn sample(id: &str) -> Value {
    json!({
        "schema": 1, "id": id, "created_at": "2026-11-19T20:04:33Z",
        "video": format!("{id}.mp4"), "thumbnail": format!("{id}.jpg"),
        "duration_ms": 31967, "size_bytes": 24093112, "width": 1280, "height": 720, "fps": 30,
        "video_codec": "h264", "reason": "multikill", "kills": 2, "highlight_ms": 26100,
        "events": [{ "t_ms": 21400, "type": "kill", "victim": "Steve" }, { "t_ms": 26100, "type": "kill", "victim": "Kai" }],
        "player": { "name": "Alex", "uuid": "1c2d3e4f" }, "mode": "multiplayer", "server": "play.example.net",
        "encoder": "h264_qsv", "kept": false, "title": "Bridge 1v2", "tags": ["bedwars"],
        "future_field": { "nested": [1, 2, 3] }
    })
}

fn write_clip(dir: &Path, id: &str, v: &Value, video: bool, thumb: bool) {
    std::fs::write(dir.join(format!("{id}.json")), serde_json::to_vec(v).unwrap()).unwrap();
    if video {
        std::fs::write(dir.join(format!("{id}.mp4")), b"mp4").unwrap();
    }
    if thumb {
        std::fs::write(dir.join(format!("{id}.jpg")), b"jpg").unwrap();
    }
}

fn one(dir: &Path) -> Vec<Clip> {
    scan(&[("inst".into(), dir.to_path_buf())], Duration::from_millis(1))
}

#[test]
fn id_regex() {
    assert!(valid_id(ID));
    assert!(valid_id("2026-11-19_21-04-33_hotkey_2"));
    assert!(!valid_id("2026-11-19_21-04-33_Hotkey"));
    assert!(!valid_id("2026-11-19_21-04-33"));
    assert!(!valid_id("../2026-11-19_21-04-33_kill"));
    assert!(!valid_id("2026-11-19_21-04-33_kill.json"));
}

#[test]
fn parses_contract_example() {
    let t = TmpDir::new("parse");
    write_clip(&t.0, ID, &sample(ID), true, true);
    let list = one(&t.0);
    assert_eq!(list.len(), 1);
    let c = &list[0];
    assert_eq!(c.id, ID);
    assert_eq!(c.reason, "multikill");
    assert_eq!(c.kills, Some(2));
    assert_eq!(c.events.len(), 2);
    assert_eq!(c.events[1].victim.as_deref(), Some("Kai"));
    assert_eq!(c.server.as_deref(), Some("play.example.net"));
    assert_eq!(c.created_at, chrono::DateTime::parse_from_rfc3339("2026-11-19T20:04:33Z").unwrap().timestamp_millis());
    assert!(c.thumbnail_path.is_some());
    assert_eq!(c.tags, vec!["bedwars".to_string()]);
}

#[test]
fn skips_what_is_not_a_clip() {
    let t = TmpDir::new("skip");
    // ohne Video
    write_clip(&t.0, "2026-11-19_10-00-00_hotkey", &sample("2026-11-19_10-00-00_hotkey"), false, false);
    // höheres Schema
    let mut v = sample("2026-11-19_10-00-01_kill");
    v["schema"] = json!(2);
    write_clip(&t.0, "2026-11-19_10-00-01_kill", &v, true, false);
    // kaputtes JSON (wird nach dem Wiederholen übersprungen, aber nicht gelöscht)
    std::fs::write(t.0.join("2026-11-19_10-00-02_kill.json"), b"{ \"schema\": 1,").unwrap();
    std::fs::write(t.0.join("2026-11-19_10-00-02_kill.mp4"), b"x").unwrap();
    // Dotfiles, Ordner, fremde Namen
    std::fs::write(t.0.join(format!(".{ID}.json.tmp")), b"{}").unwrap();
    std::fs::create_dir_all(t.0.join(".buffer")).unwrap();
    std::fs::create_dir_all(t.0.join(".tmp")).unwrap();
    std::fs::write(t.0.join("notes.json"), b"{}").unwrap();
    // Video-Name mit Pfad
    let mut v = sample("2026-11-19_10-00-03_kill");
    v["video"] = json!("../evil.mp4");
    write_clip(&t.0, "2026-11-19_10-00-03_kill", &v, true, false);
    // ein gültiger ohne Vorschaubild
    write_clip(&t.0, "2026-11-19_10-00-04_death", &sample("2026-11-19_10-00-04_death"), true, false);

    let list = one(&t.0);
    assert_eq!(list.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), vec!["2026-11-19_10-00-04_death"]);
    assert!(list[0].thumbnail_path.is_none());
    assert!(t.0.join("2026-11-19_10-00-02_kill.json").exists(), "kaputte JSON nie löschen");
}

#[test]
fn broken_json_is_retried() {
    let t = TmpDir::new("retry");
    let id = "2026-11-19_10-00-02_kill";
    std::fs::write(t.0.join(format!("{id}.json")), b"{").unwrap();
    std::fs::write(t.0.join(format!("{id}.mp4")), b"x").unwrap();
    let dir = t.0.clone();
    let good = serde_json::to_vec(&sample(id)).unwrap();
    let w = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(60));
        std::fs::write(dir.join(format!("{id}.json")), good).unwrap();
    });
    let list = scan(&[("inst".into(), t.0.clone())], Duration::from_millis(300));
    w.join().unwrap();
    assert_eq!(list.len(), 1);
}

#[test]
fn sorts_newest_first() {
    let t = TmpDir::new("sort");
    for (id, at) in [("2026-11-18_10-00-00_kill", "2026-11-18T09:00:00Z"), ("2026-11-19_10-00-00_kill", "2026-11-19T09:00:00Z")] {
        let mut v = sample(id);
        v["created_at"] = json!(at);
        write_clip(&t.0, id, &v, true, false);
    }
    let list = one(&t.0);
    assert_eq!(list[0].id, "2026-11-19_10-00-00_kill");
}

#[test]
fn edit_keeps_unknown_fields() {
    let t = TmpDir::new("edit");
    write_clip(&t.0, ID, &sample(ID), true, true);
    apply_edit(&t.0, ID, ClipEdit { kept: Some(true), title: Some("  Neu  ".into()), tags: Some(vec!["a".into(), " b ".into(), "A".into(), "".into()]) }).unwrap();
    let v: Value = serde_json::from_slice(&std::fs::read(t.0.join(format!("{ID}.json"))).unwrap()).unwrap();
    assert_eq!(v["kept"], json!(true));
    assert_eq!(v["title"], json!("Neu"));
    assert_eq!(v["tags"], json!(["a", "b"]));
    // alles andere unverändert
    let mut expect = sample(ID);
    expect["kept"] = json!(true);
    expect["title"] = json!("Neu");
    expect["tags"] = json!(["a", "b"]);
    assert_eq!(v, expect);
    assert!(!t.0.join(format!(".{ID}.json.tmp")).exists());

    // leere Werte entfernen die Felder (weglassen statt null)
    apply_edit(&t.0, ID, ClipEdit { kept: None, title: Some("".into()), tags: Some(vec![]) }).unwrap();
    let v: Value = serde_json::from_slice(&std::fs::read(t.0.join(format!("{ID}.json"))).unwrap()).unwrap();
    assert!(v.get("title").is_none() && v.get("tags").is_none());
    assert_eq!(v["kept"], json!(true));
    assert_eq!(v["future_field"], json!({ "nested": [1, 2, 3] }));
}

#[test]
fn edit_limits() {
    let t = TmpDir::new("limits");
    write_clip(&t.0, ID, &sample(ID), true, false);
    assert!(apply_edit(&t.0, ID, ClipEdit { title: Some("x".repeat(101)), ..Default::default() }).is_err());
    assert!(apply_edit(&t.0, ID, ClipEdit { title: Some("ä".repeat(100)), ..Default::default() }).is_ok());
    assert!(apply_edit(&t.0, ID, ClipEdit { tags: Some(vec!["y".repeat(33)]), ..Default::default() }).is_err());
    assert!(apply_edit(&t.0, ID, ClipEdit { tags: Some((0..17).map(|n| n.to_string()).collect()), ..Default::default() }).is_err());
    assert!(apply_edit(&t.0, ID, ClipEdit { tags: Some((0..16).map(|n| n.to_string()).collect()), ..Default::default() }).is_ok());
    assert!(apply_edit(&t.0, "../x", ClipEdit::default()).is_err());
    // höheres Schema wird nicht angefasst
    let mut v = sample(ID);
    v["schema"] = json!(2);
    write_clip(&t.0, ID, &v, true, false);
    assert!(apply_edit(&t.0, ID, ClipEdit { kept: Some(true), ..Default::default() }).is_err());
}

#[test]
fn delete_removes_json_first_and_all_files() {
    let t = TmpDir::new("delete");
    write_clip(&t.0, ID, &sample(ID), true, true);
    let other = "2026-11-19_21-04-33_multikill_2";
    write_clip(&t.0, other, &sample(other), true, true);
    // Halten wir die MP4 offen, bleibt sie übrig – die JSON ist trotzdem weg (Clip verschwindet atomar)
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        let _lock = std::fs::OpenOptions::new().read(true).share_mode(0).open(t.0.join(format!("{ID}.mp4"))).unwrap();
        let left = delete_clip(&t.0, ID).unwrap();
        assert!(!t.0.join(format!("{ID}.json")).exists());
        assert_eq!(left, vec![t.0.join(format!("{ID}.mp4"))]);
        assert!(!t.0.join(format!("{ID}.jpg")).exists());
        assert!(one(&t.0).iter().all(|c| c.id != ID));
        drop(_lock);
        std::fs::remove_file(t.0.join(format!("{ID}.mp4"))).unwrap();
    }
    #[cfg(not(windows))]
    {
        assert!(delete_clip(&t.0, ID).unwrap().is_empty());
    }
    assert!(!t.0.join(format!("{ID}.mp4")).exists());
    // Der andere Clip bleibt
    assert!(t.0.join(format!("{other}.json")).exists() && t.0.join(format!("{other}.mp4")).exists());
    assert!(matches!(delete_clip(&t.0, ID), Err(AppError::NotFound(_))));
}

#[test]
fn path_checks() {
    let root = Path::new("C:/data/instances");
    assert!(clips_dir_in(root, "survival").unwrap().ends_with("survival/minecraft/vibeyclient/clips"));
    for bad in ["..", ".", "", "a/b", "a\\b", "C:", ".hidden", "../x"] {
        assert!(clips_dir_in(root, bad).is_err(), "{bad}");
    }
    assert!(plain_name("x.mp4"));
    assert!(!plain_name("../x.mp4") && !plain_name("sub/x.mp4") && !plain_name(".x.mp4") && !plain_name("C:x.mp4"));

    // Datei außerhalb des Instanzordners (z. B. über einen anderen Ordner) wird abgelehnt
    let t = TmpDir::new("paths");
    let inst = t.0.join("instances");
    let dir = clips_dir_in(&inst, "i1").unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(format!("{ID}.json")), b"{}").unwrap();
    assert!(checked_file(&inst, &dir, &format!("{ID}.json")).is_ok());
    let outside = t.0.join("outside");
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("x.json"), b"{}").unwrap();
    assert!(checked_file(&inst, &outside, "x.json").is_err());
    assert!(checked_file(&inst, &dir, "../../x.json").is_err());
    assert!(matches!(checked_file(&inst, &dir, "missing.json"), Err(AppError::NotFound(_))));
}

#[test]
fn signature_changes() {
    let t = TmpDir::new("sig");
    let dirs = vec![("i".to_string(), t.0.clone())];
    let a = signature(&dirs);
    std::fs::write(t.0.join(format!(".{ID}.json.tmp")), b"{}").unwrap();
    std::fs::write(t.0.join(format!("{ID}.mp4")), b"x").unwrap();
    assert_eq!(a, signature(&dirs), "Dotfiles und MP4 lösen nichts aus");
    std::fs::write(t.0.join(format!("{ID}.json")), b"{}").unwrap();
    let b = signature(&dirs);
    assert_ne!(a, b);
    assert_eq!(changed_instances(&a, &b), vec!["i".to_string()]);
    assert!(changed_instances(&b, &b).is_empty());
}
