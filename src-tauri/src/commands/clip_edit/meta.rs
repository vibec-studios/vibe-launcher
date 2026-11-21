use super::*;

pub(super) fn read_obj(dir: &Path, id: &str) -> AppResult<Map<String, Value>> {
    let bytes = std::fs::read(dir.join(format!("{id}.json"))).map_err(|_| AppError::NotFound("Clip".into()))?;
    let Value::Object(o) = serde_json::from_slice::<Value>(&bytes)? else {
        return Err(AppError::Invalid("Clip-Metadaten".into()));
    };
    if o.get("schema").and_then(Value::as_i64) != Some(SCHEMA) {
        return Err(AppError::Invalid("Unbekannte Clip-Version".into()));
    }
    Ok(o)
}

pub(super) fn write_obj(dir: &Path, id: &str, o: Map<String, Value>) -> AppResult<()> {
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

pub(super) fn shift_list(o: &Map<String, Value>, k: &str, start: i64, end: i64) -> Option<Value> {
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
