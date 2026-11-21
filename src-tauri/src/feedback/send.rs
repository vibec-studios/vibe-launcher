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

    let mut logs = Vec::new();
    if d.attach_logs {
        let known = redact::Known::from_env();
        for src in sources(state, d.instance_id.as_deref()) {
            match read_cut(&src.path, LOG_MAX_BYTES, src.cut) {
                Ok((raw, len, cut)) if !raw.trim().is_empty() => logs.push(clean_log(&src.name, &raw, len, cut, &known)),
                Ok(_) => {}
                Err(e) => tracing::warn!("Feedback: {} nicht lesbar: {e}", src.name),
            }
        }
    }

    if d.screenshots.len() > MAX_FILES {
        return Err(AppError::Invalid(format!("Höchstens {MAX_FILES} Screenshots.")));
    }
    let h = held().lock();
    let mut shots = Vec::new();
    let mut infos = Vec::new();
    for id in &d.screenshots {
        let img = h.get(id).ok_or_else(|| AppError::NotFound("Screenshot (bitte erneut hinzufügen)".into()))?;
        let thumb = image::load_from_memory(&img.bytes).ok().and_then(|i| thumbnail(&i).ok().map(|t| (t, i.width(), i.height())));
        let (thumb, width, height) = thumb.unwrap_or_default();
        infos.push(ImageInfo { id: id.clone(), name: img.name.clone(), mime: img.mime.clone(), bytes: img.bytes.len() as u64, width, height, thumb });
        shots.push((img.name.clone(), img.mime.clone(), img.bytes.clone()));
    }
    drop(h);

    let auth = bearer(state, d.link_account);
    let total = serde_json::to_vec(&meta)?.len() as u64 + logs.iter().map(|l| l.bytes).sum::<u64>() + shots.iter().map(|s| s.2.len() as u64).sum::<u64>();
    let token = uuid::Uuid::new_v4().simple().to_string();
    let p = Prepared {
        meta: meta.clone(),
        logs: logs.iter().map(|l| (l.name.clone(), l.text.clone())).collect(),
        shots,
        bearer: auth.as_ref().map(|a| a.0.clone()),
        shot_ids: d.screenshots.clone(),
    };
    *prepared().lock() = Some((token.clone(), p, Instant::now()));
    Ok(Preview { token, endpoint: endpoint(state), meta, logs, screenshots: infos, account: auth.map(|a| a.1), total_bytes: total })
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
    use reqwest::multipart::{Form, Part};
    let build = || -> Result<Form, reqwest::Error> {
        let mut form = Form::new().part("meta", Part::text(p.meta.to_string()).mime_str("application/json")?);
        for (name, text) in &p.logs {
            form = form.part("log", Part::bytes(text.clone().into_bytes()).file_name(name.clone()).mime_str("text/plain")?);
        }
        for (name, mime, bytes) in &p.shots {
            form = form.part("screenshot", Part::bytes(bytes.clone()).file_name(name.clone()).mime_str(mime)?);
        }
        Ok(form)
    };
    let form = match build() {
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
            (Some(id), Some(ticket)) => SendResult::Sent { id: id.to_string(), ticket: ticket.to_string() },
            (Some(id), None) => SendResult::Sent { id: id.to_string(), ticket: id.to_string() },
            _ => SendResult::Rejected { http: status, code: Some("bad_response".into()), message: None },
        },
        429 => SendResult::RateLimited { retry_after_secs: retry, message: err_msg },
        _ => SendResult::Rejected { http: status, code: err_code, message: err_msg },
    }
}
