use super::*;

#[derive(Debug, Default)]
pub struct ClipEdit {
    pub kept: Option<bool>,
    /// `Some("")` entfernt den Titel
    pub title: Option<String>,
    /// `Some(vec![])` entfernt die Tags
    pub tags: Option<Vec<String>>,
}

pub(super) fn normalize_edit(e: ClipEdit) -> AppResult<ClipEdit> {
    let title = match e.title {
        Some(t) => {
            let t = t.trim().to_string();
            if t.chars().count() > TITLE_MAX {
                return Err(AppError::Invalid(format!("Titel länger als {TITLE_MAX} Zeichen")));
            }
            Some(t)
        }
        None => None,
    };
    let tags = match e.tags {
        Some(list) => {
            let mut out: Vec<String> = Vec::new();
            for t in list {
                let t = t.trim().to_string();
                if t.is_empty() || out.iter().any(|x| x.eq_ignore_ascii_case(&t)) {
                    continue;
                }
                if t.chars().count() > TAG_MAX {
                    return Err(AppError::Invalid(format!("Tag länger als {TAG_MAX} Zeichen")));
                }
                out.push(t);
            }
            if out.len() > TAGS_MAX {
                return Err(AppError::Invalid(format!("Höchstens {TAGS_MAX} Tags")));
            }
            Some(out)
        }
        None => None,
    };
    Ok(ClipEdit { kept: e.kept, title, tags })
}

/// Nur `kept`, `title`, `tags` setzen, alles andere (auch unbekannte Felder) behalten; atomar über
/// `.<id>.json.tmp` + Umbenennen. Leere Werte werden weggelassen statt `null` (wie im Spiel).
pub(super) fn apply_edit(dir: &Path, id: &str, edit: ClipEdit) -> AppResult<()> {
    if !valid_id(id) {
        return Err(AppError::Invalid("Clip-ID".into()));
    }
    let edit = normalize_edit(edit)?;
    let path = dir.join(format!("{id}.json"));
    let bytes = std::fs::read(&path).map_err(|_| AppError::NotFound("Clip".into()))?;
    let Value::Object(mut o) = serde_json::from_slice::<Value>(&bytes)? else {
        return Err(AppError::Invalid("Clip-Metadaten".into()));
    };
    if o.get("schema").and_then(Value::as_i64) != Some(SCHEMA) {
        return Err(AppError::Invalid("Unbekannte Clip-Version".into()));
    }
    if let Some(k) = edit.kept {
        o.insert("kept".into(), Value::Bool(k));
    }
    if let Some(t) = edit.title {
        if t.is_empty() {
            o.remove("title");
        } else {
            o.insert("title".into(), Value::String(t));
        }
    }
    if let Some(tags) = edit.tags {
        if tags.is_empty() {
            o.remove("tags");
        } else {
            o.insert("tags".into(), Value::Array(tags.into_iter().map(Value::String).collect()));
        }
    }
    let tmp = dir.join(format!(".{id}.json.tmp"));
    let mut data = serde_json::to_vec_pretty(&Value::Object(o))?;
    data.push(b'\n');
    std::fs::write(&tmp, &data)?;
    // std::fs::rename ersetzt unter Windows (MoveFileEx REPLACE_EXISTING) und Unix atomar
    if let Err(e) = std::fs::rename(&tmp, &path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

/// Datei löschen, bei Sperre (Player hält sie offen) kurz erneut versuchen. Fehlende Dateien sind ok.
pub(super) fn remove_retry(p: &Path, tries: u32) -> std::io::Result<()> {
    let mut n = 0;
    loop {
        match std::fs::remove_file(p) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) if n + 1 >= tries => return Err(e),
            Err(_) => {
                n += 1;
                std::thread::sleep(Duration::from_millis(250));
            }
        }
    }
}

/// Löschen in Vertragsreihenfolge: `<id>.json` zuerst (der Clip verschwindet für alle Leser auf einmal), dann Video
/// und Vorschaubild. Bleibt eine gesperrte MP4/JPG übrig, räumt das Spiel sie beim nächsten Start als Waise auf.
/// Rückgabe: Dateien, die (noch) nicht gelöscht werden konnten.
pub(crate) fn delete_clip(dir: &Path, id: &str) -> AppResult<Vec<PathBuf>> {
    if !valid_id(id) {
        return Err(AppError::Invalid("Clip-ID".into()));
    }
    let json = dir.join(format!("{id}.json"));
    // Namen aus der JSON (falls lesbar), sonst Standardnamen
    let (video, thumb) = std::fs::read(&json)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v.as_object().cloned())
        .map(|o| (str_field(&o, "video"), str_field(&o, "thumbnail")))
        .unwrap_or((None, None));
    if !json.is_file() {
        return Err(AppError::NotFound("Clip".into()));
    }
    std::fs::remove_file(&json)?;
    let mut files = vec![dir.join(format!("{id}.mp4")), dir.join(format!("{id}.jpg"))];
    for n in [video, thumb].into_iter().flatten().filter(|n| plain_name(n)) {
        let p = dir.join(n);
        if !files.contains(&p) {
            files.push(p);
        }
    }
    let mut left = Vec::new();
    for f in files {
        if remove_retry(&f, 4).is_err() {
            left.push(f);
        }
    }
    Ok(left)
}
