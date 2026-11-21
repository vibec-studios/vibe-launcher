//! Clip-Editor (Vertrag 14, CLIPS.md §15): Schnitt `trim` nicht-destruktiv speichern und als neuen Clip exportieren.
//! Export ohne Neukodierung (`-c copy`) mit dem FFmpeg, das der Vibey Client in die Instanz geladen hat
//! (`vibeyclient/ffmpeg/bin`), sonst FFmpeg aus dem PATH. Der Schnitt beginnt am letzten Keyframe vor dem Wunschstart.
use super::clips::{self, checked_clip, int_field, parse_clip, str_field, valid_id, Clip, Parsed, TrimRange, SCHEMA};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use tauri::State;

fn read_obj(dir: &Path, id: &str) -> AppResult<Map<String, Value>> {
    let bytes = std::fs::read(dir.join(format!("{id}.json"))).map_err(|_| AppError::NotFound("Clip".into()))?;
    let Value::Object(o) = serde_json::from_slice::<Value>(&bytes)? else {
        return Err(AppError::Invalid("Clip-Metadaten".into()));
    };
    if o.get("schema").and_then(Value::as_i64) != Some(SCHEMA) {
        return Err(AppError::Invalid("Unbekannte Clip-Version".into()));
    }
    Ok(o)
}

fn write_obj(dir: &Path, id: &str, o: Map<String, Value>) -> AppResult<()> {
    let path = dir.join(format!("{id}.json"));
    let tmp = dir.join(format!(".{id}.json.tmp"));
    let mut data = serde_json::to_vec_pretty(&Value::Object(o))?;
    data.push(b'\n');
    std::fs::write(&tmp, &data)?;
    if let Err(e) = std::fs::rename(&tmp, &path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

pub fn valid_trim(r: TrimRange, duration_ms: Option<i64>) -> bool {
    r.in_ms >= 0 && r.in_ms < r.out_ms && duration_ms.is_none_or(|d| r.out_ms <= d)
}

pub fn set_trim(dir: &Path, id: &str, trim: Option<TrimRange>) -> AppResult<()> {
    if !valid_id(id) {
        return Err(AppError::Invalid("Clip-ID".into()));
    }
    let mut o = read_obj(dir, id)?;
    match trim {
        Some(r) => {
            if !valid_trim(r, int_field(&o, "duration_ms")) {
                return Err(AppError::Invalid("Ungültiger Schnittbereich".into()));
            }
            o.insert("trim".into(), serde_json::json!({ "in_ms": r.in_ms, "out_ms": r.out_ms }));
        }
        None => {
            o.remove("trim");
        }
    }
    write_obj(dir, id, o)
}

pub fn keyframe_start(keyframes: &[i64], in_ms: i64) -> i64 {
    keyframes.iter().copied().filter(|k| *k <= in_ms).max().unwrap_or(if keyframes.is_empty() { in_ms } else { 0 })
}

fn shift_list(o: &Map<String, Value>, k: &str, start: i64, end: i64) -> Option<Value> {
    let a = o.get(k)?.as_array()?;
    let v: Vec<Value> = a
        .iter()
        .filter_map(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f as i64)))
        .filter(|t| *t >= start && *t < end)
        .map(|t| Value::from(t - start))
        .collect();
    (!v.is_empty()).then_some(Value::Array(v))
}

pub fn edited_meta(orig: &Map<String, Value>, source_id: &str, new_id: &str, start: i64, end: i64, size: u64, has_thumb: bool, created_at: &str) -> Map<String, Value> {
    let mut o = orig.clone();
    for k in ["rewind", "trim_hint", "trim", "kept", "keyframes_ms", "cuts_ms", "events", "highlight_ms", "thumbnail", "video"] {
        o.remove(k);
    }
    o.insert("schema".into(), Value::from(SCHEMA));
    o.insert("id".into(), Value::String(new_id.into()));
    o.insert("reason".into(), Value::String("edit".into()));
    o.insert("source_id".into(), Value::String(source_id.into()));
    o.insert("created_at".into(), Value::String(created_at.into()));
    o.insert("duration_ms".into(), Value::from(end - start));
    o.insert("size_bytes".into(), Value::from(size));
    o.insert("video".into(), Value::String(format!("{new_id}.mp4")));
    if has_thumb {
        o.insert("thumbnail".into(), Value::String(format!("{new_id}.jpg")));
    }
    o.insert("kept".into(), Value::Bool(false));
    if orig.get("keyframes_ms").is_some() {
        if let Some(k) = shift_list(orig, "keyframes_ms", start, end) {
            o.insert("keyframes_ms".into(), k);
        }
    }
    if let Some(c) = shift_list(orig, "cuts_ms", start, end) {
        o.insert("cuts_ms".into(), c);
    }
    if let Some(ev) = orig.get("events").and_then(Value::as_array) {
        let shifted: Vec<Value> = ev
            .iter()
            .filter_map(|e| {
                let mut e = e.as_object()?.clone();
                let t = int_field(&e, "t_ms")?;
                if t < start || t >= end {
                    return None;
                }
                e.insert("t_ms".into(), Value::from(t - start));
                Some(Value::Object(e))
            })
            .collect();
        if !shifted.is_empty() {
            let kills = shifted.iter().filter(|e| e.get("type").and_then(Value::as_str) == Some("kill")).count();
            if o.contains_key("kills") {
                o.insert("kills".into(), Value::from(kills));
            }
            o.insert("events".into(), Value::Array(shifted));
        } else if o.contains_key("kills") {
            o.remove("kills");
        }
    }
    if let Some(h) = int_field(orig, "highlight_ms").filter(|h| *h >= start && *h < end) {
        o.insert("highlight_ms".into(), Value::from(h - start));
    }
    o
}

pub fn new_edit_id(dir: &Path, now: chrono::DateTime<chrono::Local>) -> String {
    let base = format!("{}_edit", now.format("%Y-%m-%d_%H-%M-%S"));
    let free = |id: &str| !dir.join(format!("{id}.json")).exists() && !dir.join(format!("{id}.mp4")).exists();
    if free(&base) {
        return base;
    }
    (2..1000).map(|n| format!("{base}_{n}")).find(|id| free(id)).unwrap_or(base)
}

fn exe(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

fn on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|d| d.join(exe(name))).find(|p| p.is_file())
}

pub fn find_ffmpeg(clips_dir: &Path, others: &[PathBuf]) -> Option<PathBuf> {
    let own = clips_dir.parent().map(|vc| vc.join("ffmpeg").join("bin").join(exe("ffmpeg")));
    own.into_iter()
        .chain(others.iter().map(|d| d.join("ffmpeg").join("bin").join(exe("ffmpeg"))))
        .find(|p| p.is_file())
        .or_else(|| on_path("ffmpeg"))
        .or_else(|| ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"].iter().map(PathBuf::from).find(|p| p.is_file()))
}

fn secs(ms: i64) -> String {
    format!("{}.{:03}", ms / 1000, ms % 1000)
}

fn run_ffmpeg(ffmpeg: &Path, args: &[String]) -> AppResult<()> {
    let mut cmd = std::process::Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y"]).args(args).stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(crate::minecraft::java::CREATE_NO_WINDOW);
    }
    let out = cmd.output()?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let line = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").chars().take(200).collect::<String>();
        return Err(AppError::msg(format!("FFmpeg-Fehler: {line}")));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct ClipExport {
    pub clip: Clip,
    pub start_ms: i64,
    pub original_deleted: bool,
}

pub fn export(dir: &Path, instance_id: &str, id: &str, range: TrimRange, ffmpeg: &Path, delete_original: bool) -> AppResult<ClipExport> {
    let orig = read_obj(dir, id)?;
    let duration = int_field(&orig, "duration_ms");
    if !valid_trim(range, duration) {
        return Err(AppError::Invalid("Ungültiger Schnittbereich".into()));
    }
    let video_name = str_field(&orig, "video").filter(|n| clips::plain_name(n)).unwrap_or_else(|| format!("{id}.mp4"));
    let src = dir.join(&video_name);
    if !src.is_file() {
        return Err(AppError::NotFound("Clip-Video".into()));
    }
    let keyframes: Vec<i64> = match parse_clip(instance_id, dir, id) {
        Parsed::Ok(c) => c.keyframes_ms,
        _ => Vec::new(),
    };
    let start = keyframe_start(&keyframes, range.in_ms);
    let end = range.out_ms;
    let new_id = new_edit_id(dir, chrono::Local::now());
    let tmp_mp4 = dir.join(format!(".{new_id}.tmp.mp4"));
    let tmp_jpg = dir.join(format!(".{new_id}.tmp.jpg"));
    let cleanup = || {
        let _ = std::fs::remove_file(&tmp_mp4);
        let _ = std::fs::remove_file(&tmp_jpg);
    };
    let args: Vec<String> = vec![
        "-ss".into(),
        secs(start),
        "-to".into(),
        secs(end),
        "-i".into(),
        src.to_string_lossy().into(),
        "-map".into(),
        "0".into(),
        "-c".into(),
        "copy".into(),
        "-avoid_negative_ts".into(),
        "make_zero".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-f".into(),
        "mp4".into(),
        tmp_mp4.to_string_lossy().into(),
    ];
    if let Err(e) = run_ffmpeg(ffmpeg, &args) {
        cleanup();
        return Err(e);
    }
    let size = std::fs::metadata(&tmp_mp4).map(|m| m.len()).unwrap_or(0);
    if size == 0 {
        cleanup();
        return Err(AppError::msg("FFmpeg hat kein Video geschrieben"));
    }
    let thumb_at = int_field(&orig, "highlight_ms").filter(|h| *h >= start && *h < end).map(|h| h - start).unwrap_or(0);
    let thumb_args: Vec<String> = vec![
        "-ss".into(),
        secs(thumb_at),
        "-i".into(),
        tmp_mp4.to_string_lossy().into(),
        "-frames:v".into(),
        "1".into(),
        "-vf".into(),
        "scale=480:-2".into(),
        "-q:v".into(),
        "4".into(),
        "-f".into(),
        "image2".into(),
        tmp_jpg.to_string_lossy().into(),
    ];
    let has_thumb = run_ffmpeg(ffmpeg, &thumb_args).is_ok() && tmp_jpg.is_file();
    let mp4 = dir.join(format!("{new_id}.mp4"));
    let jpg = dir.join(format!("{new_id}.jpg"));
    if let Err(e) = std::fs::rename(&tmp_mp4, &mp4) {
        cleanup();
        return Err(e.into());
    }
    if has_thumb && std::fs::rename(&tmp_jpg, &jpg).is_err() {
        let _ = std::fs::remove_file(&tmp_jpg);
    }
    let meta = edited_meta(&orig, id, &new_id, start, end, size, jpg.is_file(), &chrono::Local::now().to_rfc3339());
    if let Err(e) = write_obj(dir, &new_id, meta) {
        let _ = std::fs::remove_file(&mp4);
        let _ = std::fs::remove_file(&jpg);
        return Err(e);
    }
    let clip = match parse_clip(instance_id, dir, &new_id) {
        Parsed::Ok(c) => *c,
        _ => return Err(AppError::msg("Neuer Clip nicht lesbar")),
    };
    let original_deleted = delete_original && clips::delete_clip(dir, id).is_ok();
    Ok(ClipExport { clip, start_ms: start, original_deleted })
}

fn ffmpeg_for(state: &AppState, dir: &Path) -> Option<PathBuf> {
    let root = state.paths.instances();
    let others: Vec<PathBuf> = state
        .instances
        .list()
        .into_iter()
        .filter_map(|i| clips::clips_dir_in(&root, &i.id).ok().and_then(|d| d.parent().map(Path::to_path_buf)))
        .collect();
    find_ffmpeg(dir, &others)
}

#[tauri::command]
pub async fn clip_set_trim(state: State<'_, AppState>, instance_id: String, id: String, trim: Option<TrimRange>) -> AppResult<Clip> {
    let dir = checked_clip(&state, &instance_id, &id)?;
    tokio::task::spawn_blocking(move || -> AppResult<Clip> {
        set_trim(&dir, &id, trim)?;
        match parse_clip(&instance_id, &dir, &id) {
            Parsed::Ok(c) => Ok(*c),
            _ => Err(AppError::NotFound("Clip".into())),
        }
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub async fn clip_export_available(state: State<'_, AppState>, instance_id: String, id: String) -> AppResult<bool> {
    let dir = checked_clip(&state, &instance_id, &id)?;
    Ok(ffmpeg_for(&state, &dir).is_some())
}

#[tauri::command]
pub async fn clip_export_trim(
    state: State<'_, AppState>,
    instance_id: String,
    id: String,
    in_ms: i64,
    out_ms: i64,
    delete_original: Option<bool>,
) -> AppResult<ClipExport> {
    let dir = checked_clip(&state, &instance_id, &id)?;
    let ffmpeg = ffmpeg_for(&state, &dir).ok_or_else(|| AppError::NotConfigured("FFmpeg".into()))?;
    let r = tokio::task::spawn_blocking(move || export(&dir, &instance_id, &id, TrimRange { in_ms, out_ms }, &ffmpeg, delete_original.unwrap_or(false)))
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
    crate::events::emit(&state.app, crate::events::CLIPS_CHANGED, &clips::ClipsChanged { instance_ids: vec![r.clip.instance_id.clone()] });
    Ok(r)
}

#[cfg(test)]
mod tests {
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
    fn buffer_dir_is_not_scanned() {
        let d = tmp("buffer");
        std::fs::create_dir_all(d.join(".buffer").join("s1")).unwrap();
        std::fs::write(d.join(".buffer").join("s1").join("s1-0.ts"), vec![0u8; 1000]).unwrap();
        assert!(clips::clips_list_for_test(&d).is_empty());
        let _ = std::fs::remove_dir_all(d);
    }
}
