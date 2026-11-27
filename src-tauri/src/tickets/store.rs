use super::*;
use crate::auth::secrets::SecretStore;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Saved {
    pub id: String,
    pub ticket: String,
    pub token: String,
    #[serde(default)]
    pub added: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LocalTicket {
    pub id: String,
    pub ticket: String,
    pub added: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Known {
    pub status: String,
    pub activity: i64,
}

pub fn valid_token(t: &str) -> bool {
    t.strip_prefix("vtk_").is_some_and(|r| r.len() == 43 && r.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
}

pub fn valid_key(k: &str) -> bool {
    (1..=64).contains(&k.len()) && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

pub fn norm_key(k: &str) -> String {
    k.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase()
}

pub fn find<'a>(list: &'a [Saved], key: &str) -> Option<&'a Saved> {
    let k = norm_key(key);
    list.iter().find(|s| norm_key(&s.ticket) == k || norm_key(&s.id) == k)
}

pub fn upsert(mut list: Vec<Saved>, s: Saved) -> Vec<Saved> {
    list.retain(|x| x.id != s.id && x.token != s.token);
    list.push(s);
    if list.len() > SAVED_MAX {
        let n = list.len() - SAVED_MAX;
        list.drain(..n);
    }
    list
}

pub fn without(mut list: Vec<Saved>, tokens: &[String]) -> Vec<Saved> {
    list.retain(|s| !tokens.contains(&s.token));
    list
}

pub fn quiet(k: Option<&Known>, now: i64) -> bool {
    k.is_some_and(|k| k.status == "rejected" && now - k.activity > QUIET_AFTER_MS)
}

pub fn poll_tokens(list: &[Saved], known: &HashMap<String, Known>, now: i64, background: bool) -> Vec<String> {
    list.iter().filter(|s| !background || !quiet(known.get(&s.id), now)).map(|s| s.token.clone()).collect()
}

pub fn iso_ms(v: &Value) -> i64 {
    v.as_str().and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.timestamp_millis()).unwrap_or(0)
}

fn secret_id(state: &AppState) -> String {
    let h = hex::encode(Sha256::digest(crate::vibe::api_base(state).as_bytes()));
    format!("tickets:{}", &h[..12])
}

fn cache() -> &'static Mutex<HashMap<String, Vec<Saved>>> {
    static C: OnceLock<Mutex<HashMap<String, Vec<Saved>>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

fn write_lock() -> &'static Mutex<()> {
    static W: OnceLock<Mutex<()>> = OnceLock::new();
    W.get_or_init(Default::default)
}

pub(super) fn known() -> &'static Mutex<HashMap<String, Known>> {
    static K: OnceLock<Mutex<HashMap<String, Known>>> = OnceLock::new();
    K.get_or_init(Default::default)
}

pub fn note(items: &[Value]) {
    let mut k = known().lock();
    for v in items {
        if let (Some(id), Some(status)) = (v["id"].as_str(), v["status"].as_str()) {
            k.insert(id.to_string(), Known { status: status.to_string(), activity: iso_ms(&v["lastActivityAt"]) });
        }
    }
}

pub fn saved(state: &AppState) -> Vec<Saved> {
    let id = secret_id(state);
    if let Some(v) = cache().lock().get(&id) {
        return v.clone();
    }
    let list = SecretStore::new(&state.paths)
        .load(&id)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<Vec<Saved>>(&s).ok())
        .unwrap_or_default();
    cache().lock().insert(id, list.clone());
    list
}

fn persist(state: &AppState, list: Vec<Saved>) -> AppResult<()> {
    let id = secret_id(state);
    let store = SecretStore::new(&state.paths);
    if list.is_empty() {
        store.delete(&id);
    } else {
        store.save(&id, &serde_json::to_string(&list)?)?;
    }
    cache().lock().insert(id, list);
    Ok(())
}

pub fn remember(state: &AppState, id: &str, ticket: &str, token: &str) -> AppResult<()> {
    if !valid_token(token) || id.is_empty() {
        return Err(AppError::Invalid("Ticket-Zugang unvollständig".into()));
    }
    let _g = write_lock().lock();
    let s = Saved { id: id.to_string(), ticket: ticket.to_string(), token: token.to_string(), added: chrono::Utc::now().timestamp_millis() };
    persist(state, upsert(saved(state), s))
}

pub fn forget(state: &AppState, tokens: &[String]) -> AppResult<()> {
    if tokens.is_empty() {
        return Ok(());
    }
    let _g = write_lock().lock();
    persist(state, without(saved(state), tokens))
}

pub fn local(state: &AppState) -> Vec<LocalTicket> {
    saved(state).into_iter().map(|s| LocalTicket { id: s.id, ticket: s.ticket, added: s.added }).collect()
}
