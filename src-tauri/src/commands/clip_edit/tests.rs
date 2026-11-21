use super::*;
use serde_json::json;

fn tmp(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("vl-clipedit-{tag}-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn keyframe_floor() {
    assert_eq!(keyframe_start(&[0, 2000, 4000], 3999), 2000);
    assert_eq!(keyframe_start(&[0, 2000, 4000], 4000), 4000);
    assert_eq!(keyframe_start(&[], 1234), 1234);
}

#[test]
fn trim_written_and_removed_keeps_unknown() {
    let d = tmp("trim");
    let id = "2026-11-21_20-15-02_hotkey";
    std::fs::write(d.join(format!("{id}.json")), json!({"schema":1,"id":id,"duration_ms":10000,"foo":{"x":1},"trim_hint":{"in_ms":2000,"out_ms":10000}}).to_string()).unwrap();
    set_trim(&d, id, Some(TrimRange { in_ms: 1000, out_ms: 9000 })).unwrap();
    let v: Value = serde_json::from_slice(&std::fs::read(d.join(format!("{id}.json"))).unwrap()).unwrap();
    assert_eq!(v["trim"], json!({"in_ms":1000,"out_ms":9000}));
    assert_eq!(v["foo"], json!({"x":1}));
    assert_eq!(v["trim_hint"]["in_ms"], 2000);
    assert!(set_trim(&d, id, Some(TrimRange { in_ms: 1000, out_ms: 11000 })).is_err());
    assert!(set_trim(&d, id, Some(TrimRange { in_ms: 5000, out_ms: 5000 })).is_err());
    set_trim(&d, id, None).unwrap();
    let v: Value = serde_json::from_slice(&std::fs::read(d.join(format!("{id}.json"))).unwrap()).unwrap();
    assert!(v.get("trim").is_none());
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn meta_of_edit() {
    let o = json!({
        "schema":1,"id":"a","reason":"hotkey","rewind":true,"duration_ms":300000,"kept":true,"title":"T","kills":2,
        "keyframes_ms":[0,2000,4000,6000,8000],"cuts_ms":[1000,5000],"trim_hint":{"in_ms":4000,"out_ms":8000},
        "events":[{"t_ms":1000,"type":"kill"},{"t_ms":5000,"type":"kill","victim":"x"},{"t_ms":7000,"type":"death"}],
        "highlight_ms":5000,"extra":"keep","thumbnail":"a.jpg","video":"a.mp4"
    });
    let m = edited_meta(o.as_object().unwrap(), "a", "b_edit", 4000, 8000, 123, true, "2026-11-21T10:00:00+01:00");
    let v = Value::Object(m);
    assert_eq!(v["reason"], "edit");
    assert_eq!(v["source_id"], "a");
    assert_eq!(v["duration_ms"], 4000);
    assert_eq!(v["kept"], false);
    assert!(v.get("rewind").is_none() && v.get("trim_hint").is_none());
    assert_eq!(v["keyframes_ms"], json!([0, 2000]));
    assert_eq!(v["cuts_ms"], json!([1000]));
    assert_eq!(v["events"], json!([{"t_ms":1000,"type":"kill","victim":"x"},{"t_ms":3000,"type":"death"}]));
    assert_eq!(v["kills"], 1);
    assert_eq!(v["highlight_ms"], 1000);
    assert_eq!(v["extra"], "keep");
    assert_eq!(v["title"], "T");
    assert_eq!(v["video"], "b_edit.mp4");
    assert_eq!(v["thumbnail"], "b_edit.jpg");
}

#[test]
fn edit_ids_unique_and_valid() {
    let d = tmp("ids");
    let now = chrono::Local::now();
    let a = new_edit_id(&d, now);
    assert!(valid_id(&a));
    std::fs::write(d.join(format!("{a}.json")), "{}").unwrap();
    let b = new_edit_id(&d, now);
    assert!(valid_id(&b) && b != a && b.ends_with("_2"));
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn export_with_real_ffmpeg() {
    let d = tmp("ffmpeg");
    let Some(ff) = find_ffmpeg(&d, &[]) else { return };
    let id = "2026-11-21_20-15-02_hotkey";
    let gen: Vec<String> = ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-t", "6", "-c:v", "libx264", "-g", "60", "-pix_fmt", "yuv420p"]
        .iter()
        .map(|s| s.to_string())
        .chain([d.join(format!("{id}.mp4")).to_string_lossy().to_string()])
        .collect();
    if run_ffmpeg(&ff, &gen).is_err() {
        return;
    }
    std::fs::write(
        d.join(format!("{id}.json")),
        json!({"schema":1,"id":id,"reason":"hotkey","rewind":true,"duration_ms":6000,"keyframes_ms":[0,2000,4000],"events":[{"t_ms":4500,"type":"kill"}],"kept":true}).to_string(),
    )
    .unwrap();
    let r = export(&d, "i", id, TrimRange { in_ms: 2500, out_ms: 5000 }, &ff, false).unwrap();
    assert_eq!(r.start_ms, 2000);
    assert_eq!(r.clip.reason, "edit");
    assert_eq!(r.clip.source_id.as_deref(), Some(id));
    assert_eq!(r.clip.duration_ms, Some(3000));
    assert_eq!(r.clip.keyframes_ms, vec![0, 2000]);
    assert_eq!(r.clip.events[0].t_ms, 2500);
    assert!(!r.clip.kept && !r.clip.rewind);
    assert!(r.clip.thumbnail_path.is_some());
    assert!(std::fs::metadata(&r.clip.video_path).unwrap().len() > 1000);
    assert!(d.join(format!("{id}.json")).is_file());
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn buffer_dir_is_not_scanned() {
    let d = tmp("buffer");
    std::fs::create_dir_all(d.join(".buffer").join("s1")).unwrap();
    std::fs::write(d.join(".buffer").join("s1").join("s1-0.ts"), vec![0u8; 1000]).unwrap();
    assert!(clips::clips_list_for_test(&d).is_empty());
    let _ = std::fs::remove_dir_all(d);
}
