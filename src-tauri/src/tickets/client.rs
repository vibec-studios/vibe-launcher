use super::*;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TicketError {
    pub kind: &'static str,
    pub http: u16,
    pub code: String,
    pub message: String,
    pub retry_after: Option<u64>,
    pub details: Value,
}

impl TicketError {
    pub fn new(kind: &'static str, code: &str, message: impl Into<String>) -> Self {
        TicketError { kind, http: 0, code: code.to_string(), message: message.into(), retry_after: None, details: Value::Null }
    }
}

impl From<AppError> for TicketError {
    fn from(e: AppError) -> Self {
        TicketError::new(e.kind(), e.kind(), e.to_string())
    }
}

pub type TicketResult<T> = Result<T, TicketError>;

#[derive(Debug, Clone, Default)]
pub struct Auth {
    pub bearer: Option<String>,
    pub ticket: Option<String>,
}

impl Auth {
    pub fn apply(&self, mut rb: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let Some(b) = &self.bearer {
            rb = rb.bearer_auth(b);
        }
        if let Some(t) = &self.ticket {
            rb = rb.header("x-ticket-token", t);
        }
        rb
    }

    pub fn is_empty(&self) -> bool {
        self.bearer.is_none() && self.ticket.is_none()
    }
}

pub struct Reply {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

pub fn bearer(state: &AppState) -> Option<String> {
    if !state.settings().vibe.enabled {
        return None;
    }
    crate::vibe::tokens_get(state).map(|t| t.access_token).filter(|t| !t.is_empty())
}

pub fn auth_for(state: &AppState, key: &str) -> TicketResult<Auth> {
    if !valid_key(key) {
        return Err(TicketError::new("invalid", "invalid_ticket", "Ungültige Ticket-Nummer"));
    }
    let a = Auth { bearer: bearer(state), ticket: find(&saved(state), key).map(|s| s.token.clone()) };
    if a.is_empty() {
        return Err(TicketError::new("ticket", "no_access", "Kein Zugang zu diesem Ticket"));
    }
    Ok(a)
}

pub fn base_url(state: &AppState) -> String {
    format!("{}/api/v1/tickets", crate::vibe::api_base(state))
}

pub fn error_of(status: u16, retry_after: Option<u64>, body: &[u8]) -> TicketError {
    let v: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let code = v["error"]["code"].as_str().map(str::to_string).unwrap_or_else(|| format!("http_{status}"));
    let message = v["error"]["message"].as_str().map(str::to_string).unwrap_or_else(|| format!("HTTP {status}"));
    let kind = if status == 401 { "auth" } else { "ticket" };
    let message = if status == 401 { format!("{code}: {message}") } else { message };
    TicketError { kind, http: status, code, message, retry_after, details: v["error"]["details"].clone() }
}

pub async fn exec(rb: reqwest::RequestBuilder, auth: &Auth) -> TicketResult<Reply> {
    let resp = auth.apply(rb).send().await.map_err(|e| TicketError::new("network", "offline", e.without_url().to_string()))?;
    let status = resp.status().as_u16();
    let header = |k: &str| resp.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_string);
    let content_type = header("content-type");
    let retry_after = header("retry-after").and_then(|v| v.trim().parse::<u64>().ok());
    let body = resp.bytes().await.map_err(|e| TicketError::new("network", "offline", e.without_url().to_string()))?.to_vec();
    if !(200..300).contains(&status) {
        return Err(error_of(status, retry_after, &body));
    }
    Ok(Reply { status, content_type, body })
}

pub fn json_of(r: &Reply) -> TicketResult<Value> {
    if r.status == 204 || r.body.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_slice(&r.body).map_err(|_| TicketError::new("ticket", "bad_response", "Unerwartete Antwort vom Server"))
}

pub fn sanitize(mut v: Value) -> Value {
    if let Some(o) = v.as_object_mut() {
        o.remove("token");
    }
    v
}
