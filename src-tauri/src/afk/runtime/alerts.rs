use super::*;

#[derive(serde::Serialize, Clone)]
pub(super) struct EventPayload<'a> {
    pub(super) run_id: &'a str,
    pub(super) instance_id: &'a str,
    pub(super) event: &'a AfkEvent,
}

pub(super) fn emit_snapshot(app: &AppHandle, s: &Snapshot) {
    crate::events::emit(app, SESSION_EVENT, s);
}

pub(super) fn notify_text(state: &AppState, run: &Run, ev: &AfkEvent) -> (String, String) {
    let en = !state.settings().language.starts_with("de");
    let name = state.instances.get(&run.instance_id).map(|i| i.name).unwrap_or_else(|_| run.instance_id.clone());
    let detail = ev.str("message").or(ev.str("reason")).or(ev.str("text")).unwrap_or_default().to_string();
    let title = match (ev.kind.as_str(), en) {
        ("death", false) => format!("{name}: Du bist gestorben"),
        ("death", true) => format!("{name}: You died"),
        ("mention", false) => format!("{name}: Vermutlich wurdest du erwähnt"),
        ("mention", true) => format!("{name}: You were probably mentioned"),
        ("whisper", false) => format!("{name}: Vermutlich eine private Nachricht"),
        ("whisper", true) => format!("{name}: Probably a private message"),
        ("reconnect_gave_up", false) => format!("{name}: Neu verbinden aufgegeben"),
        ("reconnect_gave_up", true) => format!("{name}: Gave up reconnecting"),
        (_, false) => format!("{name}: Verbindung getrennt"),
        (_, true) => format!("{name}: Disconnected"),
    };
    (title, detail)
}

pub(super) fn deliver(state: &AppState, run_id: &str, instance_id: &str, evs: Vec<AfkEvent>) {
    let enabled = state.settings().afk.notify;
    for ev in evs {
        crate::events::emit(&state.app, EVENT_EVENT, &EventPayload { run_id, instance_id, event: &ev });
        let toast = registry::with(|r| {
            let run = r.get_mut(run_id)?;
            run.should_notify(&ev, enabled).then(|| run.clone())
        });
        if let Some(run) = toast {
            let (title, body) = notify_text(state, &run, &ev);
            notify::toast(&state.app, &title, &body);
        }
    }
}

pub fn observe_log(run_id: &str, lines: &[Parsed]) {
    if !registry::any() || !lines.iter().any(|l| l.text.contains("[CHAT]") || l.text.contains("isconnect") || l.text.contains("ost connection")) {
        return;
    }
    let now = crate::util::now_ms();
    let found = registry::with(|r| {
        let run = r.get_mut(run_id).filter(|x| x.accepts_log())?;
        let words: Vec<String> = run.player.iter().cloned().collect();
        let own = run.player.clone();
        let evs: Vec<AfkEvent> = lines
            .iter()
            .filter(|l| l.level != LogLevel::Launcher)
            .flat_map(|l| logscan::scan(&l.text, own.as_deref(), &words, now))
            .map(|e| e.with("fallback", true))
            .collect();
        let kept: Vec<AfkEvent> = evs.into_iter().filter_map(|e| run.apply(e)).collect();
        (!kept.is_empty()).then(|| (run.instance_id.clone(), kept))
    });
    if let Some((iid, evs)) = found {
        let run = run_id.to_string();
        tauri::async_runtime::spawn(async move {
            if let Some(app) = APP.get() {
                if let Some(state) = app.try_state::<AppState>() {
                    deliver(&state, &run, &iid, evs);
                }
            }
        });
    }
}
