use super::*;

pub(crate) fn str_field(o: &Map<String, Value>, k: &str) -> Option<String> {
    o.get(k).and_then(Value::as_str).map(str::to_string)
}
pub(crate) fn int_field(o: &Map<String, Value>, k: &str) -> Option<i64> {
    o.get(k).and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
}

/// Zeit aus der id (`YYYY-MM-DD_HH-mm-ss`, lokale Zeit).
pub(super) fn time_from_id(id: &str) -> Option<i64> {
    let dt = chrono::NaiveDateTime::parse_from_str(id.get(..19)?, "%Y-%m-%d_%H-%M-%S").ok()?;
    Some(dt.and_local_timezone(chrono::Local).earliest()?.timestamp_millis())
}

#[derive(Debug)]
pub(crate) enum Parsed {
    Ok(Box<Clip>),
    /// Kein Clip (höheres Schema, fehlendes Video, falsche id …) – nicht erneut versuchen
    Skip,
    /// JSON (noch) nicht lesbar – einmal nach 200 ms erneut versuchen
    Broken,
}

/// `<id>.json` lesen. `dir` ist der Clip-Ordner, `id` bereits gegen das Regex geprüft.
pub(crate) fn parse_clip(instance_id: &str, dir: &Path, id: &str) -> Parsed {
    let json = dir.join(format!("{id}.json"));
    let Ok(bytes) = std::fs::read(&json) else { return Parsed::Broken };
    let Ok(Value::Object(o)) = serde_json::from_slice::<Value>(&bytes) else { return Parsed::Broken };
    match o.get("schema").and_then(Value::as_i64) {
        Some(SCHEMA) => {}
        _ => return Parsed::Skip,
    }
    // Das Video muss existieren – sonst ist es (noch) kein Clip
    let video_name = str_field(&o, "video").unwrap_or_else(|| format!("{id}.mp4"));
    if !plain_name(&video_name) {
        return Parsed::Skip;
    }
    let video = dir.join(&video_name);
    let Ok(vmeta) = std::fs::metadata(&video) else { return Parsed::Skip };
    if !vmeta.is_file() {
        return Parsed::Skip;
    }
    let thumbnail = str_field(&o, "thumbnail")
        .filter(|n| plain_name(n))
        .map(|n| dir.join(n))
        .filter(|p| p.is_file());

    let created_at = str_field(&o, "created_at")
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
        .map(|d| d.timestamp_millis())
        .or_else(|| time_from_id(id))
        .or_else(|| {
            vmeta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64)
        })
        .unwrap_or(0);

    let events = o
        .get("events")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|e| {
                    let e = e.as_object()?;
                    Some(ClipEvent { t_ms: int_field(e, "t_ms")?, kind: str_field(e, "type")?, victim: str_field(e, "victim") })
                })
                .take(64)
                .collect()
        })
        .unwrap_or_default();
    let player = o.get("player").and_then(Value::as_object).map(|p| ClipPlayer { name: str_field(p, "name"), uuid: str_field(p, "uuid") });
    let tags = o
        .get("tags")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|t| t.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    Parsed::Ok(Box::new(Clip {
        instance_id: instance_id.to_string(),
        id: id.to_string(),
        video_path: video.to_string_lossy().to_string(),
        thumbnail_path: thumbnail.map(|p| p.to_string_lossy().to_string()),
        created_at,
        duration_ms: int_field(&o, "duration_ms"),
        size_bytes: int_field(&o, "size_bytes").map(|n| n.max(0) as u64).or(Some(vmeta.len())),
        width: int_field(&o, "width").map(|n| n.max(0) as u32),
        height: int_field(&o, "height").map(|n| n.max(0) as u32),
        fps: o.get("fps").and_then(Value::as_f64),
        reason: str_field(&o, "reason").unwrap_or_default(),
        kills: int_field(&o, "kills"),
        highlight_ms: int_field(&o, "highlight_ms"),
        events,
        player,
        mode: str_field(&o, "mode"),
        server: str_field(&o, "server"),
        world: str_field(&o, "world"),
        minecraft: str_field(&o, "minecraft"),
        loader: str_field(&o, "loader"),
        client_version: str_field(&o, "client_version"),
        encoder: str_field(&o, "encoder"),
        video_codec: str_field(&o, "video_codec"),
        audio_codec: str_field(&o, "audio_codec"),
        kept: o.get("kept").and_then(Value::as_bool).unwrap_or(false),
        title: str_field(&o, "title").filter(|s| !s.trim().is_empty()),
        tags,
        keyframes_ms: ms_list(&o, "keyframes_ms", 2000),
        cuts_ms: ms_list(&o, "cuts_ms", 500),
        rewind: o.get("rewind").and_then(Value::as_bool).unwrap_or(false),
        trim_hint: trim_field(&o, "trim_hint"),
        trim: trim_field(&o, "trim"),
        source_id: str_field(&o, "source_id").filter(|s| valid_id(s)),
    }))
}

/// Ids aller Kandidaten (`<id>.json` mit gültiger id; Dotfiles, `.tmp/`, `.buffer/` und andere Dateien fallen raus).
pub(super) fn candidate_ids(dir: &Path) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    rd.flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let id = name.strip_suffix(".json")?;
            (valid_id(id) && e.file_type().ok()?.is_file()).then(|| id.to_string())
        })
        .collect()
}

/// Alle Clips der Ordner. Nicht lesbare JSONs werden einmal nach `retry` erneut versucht, dann übersprungen
/// (nie gelöscht – das Spiel schreibt sie evtl. gerade).
pub(super) fn scan(dirs: &[(String, PathBuf)], retry: Duration) -> Vec<Clip> {
    let mut out = Vec::new();
    let mut broken = Vec::new();
    for (iid, dir) in dirs {
        for id in candidate_ids(dir) {
            match parse_clip(iid, dir, &id) {
                Parsed::Ok(c) => out.push(*c),
                Parsed::Skip => {}
                Parsed::Broken => broken.push((iid, dir, id)),
            }
        }
    }
    if !broken.is_empty() {
        std::thread::sleep(retry);
        for (iid, dir, id) in broken {
            if let Parsed::Ok(c) = parse_clip(iid, dir, &id) {
                out.push(*c);
            }
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| b.id.cmp(&a.id)));
    out
}

#[cfg(test)]
pub(crate) fn clips_list_for_test(dir: &Path) -> Vec<Clip> {
    scan(&[("i".into(), dir.to_path_buf())], Duration::ZERO)
}
