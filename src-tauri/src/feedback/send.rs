use super::*;

pub fn endpoint(state: &AppState) -> String {
    format!("{}/api/v1/feedback", crate::vibe::api_base(state))
}

/// Vibe-Token, wenn gewünscht, Vibe an und eine noch gültige Anmeldung vorhanden ist.
pub(super) fn bearer(state: &AppState, want: bool) -> Option<(String, String)> {
    if !want || !state.settings().vibe.enabled {
        return None;
    }
    let t = crate::vibe::tokens_get(state)?;
    let now = chrono::Utc::now().timestamp_millis();
    if t.access_token.is_empty() || t.expires_at <= now + 30_000 {
        return None;
    }
    let name = crate::vibe::identity(state).map(|i| i.name).unwrap_or_default();
    Some((t.access_token, name))
}

pub fn prepare(state: &AppState, d: &Draft) -> AppResult<Preview> {
    let s = state.settings();
    let instance = d.instance_id.as_deref().and_then(|id| instance_meta(state, id));
    let meta = build_meta(d, env!("CARGO_PKG_VERSION"), &s.update_channel, &os_name(), std::env::consts::ARCH, instance)?;

    let kinds: Option<&[String]> = if d.attach_logs { None } else { Some(&[]) };
    let c = attach::collect(state, d.instance_id.as_deref(), kinds, &d.screenshots)?;

    let auth = bearer(state, d.link_account);
    let total = serde_json::to_vec(&meta)?.len() as u64 + c.bytes();
    let token = uuid::Uuid::new_v4().simple().to_string();
    let p = Prepared {
        meta: meta.clone(),
        logs: c.log_parts(),
        shots: c.shots,
        bearer: auth.as_ref().map(|a| a.0.clone()),
        shot_ids: d.screenshots.clone(),
    };
    *prepared().lock() = Some((token.clone(), p, Instant::now()));
    Ok(Preview { token, endpoint: endpoint(state), meta, logs: c.logs, screenshots: c.images, account: auth.map(|a| a.1), total_bytes: total })
}

/// Vorbereitetes Paket senden. Bei Erfolg wird es (samt Screenshots) verworfen; sonst bleibt es für einen
/// neuen Versuch liegen.
pub async fn send(state: &AppState, token: &str) -> AppResult<SendResult> {
    let p = {
        let g = prepared().lock();
        match g.as_ref() {
            Some((t, p, at)) if t == token && at.elapsed() < PREPARED_TTL => p.clone(),
            _ => return Err(AppError::Invalid("Die Vorschau ist abgelaufen – bitte erneut „Weiter“ wählen.".into())),
        }
    };
    let r = send_prepared(&state.net.client, &endpoint(state), &p).await;
    if let SendResult::Sent { id, ticket, token: Some(secret) } = &r {
        if let Err(e) = crate::tickets::remember(state, id, ticket, secret) {
            tracing::warn!("Ticket {ticket}: Zugang nicht gespeichert: {e}");
        }
    }
    if matches!(r, SendResult::Sent { .. }) {
        let mut g = prepared().lock();
        if g.as_ref().is_some_and(|(t, _, _)| t == token) {
            *g = None;
        }
        drop(g);
        discard(&p.shot_ids);
    }
    Ok(r)
}

/// Multipart bauen und senden (ohne Zustand, testbar gegen einen lokalen Server).
pub async fn send_prepared(client: &reqwest::Client, url: &str, p: &Prepared) -> SendResult {
    let form = match attach::multipart(&p.meta, &p.logs, &p.shots) {
        Ok(f) => f,
        Err(e) => return SendResult::Rejected { http: 0, code: Some("client".into()), message: Some(e.to_string()) },
    };
    let mut rb = client.post(url).multipart(form).timeout(Duration::from_secs(60));
    if let Some(b) = &p.bearer {
        rb = rb.bearer_auth(b);
    }
    let resp = match rb.send().await {
        Ok(r) => r,
        Err(e) => return SendResult::Offline { message: e.without_url().to_string() },
    };
    let status = resp.status().as_u16();
    let retry = resp.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<u64>().ok());
    let body = resp.text().await.unwrap_or_default();
    let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    let err_msg = v["error"]["message"].as_str().map(str::to_string);
    let err_code = v["error"]["code"].as_str().map(str::to_string);
    match status {
        200..=299 => match (v["id"].as_str(), v["ticket"].as_str()) {
            (Some(id), ticket) => SendResult::Sent {
                id: id.to_string(),
                ticket: ticket.unwrap_or(id).to_string(),
                token: v["token"].as_str().filter(|t| crate::tickets::valid_token(t)).map(str::to_string),
            },
            _ => SendResult::Rejected { http: status, code: Some("bad_response".into()), message: None },
        },
        429 => SendResult::RateLimited { retry_after_secs: retry, message: err_msg },
        _ => SendResult::Rejected { http: status, code: err_code, message: err_msg },
    }
}
