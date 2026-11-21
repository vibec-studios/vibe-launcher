use super::*;

#[derive(Default)]
pub(super) struct Bridge {
    pub(super) active: HashMap<String, (String, SkinVariant)>,
    pub(super) written: HashSet<String>,
    pub(super) busy: HashSet<String>,
}

pub(super) fn bridge() -> &'static Mutex<Bridge> {
    static B: OnceLock<Mutex<Bridge>> = OnceLock::new();
    B.get_or_init(Default::default)
}

pub(super) fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

pub(super) struct RunningVibey {
    pub(super) instance_id: String,
    pub(super) account_uuid: String,
    pub(super) account_name: String,
}

pub(super) fn running_vibey(state: &AppState) -> Vec<RunningVibey> {
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

pub(super) fn dashed(u: &str) -> String {
    let u = u.replace('-', "");
    if u.len() != 32 {
        return u;
    }
    format!("{}-{}-{}-{}-{}", &u[..8], &u[8..12], &u[12..16], &u[16..20], &u[20..])
}

pub(super) fn input_for(state: &AppState, r: &RunningVibey) -> BridgeInput {
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

pub(super) fn write_for(state: &AppState, r: &RunningVibey) {
    let dir = super::super::vibe_dir(state, &r.instance_id);
    let input = input_for(state, r);
    if let Err(e) = write_skin_bridge(&dir, &state.auth.skins.bridge_entries(), &input, now_secs()) {
        tracing::warn!("Skin-Brücke für {} nicht geschrieben: {e}", r.instance_id);
    }
}

pub(super) async fn refresh_active(state: &AppState, account_id: &str) {
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

pub(super) fn account_key(state: &AppState, uuid: &str) -> Option<String> {
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

pub(super) fn on_game_state(state: &AppState) {
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

pub(super) async fn handle(state: AppState, r: RunningVibey, req: SkinRequest) {
    let dir = super::super::vibe_dir(&state, &r.instance_id);
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

pub(super) fn poll_once(state: &AppState) {
    for r in running_vibey(state) {
        let dir = super::super::vibe_dir(state, &r.instance_id);
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
