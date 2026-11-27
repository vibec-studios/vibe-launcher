use super::*;
use crate::feedback::{attach, ImageInfo, LogPreview};

#[derive(Debug, Clone, Deserialize)]
pub struct ReplyDraft {
    pub ticket: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub fulfills: Vec<String>,
    #[serde(default)]
    pub instance_id: Option<String>,
    #[serde(default)]
    pub logs: Vec<String>,
    #[serde(default)]
    pub screenshots: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReplyPreview {
    pub token: String,
    pub ticket: String,
    pub body: String,
    pub logs: Vec<LogPreview>,
    pub screenshots: Vec<ImageInfo>,
    pub total_bytes: u64,
}

#[derive(Clone)]
struct PreparedReply {
    ticket: String,
    meta: Value,
    logs: Vec<(String, String)>,
    shots: Vec<(String, String, Vec<u8>)>,
    shot_ids: Vec<String>,
}

fn prepared() -> &'static Mutex<Option<(String, PreparedReply, Instant)>> {
    static P: OnceLock<Mutex<Option<(String, PreparedReply, Instant)>>> = OnceLock::new();
    P.get_or_init(Default::default)
}

pub fn meta_of(body: &str, fulfills: &[String]) -> AppResult<Value> {
    let body = body.trim();
    if body.chars().count() > BODY_MAX {
        return Err(AppError::Invalid(format!("Höchstens {BODY_MAX} Zeichen")));
    }
    if fulfills.len() > FULFILLS_MAX || fulfills.iter().any(|f| f.is_empty() || f.len() > 80) {
        return Err(AppError::Invalid("Ungültige Anfragen".into()));
    }
    Ok(json!({ "body": body, "fulfills": fulfills }))
}

pub fn log_kinds(kinds: &[String]) -> Vec<String> {
    kinds.iter().filter(|k| matches!(k.as_str(), "launcher" | "game" | "crash")).cloned().collect()
}

pub fn prepare_reply(state: &AppState, d: &ReplyDraft) -> AppResult<ReplyPreview> {
    if !valid_key(&d.ticket) {
        return Err(AppError::Invalid("Ticket-Nummer".into()));
    }
    let meta = meta_of(&d.body, &d.fulfills)?;
    let kinds = log_kinds(&d.logs);
    let c = attach::collect(state, d.instance_id.as_deref(), Some(&kinds), &d.screenshots)?;
    let body = meta["body"].as_str().unwrap_or_default().to_string();
    if c.logs.is_empty() && c.shots.is_empty() && body.is_empty() {
        return Err(AppError::Invalid("Nichts zum Senden ausgewählt".into()));
    }
    let token = uuid::Uuid::new_v4().simple().to_string();
    let total_bytes = serde_json::to_vec(&meta)?.len() as u64 + c.bytes();
    let p = PreparedReply { ticket: d.ticket.clone(), meta, logs: c.log_parts(), shots: c.shots, shot_ids: d.screenshots.clone() };
    *prepared().lock() = Some((token.clone(), p, Instant::now()));
    Ok(ReplyPreview { token, ticket: d.ticket.clone(), body, logs: c.logs, screenshots: c.images, total_bytes })
}

pub async fn send_reply(state: &AppState, token: &str) -> TicketResult<Value> {
    let p = {
        let g = prepared().lock();
        match g.as_ref() {
            Some((t, p, at)) if t == token && at.elapsed() < PREPARED_TTL => p.clone(),
            _ => return Err(TicketError::new("invalid", "preview_expired", "Die Vorschau ist abgelaufen")),
        }
    };
    let auth = auth_for(state, &p.ticket)?;
    let form = attach::multipart(&p.meta, &p.logs, &p.shots).map_err(|e| TicketError::new("invalid", "client", e.to_string()))?;
    let url = format!("{}/{}/messages", base_url(state), p.ticket);
    let rb = state.net.client.post(url).multipart(form).timeout(Duration::from_secs(60));
    let v = json_of(&exec(rb, &auth).await?)?;
    let mut g = prepared().lock();
    if g.as_ref().is_some_and(|(t, _, _)| t == token) {
        *g = None;
    }
    drop(g);
    crate::feedback::discard(&p.shot_ids);
    Ok(v)
}

pub async fn reply_text(state: &AppState, key: &str, body: &str, fulfills: &[String]) -> TicketResult<Value> {
    let meta = meta_of(body, fulfills)?;
    if meta["body"].as_str().unwrap_or_default().is_empty() {
        return Err(TicketError::new("invalid", "empty", "Nachricht fehlt"));
    }
    let auth = auth_for(state, key)?;
    let rb = state.net.client.post(format!("{}/{key}/messages", base_url(state))).json(&meta).timeout(TIMEOUT);
    json_of(&exec(rb, &auth).await?)
}
