use super::*;

#[derive(Debug, Clone, PartialEq)]
pub struct SkinRequest {
    pub id: String,
    pub skin_id: String,
    pub variant: Option<SkinVariant>,
}

#[derive(Debug, Deserialize)]
pub(super) struct RawRequest {
    pub(super) schema: Option<i64>,
    pub(super) id: Option<String>,
    pub(super) action: Option<String>,
    pub(super) skin_id: Option<String>,
    pub(super) variant: Option<String>,
    pub(super) requested_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Taken {
    Request(SkinRequest),
    Invalid(Option<String>),
}

pub fn parse_request(bytes: &[u8], now_secs: i64) -> Taken {
    let Ok(r) = serde_json::from_slice::<RawRequest>(bytes) else { return Taken::Invalid(None) };
    let id = r.id.filter(|s| !s.is_empty() && s.len() <= 100 && !s.contains(['\n', '\r']));
    let at = r.requested_at.map(|t| if t > 100_000_000_000 { t / 1000 } else { t });
    let fresh = at.is_some_and(|t| now_secs - t <= REQUEST_MAX_AGE && t - now_secs <= REQUEST_MAX_AGE);
    let variant = match r.variant.as_deref() {
        None => Some(None),
        Some("classic") => Some(Some(SkinVariant::Classic)),
        Some("slim") => Some(Some(SkinVariant::Slim)),
        Some(_) => None,
    };
    match (id, r.schema, r.action.as_deref(), r.skin_id, variant) {
        (Some(id), Some(1), Some("apply"), Some(skin_id), Some(variant)) if fresh && safe_id(&skin_id) => Taken::Request(SkinRequest { id, skin_id, variant }),
        (id, ..) => Taken::Invalid(id),
    }
}

pub fn take_request(vibe_dir: &Path, now_secs: i64) -> Option<Taken> {
    let p = vibe_dir.join(REQUEST_FILE);
    let meta = std::fs::metadata(&p).ok()?;
    let bytes = if meta.len() > 16 * 1024 { Vec::new() } else { std::fs::read(&p).ok()? };
    let _ = std::fs::remove_file(&p);
    Some(parse_request(&bytes, now_secs))
}

#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    Working,
    Ok { skin_id: String, variant: SkinVariant },
    Error { code: &'static str, message: Option<String> },
}

pub fn result_json(request_id: &str, o: &Outcome, now_secs: i64) -> Value {
    let mut v = json!({ "schema": 1, "id": request_id, "finished_at": now_secs });
    match o {
        Outcome::Working => v["status"] = "working".into(),
        Outcome::Ok { skin_id, variant } => {
            v["status"] = "ok".into();
            v["skin_id"] = Value::String(skin_id.clone());
            v["variant"] = variant.api().into();
        }
        Outcome::Error { code, message } => {
            v["status"] = "error".into();
            v["error"] = (*code).into();
            if let Some(m) = message {
                v["message"] = Value::String(m.chars().take(200).collect());
            }
        }
    }
    v
}

pub fn write_result(vibe_dir: &Path, request_id: &str, o: &Outcome, now_secs: i64) -> AppResult<()> {
    let mut data = serde_json::to_vec(&result_json(request_id, o, now_secs))?;
    data.push(b'\n');
    atomic_write(&vibe_dir.join(RESULT_FILE), &data)
}

pub fn error_code(e: &AppError) -> &'static str {
    match e {
        AppError::Auth(_) => "signed_out",
        AppError::NotConfigured(_) => "no_account",
        AppError::NotFound(w) if w.starts_with("Skin") && !w.contains("Cape") => "not_found",
        AppError::NotFound(w) if w == "Account" => "no_account",
        AppError::Http(_) | AppError::Unreachable(_) => "network",
        AppError::Msg(m) if m.contains("Zu viele Skin") => "rate_limited",
        AppError::Invalid(_) | AppError::NotFound(_) => "mojang",
        AppError::Msg(m) if m.contains("Minecraft") || m.contains("HTTP") => "mojang",
        _ => "other",
    }
}
