//! Skin-Wechsel im Spiel (Vertrag 34, Vibey Client `docs/SKINS.md`): `.vibe/skins.json` + PNG-Kopien schreiben,
//! `.vibe/skin-request.json` jede Sekunde prüfen (nur solange eine Vibey-Instanz läuft), den Wechsel über die
//! Mojang-Skin-API ausführen und `.vibe/skin-result.json` schreiben.
use crate::auth::skins::{BridgeSkin, SkinVariant, SKINS_CHANGED};
use crate::error::{AppError, AppResult};
use crate::minecraft::RunState;
use crate::state::AppState;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Listener, Manager};

const SKINS_FILE: &str = "skins.json";
const REQUEST_FILE: &str = "skin-request.json";
const RESULT_FILE: &str = "skin-result.json";
const MAX_SKINS: usize = 500;
const REQUEST_MAX_AGE: i64 = 60;
const NAME_MAX: usize = 48;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BridgeAccount {
    pub uuid: String,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BridgeActive {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub library_id: Option<String>,
    pub sha1: String,
    pub variant: SkinVariant,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BridgeInput {
    pub account: Option<BridgeAccount>,
    pub blocked: Option<&'static str>,
    pub active_sha1: Option<(String, SkinVariant)>,
}

pub fn safe_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn atomic_write(path: &Path, data: &[u8]) -> AppResult<()> {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.tmp"));
    std::fs::write(&tmp, data)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

fn file_sha1(p: &Path) -> Option<String> {
    std::fs::read(p).ok().map(|b| hex::encode(Sha1::digest(b)))
}

pub fn write_skin_bridge(vibe_dir: &Path, library: &[BridgeSkin], input: &BridgeInput, now_secs: i64) -> AppResult<()> {
    let skins_dir = vibe_dir.join("skins");
    std::fs::create_dir_all(&skins_dir)?;
    let mut entries = Vec::new();
    let mut keep: HashSet<String> = HashSet::new();
    for s in library.iter().filter(|s| safe_id(&s.id)).take(MAX_SKINS) {
        let file = format!("{}.png", s.id);
        let dest = skins_dir.join(&file);
        if file_sha1(&dest).as_deref() != Some(s.sha1.as_str()) {
            let Ok(bytes) = std::fs::read(&s.path) else { continue };
            atomic_write(&dest, &bytes)?;
        }
        keep.insert(file.clone());
        let name: String = s.name.chars().take(NAME_MAX).collect();
        let mut e = json!({ "id": s.id, "name": name, "variant": s.variant.api(), "file": file, "sha1": s.sha1, "added_at": s.added_at });
        if let Some(c) = &s.cape_id {
            e["cape_id"] = Value::String(c.clone());
        }
        entries.push(e);
    }
    let mut doc = json!({ "schema": 1, "updated_at": now_secs, "can_change": input.blocked.is_none(), "skins": entries });
    if let Some(a) = &input.account {
        doc["account"] = serde_json::to_value(a)?;
    }
    if let Some(r) = input.blocked {
        doc["reason"] = Value::String(r.into());
    }
    if let Some((sha, variant)) = &input.active_sha1 {
        let library_id = library.iter().find(|s| s.sha1.eq_ignore_ascii_case(sha)).map(|s| s.id.clone()).filter(|id| safe_id(id));
        doc["active"] = serde_json::to_value(BridgeActive { library_id, sha1: sha.clone(), variant: *variant })?;
    }
    let mut data = serde_json::to_vec_pretty(&doc)?;
    data.push(b'\n');
    atomic_write(&vibe_dir.join(SKINS_FILE), &data)?;
    if let Ok(rd) = std::fs::read_dir(&skins_dir) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.ends_with(".png") && !keep.contains(&n) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq)]
pub struct SkinRequest {
    pub id: String,
    pub skin_id: String,
    pub variant: Option<SkinVariant>,
}

#[derive(Debug, Deserialize)]
struct RawRequest {
    schema: Option<i64>,
    id: Option<String>,
    action: Option<String>,
    skin_id: Option<String>,
    variant: Option<String>,
    requested_at: Option<i64>,
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

#[derive(Default)]
struct Bridge {
    active: HashMap<String, (String, SkinVariant)>,
    written: HashSet<String>,
    busy: HashSet<String>,
}

fn bridge() -> &'static Mutex<Bridge> {
    static B: OnceLock<Mutex<Bridge>> = OnceLock::new();
    B.get_or_init(Default::default)
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

struct RunningVibey {
    instance_id: String,
    account_uuid: String,
    account_name: String,
}

fn running_vibey(state: &AppState) -> Vec<RunningVibey> {
    let mut seen = HashSet::new();
    state
        .game
        .states()
        .into_iter()
        .filter(|g| g.state != RunState::Stopped)
        .filter_map(|g| Some((g.instance_id.clone(), g.account_uuid.clone()?, g.account_name.clone().unwrap_or_default())))
        .filter(|(iid, ..)| seen.insert(iid.clone()))
        .filter(|(iid, ..)| crate::vibey_client::install::load(state, iid).enabled)
        .map(|(instance_id, account_uuid, account_name)| RunningVibey { instance_id, account_uuid, account_name })
        .collect()
}

fn dashed(u: &str) -> String {
    let u = u.replace('-', "");
    if u.len() != 32 {
        return u;
    }
    format!("{}-{}-{}-{}-{}", &u[..8], &u[8..12], &u[12..16], &u[16..20], &u[20..])
}

fn input_for(state: &AppState, r: &RunningVibey) -> BridgeInput {
    let acc = state.auth.list().into_iter().find(|a| a.id.eq_ignore_ascii_case(&r.account_uuid) || a.uuid.replace('-', "").eq_ignore_ascii_case(&r.account_uuid));
    let (account, blocked) = match &acc {
        Some(a) => (
            Some(BridgeAccount { uuid: a.uuid.clone(), name: a.username.clone(), kind: "microsoft".into() }),
            a.needs_relogin.then_some("signed_out"),
        ),
        None if !r.account_uuid.is_empty() => (
            Some(BridgeAccount { uuid: dashed(&r.account_uuid), name: r.account_name.clone(), kind: "offline".into() }),
            Some("offline_account"),
        ),
        None => (None, Some("no_account")),
    };
    let key = acc.map(|a| a.id).unwrap_or_else(|| r.account_uuid.clone());
    BridgeInput { account, blocked, active_sha1: bridge().lock().active.get(&key).cloned() }
}

fn write_for(state: &AppState, r: &RunningVibey) {
    let dir = super::vibe_dir(state, &r.instance_id);
    let input = input_for(state, r);
    if let Err(e) = write_skin_bridge(&dir, &state.auth.skins.bridge_entries(), &input, now_secs()) {
        tracing::warn!("Skin-Brücke für {} nicht geschrieben: {e}", r.instance_id);
    }
}

async fn refresh_active(state: &AppState, account_id: &str) {
    let st = state.clone();
    let fetch = async {
        let (_, raw) = crate::commands::skins::with_token(&st, Some(account_id), |c, t| async move { crate::auth::skins::fetch_profile(&c, &t).await }).await?;
        let skin = raw.active_skin().filter(|s| !s.url.is_empty()).ok_or_else(|| AppError::msg("kein Skin"))?;
        let variant = SkinVariant::from_api(skin.variant.as_deref().unwrap_or("classic"));
        let png = crate::auth::skins::fetch_texture(&st.net.client, &crate::commands::skins::texture_cache(&st), &skin.url).await?;
        AppResult::Ok((hex::encode(Sha1::digest(&png)), variant))
    };
    match tokio::time::timeout(Duration::from_secs(10), fetch).await {
        Ok(Ok(a)) => {
            bridge().lock().active.insert(account_id.to_string(), a);
        }
        Ok(Err(e)) => tracing::debug!("Aktiver Skin für die Skin-Brücke nicht lesbar: {e}"),
        Err(_) => tracing::debug!("Aktiver Skin für die Skin-Brücke: Zeitüberschreitung"),
    }
}

fn account_key(state: &AppState, uuid: &str) -> Option<String> {
    state.auth.list().into_iter().find(|a| a.id.eq_ignore_ascii_case(uuid) || a.uuid.replace('-', "").eq_ignore_ascii_case(uuid)).map(|a| a.id)
}

pub fn write_all(state: &AppState, refetch: bool) {
    let running = running_vibey(state);
    if running.is_empty() {
        return;
    }
    let st = state.clone();
    tauri::async_runtime::spawn(async move {
        if refetch {
            let mut done = HashSet::new();
            for r in &running {
                if let Some(k) = account_key(&st, &r.account_uuid).filter(|k| done.insert(k.clone())) {
                    refresh_active(&st, &k).await;
                }
            }
        }
        for r in &running {
            write_for(&st, r);
        }
    });
}

fn on_game_state(state: &AppState) {
    let running = running_vibey(state);
    let fresh: Vec<RunningVibey> = {
        let mut b = bridge().lock();
        let ids: HashSet<String> = running.iter().map(|r| r.instance_id.clone()).collect();
        b.written.retain(|id| ids.contains(id));
        running.into_iter().filter(|r| b.written.insert(r.instance_id.clone())).collect()
    };
    if fresh.is_empty() {
        return;
    }
    let st = state.clone();
    tauri::async_runtime::spawn(async move {
        for r in &fresh {
            write_for(&st, r);
            if let Some(k) = account_key(&st, &r.account_uuid) {
                refresh_active(&st, &k).await;
                write_for(&st, r);
            }
        }
    });
}

async fn handle(state: AppState, r: RunningVibey, req: SkinRequest) {
    let dir = super::vibe_dir(&state, &r.instance_id);
    let input = input_for(&state, &r);
    if let Some(code) = input.blocked {
        let _ = write_result(&dir, &req.id, &Outcome::Error { code, message: None }, now_secs());
        return;
    }
    let Some(account_id) = account_key(&state, &r.account_uuid) else {
        let _ = write_result(&dir, &req.id, &Outcome::Error { code: "no_account", message: None }, now_secs());
        return;
    };
    if !bridge().lock().busy.insert(account_id.clone()) {
        let _ = write_result(&dir, &req.id, &Outcome::Error { code: "busy", message: None }, now_secs());
        return;
    }
    let _ = write_result(&dir, &req.id, &Outcome::Working, now_secs());
    let res = crate::commands::skins::apply_library(&state, Some(account_id.clone()), req.skin_id.clone(), req.variant).await;
    let outcome = match res {
        Ok(p) => {
            let variant = p.skin.as_ref().map(|s| s.variant).or(req.variant).unwrap_or_default();
            if let Some(sha) = state.auth.skins.bridge_entries().into_iter().find(|s| s.id == req.skin_id).map(|s| s.sha1) {
                bridge().lock().active.insert(account_id.clone(), (sha, variant));
            }
            Outcome::Ok { skin_id: req.skin_id.clone(), variant }
        }
        Err(e) => {
            let code = error_code(&e);
            Outcome::Error { code, message: (code == "other" || code == "mojang").then(|| e.to_string()) }
        }
    };
    bridge().lock().busy.remove(&account_id);
    if let Err(e) = write_result(&dir, &req.id, &outcome, now_secs()) {
        tracing::warn!("skin-result.json nicht geschrieben: {e}");
    }
    for other in running_vibey(&state) {
        write_for(&state, &other);
    }
}

fn poll_once(state: &AppState) {
    for r in running_vibey(state) {
        let dir = super::vibe_dir(state, &r.instance_id);
        match take_request(&dir, now_secs()) {
            None => {}
            Some(Taken::Invalid(Some(id))) => {
                let _ = write_result(&dir, &id, &Outcome::Error { code: "other", message: Some("Ungültige Anfrage".into()) }, now_secs());
            }
            Some(Taken::Invalid(None)) => {}
            Some(Taken::Request(req)) => {
                tauri::async_runtime::spawn(handle(state.clone(), r, req));
            }
        }
    }
}

pub fn init(app: &AppHandle) {
    let h = app.clone();
    std::thread::Builder::new()
        .name("skin-bridge".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(900));
            let Some(state) = h.try_state::<AppState>() else { continue };
            if state.game.any_running() {
                poll_once(&state);
            }
        })
        .ok();
    let h = app.clone();
    app.listen(crate::events::GAME_STATE, move |_| {
        if let Some(state) = h.try_state::<AppState>() {
            on_game_state(&state);
        }
    });
    let h = app.clone();
    app.listen(SKINS_CHANGED, move |ev| {
        let Some(state) = h.try_state::<AppState>() else { return };
        let profile = serde_json::from_str::<Value>(ev.payload()).ok().and_then(|v| v.get("scope").and_then(Value::as_str).map(|s| s == "profile")).unwrap_or(false);
        if !profile || bridge().lock().busy.is_empty() {
            write_all(&state, profile);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("vl-skinbridge-{tag}-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn png(dir: &Path, name: &str, seed: u8) -> (PathBuf, String) {
        let p = dir.join(name);
        let b = vec![seed; 100];
        std::fs::write(&p, &b).unwrap();
        (p, hex::encode(Sha1::digest(&b)))
    }

    #[test]
    fn writes_bridge_and_prunes() {
        let lib = tmp("lib");
        let vibe = tmp("vibe");
        let (p1, s1) = png(&lib, "a.png", 1);
        let (p2, s2) = png(&lib, "b.png", 2);
        let skins = vec![
            BridgeSkin { id: "ab12cd34ef56".into(), name: "Ritter".into(), variant: SkinVariant::Slim, path: p1, sha1: s1.clone(), added_at: 2, cape_id: Some("cape".into()) },
            BridgeSkin { id: "bad/id".into(), name: "x".into(), variant: SkinVariant::Classic, path: p2.clone(), sha1: s2.clone(), added_at: 1, cape_id: None },
        ];
        std::fs::create_dir_all(vibe.join("skins")).unwrap();
        std::fs::write(vibe.join("skins").join("old.png"), b"x").unwrap();
        let input = BridgeInput {
            account: Some(BridgeAccount { uuid: "1c2d3e4f-0000-4000-8000-00000000abcd".into(), name: "Alex".into(), kind: "microsoft".into() }),
            blocked: None,
            active_sha1: Some((s1.clone(), SkinVariant::Slim)),
        };
        write_skin_bridge(&vibe, &skins, &input, 1795040000).unwrap();
        let v: Value = serde_json::from_slice(&std::fs::read(vibe.join("skins.json")).unwrap()).unwrap();
        assert_eq!(v["schema"], 1);
        assert_eq!(v["can_change"], true);
        assert!(v.get("reason").is_none());
        assert_eq!(v["account"]["name"], "Alex");
        assert_eq!(v["active"]["library_id"], "ab12cd34ef56");
        assert_eq!(v["active"]["variant"], "slim");
        assert_eq!(v["skins"].as_array().unwrap().len(), 1);
        assert_eq!(v["skins"][0]["file"], "ab12cd34ef56.png");
        assert_eq!(v["skins"][0]["cape_id"], "cape");
        assert!(vibe.join("skins").join("ab12cd34ef56.png").is_file());
        assert!(!vibe.join("skins").join("old.png").exists());
        let blocked = BridgeInput { account: None, blocked: Some("no_account"), active_sha1: Some(("ff".into(), SkinVariant::Classic)) };
        write_skin_bridge(&vibe, &skins, &blocked, 1).unwrap();
        let v: Value = serde_json::from_slice(&std::fs::read(vibe.join("skins.json")).unwrap()).unwrap();
        assert_eq!(v["can_change"], false);
        assert_eq!(v["reason"], "no_account");
        assert!(v["active"].get("library_id").is_none());
        let _ = std::fs::remove_dir_all(lib);
        let _ = std::fs::remove_dir_all(vibe);
    }

    #[test]
    fn requests() {
        let now = 1795040100;
        let ok = br#"{"schema":1,"id":"5b0c","action":"apply","skin_id":"ab12cd34ef56","variant":"slim","requested_at":1795040100}"#;
        assert_eq!(parse_request(ok, now), Taken::Request(SkinRequest { id: "5b0c".into(), skin_id: "ab12cd34ef56".into(), variant: Some(SkinVariant::Slim) }));
        let no_variant = br#"{"schema":1,"id":"5b0c","action":"apply","skin_id":"ab12","requested_at":1795040090}"#;
        assert!(matches!(parse_request(no_variant, now), Taken::Request(SkinRequest { variant: None, .. })));
        let old = br#"{"schema":1,"id":"5b0c","action":"apply","skin_id":"ab12","requested_at":1795040000}"#;
        assert_eq!(parse_request(old, now), Taken::Invalid(Some("5b0c".into())));
        let action = br#"{"schema":1,"id":"5b0c","action":"delete","skin_id":"ab12","requested_at":1795040100}"#;
        assert_eq!(parse_request(action, now), Taken::Invalid(Some("5b0c".into())));
        let path = br#"{"schema":1,"id":"5b0c","action":"apply","skin_id":"../x","requested_at":1795040100}"#;
        assert_eq!(parse_request(path, now), Taken::Invalid(Some("5b0c".into())));
        let schema = br#"{"schema":2,"id":"5b0c","action":"apply","skin_id":"ab12","requested_at":1795040100}"#;
        assert_eq!(parse_request(schema, now), Taken::Invalid(Some("5b0c".into())));
        assert_eq!(parse_request(b"{nope", now), Taken::Invalid(None));
    }

    #[test]
    fn take_deletes_request_and_results() {
        let vibe = tmp("req");
        std::fs::write(vibe.join(REQUEST_FILE), br#"{"schema":1,"id":"r1","action":"apply","skin_id":"ab","requested_at":100}"#).unwrap();
        assert!(matches!(take_request(&vibe, 100), Some(Taken::Request(_))));
        assert!(!vibe.join(REQUEST_FILE).exists());
        assert_eq!(take_request(&vibe, 100), None);
        write_result(&vibe, "r1", &Outcome::Working, 5).unwrap();
        let v: Value = serde_json::from_slice(&std::fs::read(vibe.join(RESULT_FILE)).unwrap()).unwrap();
        assert_eq!(v["status"], "working");
        write_result(&vibe, "r1", &Outcome::Ok { skin_id: "ab".into(), variant: SkinVariant::Classic }, 6).unwrap();
        let v: Value = serde_json::from_slice(&std::fs::read(vibe.join(RESULT_FILE)).unwrap()).unwrap();
        assert_eq!((v["status"].as_str(), v["skin_id"].as_str(), v["variant"].as_str()), (Some("ok"), Some("ab"), Some("classic")));
        write_result(&vibe, "r1", &Outcome::Error { code: "rate_limited", message: Some("x".repeat(300)) }, 7).unwrap();
        let v: Value = serde_json::from_slice(&std::fs::read(vibe.join(RESULT_FILE)).unwrap()).unwrap();
        assert_eq!(v["error"], "rate_limited");
        assert_eq!(v["message"].as_str().unwrap().len(), 200);
        let _ = std::fs::remove_dir_all(vibe);
    }

    #[test]
    fn error_codes() {
        use crate::auth::skins::services_error;
        assert_eq!(error_code(&services_error(401, b"")), "signed_out");
        assert_eq!(error_code(&services_error(429, b"")), "rate_limited");
        assert_eq!(error_code(&services_error(400, b"")), "mojang");
        assert_eq!(error_code(&services_error(403, b"")), "mojang");
        assert_eq!(error_code(&services_error(503, b"")), "mojang");
        assert_eq!(error_code(&AppError::NotFound("Skin".into())), "not_found");
        assert_eq!(error_code(&AppError::NotConfigured("x".into())), "no_account");
        assert_eq!(error_code(&AppError::Cancelled), "other");
    }
}
