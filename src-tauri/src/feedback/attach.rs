use super::*;

pub struct Collected {
    pub logs: Vec<LogPreview>,
    pub images: Vec<ImageInfo>,
    pub shots: Vec<(String, String, Vec<u8>)>,
}

impl Collected {
    pub fn log_parts(&self) -> Vec<(String, String)> {
        self.logs.iter().map(|l| (l.name.clone(), l.text.clone())).collect()
    }

    pub fn bytes(&self) -> u64 {
        self.logs.iter().map(|l| l.bytes).sum::<u64>() + self.shots.iter().map(|s| s.2.len() as u64).sum::<u64>()
    }
}

pub fn collect(state: &AppState, instance_id: Option<&str>, kinds: Option<&[String]>, shot_ids: &[String]) -> AppResult<Collected> {
    let mut logs = Vec::new();
    if kinds.map_or(true, |k| !k.is_empty()) {
        let known = redact::Known::from_env();
        for src in sources(state, instance_id) {
            if kinds.is_some_and(|k| !k.iter().any(|x| x == src.kind)) {
                continue;
            }
            match read_cut(&src.path, LOG_MAX_BYTES, src.cut) {
                Ok((raw, len, cut)) if !raw.trim().is_empty() => logs.push(clean_log(&src.name, &raw, len, cut, &known)),
                Ok(_) => {}
                Err(e) => tracing::warn!("Feedback: {} nicht lesbar: {e}", src.name),
            }
        }
    }

    if shot_ids.len() > MAX_FILES {
        return Err(AppError::Invalid(format!("Höchstens {MAX_FILES} Screenshots.")));
    }
    let h = held().lock();
    let mut shots = Vec::new();
    let mut images = Vec::new();
    for id in shot_ids {
        let img = h.get(id).ok_or_else(|| AppError::NotFound("Screenshot (bitte erneut hinzufügen)".into()))?;
        let thumb = image::load_from_memory(&img.bytes).ok().and_then(|i| thumbnail(&i).ok().map(|t| (t, i.width(), i.height())));
        let (thumb, width, height) = thumb.unwrap_or_default();
        images.push(ImageInfo { id: id.clone(), name: img.name.clone(), mime: img.mime.clone(), bytes: img.bytes.len() as u64, width, height, thumb });
        shots.push((img.name.clone(), img.mime.clone(), img.bytes.clone()));
    }
    Ok(Collected { logs, images, shots })
}

pub fn multipart(meta: &Value, logs: &[(String, String)], shots: &[(String, String, Vec<u8>)]) -> Result<reqwest::multipart::Form, reqwest::Error> {
    use reqwest::multipart::{Form, Part};
    let mut form = Form::new().part("meta", Part::text(meta.to_string()).mime_str("application/json")?);
    for (name, text) in logs {
        form = form.part("log", Part::bytes(text.clone().into_bytes()).file_name(name.clone()).mime_str("text/plain")?);
    }
    for (name, mime, bytes) in shots {
        form = form.part("screenshot", Part::bytes(bytes.clone()).file_name(name.clone()).mime_str(mime)?);
    }
    Ok(form)
}
