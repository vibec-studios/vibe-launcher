use super::*;
use base64::Engine;

#[derive(Debug, Clone, Serialize)]
pub struct TicketList {
    pub items: Vec<Value>,
    pub account: bool,
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AttachmentData {
    pub mime: String,
    pub text: Option<String>,
    pub data_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChatReport {
    pub chat_id: String,
    #[serde(default)]
    pub message_ids: Vec<String>,
    pub reason: String,
    #[serde(default)]
    pub details: Option<String>,
    #[serde(default)]
    pub locale: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Created {
    pub id: String,
    pub ticket: String,
}

const REASONS: [&str; 7] = ["spam", "harassment", "cheating", "inappropriate", "impersonation", "malware", "other"];

pub fn merge(account: Vec<Value>, local: Vec<Value>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for (v, is_local) in account.into_iter().map(|v| (v, false)).chain(local.into_iter().map(|v| (v, true))) {
        let mut v = sanitize(v);
        let Some(id) = v["id"].as_str().map(str::to_string) else { continue };
        if let Some(&i) = index.get(&id) {
            if is_local {
                out[i]["local"] = json!(true);
            }
            continue;
        }
        v["local"] = json!(is_local);
        index.insert(id, out.len());
        out.push(v);
    }
    out.sort_by(|a, b| iso_ms(&b["lastActivityAt"]).cmp(&iso_ms(&a["lastActivityAt"])));
    out
}

pub async fn list(state: &AppState, background: bool) -> TicketResult<TicketList> {
    let client = &state.net.client;
    let base = base_url(state);
    let saved = saved(state);
    let bearer = bearer(state);
    let mut account = Vec::new();
    if let Some(b) = &bearer {
        let rb = client.get(&base).query(&[("limit", "100")]).timeout(TIMEOUT);
        let v = json_of(&exec(rb, &Auth { bearer: Some(b.clone()), ticket: None }).await?)?;
        account = v["items"].as_array().cloned().unwrap_or_default();
    }
    let now = chrono::Utc::now().timestamp_millis();
    let tokens = poll_tokens(&saved, &known().lock().clone(), now, background);
    let mut local = Vec::new();
    let mut unknown = Vec::new();
    for chunk in tokens.chunks(LOOKUP_BATCH) {
        let rb = client.post(format!("{base}/lookup")).json(&json!({ "tokens": chunk })).timeout(TIMEOUT);
        let v = json_of(&exec(rb, &Auth::default()).await?)?;
        local.extend(v["items"].as_array().cloned().unwrap_or_default());
        unknown.extend(v["unknown"].as_array().into_iter().flatten().filter_map(|t| t.as_str().map(str::to_string)));
    }
    if let Err(e) = forget(state, &unknown) {
        tracing::warn!("Tickets: unbekannte Zugänge nicht entfernt: {e}");
    }
    let items = merge(account, local);
    note(&items);
    Ok(TicketList { items, account: bearer.is_some(), complete: tokens.len() == saved.len() })
}

pub async fn get(state: &AppState, key: &str, after: Option<i64>) -> TicketResult<Value> {
    let auth = auth_for(state, key)?;
    let mut rb = state.net.client.get(format!("{}/{key}", base_url(state))).timeout(TIMEOUT);
    if let Some(a) = after.filter(|a| *a > 0) {
        rb = rb.query(&[("after", a.to_string())]);
    }
    let mut v = sanitize(json_of(&exec(rb, &auth).await?)?);
    if let Some(o) = v.as_object_mut() {
        o.insert("local".into(), json!(auth.ticket.is_some()));
    }
    note(std::slice::from_ref(&v));
    Ok(v)
}

pub async fn read(state: &AppState, key: &str) -> TicketResult<()> {
    let auth = auth_for(state, key)?;
    let rb = state.net.client.post(format!("{}/{key}/read", base_url(state))).timeout(TIMEOUT);
    exec(rb, &auth).await.map(|_| ())
}

pub async fn attachment(state: &AppState, key: &str, id: &str) -> TicketResult<AttachmentData> {
    if id.is_empty() || id.len() > 80 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err(TicketError::new("invalid", "invalid_attachment", "Ungültiger Anhang"));
    }
    let auth = auth_for(state, key)?;
    let rb = state.net.client.get(format!("{}/{key}/attachments/{id}", base_url(state))).timeout(Duration::from_secs(60));
    let r = exec(rb, &auth).await?;
    Ok(attachment_data(r.content_type.as_deref(), r.body))
}

pub fn attachment_data(content_type: Option<&str>, body: Vec<u8>) -> AttachmentData {
    if let Some(mime) = crate::feedback::sniff_image(&body) {
        let b64 = base64::engine::general_purpose::STANDARD.encode(&body);
        return AttachmentData { mime: mime.to_string(), text: None, data_url: Some(format!("data:{mime};base64,{b64}")) };
    }
    let mime = content_type.unwrap_or("text/plain").split(';').next().unwrap_or("text/plain").trim().to_string();
    let max = body.len().min(crate::feedback::LOG_LIMIT);
    AttachmentData { mime, text: Some(String::from_utf8_lossy(&body[..max]).into_owned()), data_url: None }
}

pub fn report_body(r: &ChatReport, channel: &str) -> AppResult<Value> {
    let chat = r.chat_id.trim();
    if chat.is_empty() || chat.len() > 80 {
        return Err(AppError::Invalid("Chat fehlt".into()));
    }
    if !REASONS.contains(&r.reason.as_str()) {
        return Err(AppError::Invalid("Unbekannter Grund".into()));
    }
    if r.message_ids.len() > 50 || r.message_ids.iter().any(|m| m.is_empty() || m.len() > 80) {
        return Err(AppError::Invalid("Zu viele oder ungültige Nachrichten".into()));
    }
    let details = r.details.as_deref().map(str::trim).filter(|d| !d.is_empty());
    if details.is_some_and(|d| d.chars().count() > DETAILS_MAX) {
        return Err(AppError::Invalid(format!("Höchstens {DETAILS_MAX} Zeichen")));
    }
    let mut body = json!({
        "chatId": chat,
        "reason": r.reason,
        "client": {
            "app": "launcher",
            "version": env!("CARGO_PKG_VERSION"),
            "channel": channel,
            "os": crate::feedback::os_name(),
            "arch": std::env::consts::ARCH,
            "locale": r.locale.as_deref().unwrap_or("de"),
        },
    });
    if !r.message_ids.is_empty() {
        body["messageIds"] = json!(r.message_ids);
    }
    if let Some(d) = details {
        body["details"] = json!(d);
    }
    Ok(body)
}

pub async fn report_chat(state: &AppState, r: &ChatReport) -> TicketResult<Created> {
    let Some(b) = bearer(state) else {
        return Err(TicketError::new("auth", "unauthorized", "unauthorized: Nicht angemeldet"));
    };
    let body = report_body(r, &state.settings().update_channel)?;
    let rb = state.net.client.post(format!("{}/report-chat", base_url(state))).json(&body).timeout(TIMEOUT);
    let v = json_of(&exec(rb, &Auth { bearer: Some(b), ticket: None }).await?)?;
    let (Some(id), Some(ticket)) = (v["id"].as_str(), v["ticket"].as_str()) else {
        return Err(TicketError::new("ticket", "bad_response", "Unerwartete Antwort vom Server"));
    };
    if let Some(token) = v["token"].as_str() {
        if let Err(e) = remember(state, id, ticket, token) {
            tracing::warn!("Ticket {ticket}: Zugang nicht gespeichert: {e}");
        }
    }
    Ok(Created { id: id.to_string(), ticket: ticket.to_string() })
}
