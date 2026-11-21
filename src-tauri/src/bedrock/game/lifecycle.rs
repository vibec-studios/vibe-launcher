use super::*;

/// Zurücktauschen mit Wiederholung (Dateien können kurz nach Spielende noch gesperrt sein).
pub(super) async fn swap_back(state: &AppState, ch: BedrockChannel) -> bool {
    for attempt in 0..12 {
        let st = state.clone();
        let r = blocking(move || {
            let t = target(ch)?;
            let _g = DATA_LOCK.lock();
            swapper(&st.paths, &t).swap_out(&|| game_running(ch))
        })
        .await;
        super::super::issues::record(ch, &r);
        match r {
            Ok(rep) => {
                if let Some(rep) = rep.filter(|r| !r.rescued.is_empty()) {
                    tracing::warn!("Bedrock: unerwartete Daten gesichert: {:?}", rep.rescued);
                }
                return true;
            }
            Err(e) => {
                tracing::warn!("Bedrock: Zurücktauschen (Versuch {}) fehlgeschlagen: {e}", attempt + 1);
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
    false
}

/// Spiel beobachten bis es beendet ist, dann aufräumen.
pub(super) async fn monitor(state: AppState, id: String, ch: BedrockChannel, isolated: bool, started_ms: i64) {
    let mut misses = 0;
    loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let alive = if super::super::simulated() { sim_alive(&id) } else { blocking(move || Ok(detect::running_pid(ch).is_some())).await.unwrap_or(true) };
        if alive {
            misses = 0;
            continue;
        }
        // Zweimal hintereinander weg (das Spiel startet sich z. B. nach Updates kurz neu)
        misses += 1;
        if misses >= 2 {
            break;
        }
    }
    if super::super::simulated() {
        if let Some(m) = SIM.lock().as_mut() {
            m.remove(&id);
        }
    }
    let ended = crate::util::now_ms();
    let ok = !isolated || swap_back(&state, ch).await;
    let shots = {
        let (paths, iid) = (state.paths.clone(), id.clone());
        blocking(move || Ok(copy_screenshots(&paths, &iid, started_ms, ended))).await.unwrap_or(0)
    };
    let secs = ((ended - started_ms).max(0) / 1000) as u64;
    let _ = state.instances.modify(&id, |i| i.play_time_secs = i.play_time_secs.saturating_add(secs));
    let mut msg = if state.game.was_killed(&id) { "Spiel wurde beendet.".to_string() } else { "Spiel beendet.".to_string() };
    if shots > 0 {
        msg.push_str(&format!(" {shots} Screenshot(s) übernommen."));
    }
    if !ok {
        msg.push_str(" Die Profildaten konnten noch nicht zurückgetauscht werden – das passiert automatisch beim nächsten Start.");
    }
    state.game.mark_stopped(&id, !ok, msg);
    if !state.game.any_running() {
        crate::minecraft::process::apply_launch_behavior(&state, false);
    }
}

/// Stoppen: Spielprozess beenden bzw. Vorbereitung abbrechen.
pub fn kill(state: &AppState, id: &str) -> AppResult<()> {
    if super::super::simulated() {
        if let Some(e) = SIM.lock().as_mut().and_then(|m| m.get_mut(id)) {
            e.1 = true;
        }
    }
    state.game.kill(state, id)
}

/// Beim Launcher-Start: offene Tausche abschließen oder (Spiel läuft noch) weiter beobachten.
pub fn on_startup(state: &AppState) {
    for ch in [BedrockChannel::Release, BedrockChannel::Preview] {
        let Ok(t) = target(ch) else { continue };
        let sw = swapper(&state.paths, &t);
        let Some(j) = sw.load_journal() else { continue };
        if game_running(ch) {
            // Spiel läuft noch mit eingetauschtem Profil -> Sitzung wieder aufnehmen
            if state.instances.get(&j.instance_id).is_ok() && state.game.begin_exclusive(&j.instance_id).is_ok() {
                let pid = if super::super::simulated() { None } else { detect::running_pid(ch) };
                state.game.mark_running(&j.instance_id, pid, j.started_at);
                state.game.launcher_line(&j.instance_id, LogLevel::Launcher, "Laufende Bedrock-Sitzung wieder aufgenommen.".into());
                let st = state.clone();
                tauri::async_runtime::spawn(async move { monitor(st, j.instance_id.clone(), ch, true, j.started_at).await });
            }
            continue;
        }
        let _g = DATA_LOCK.lock();
        let r = sw.swap_out(&|| game_running(ch));
        super::super::issues::record(ch, &r);
        match r {
            Ok(Some(r)) => tracing::info!("Bedrock: offenen Tausch von {} nach Neustart abgeschlossen (gerettet: {:?})", r.instance_id, r.rescued),
            Ok(None) => {}
            Err(e) => tracing::error!("Bedrock: Wiederaufnahme des Tauschs fehlgeschlagen: {e}"),
        }
    }
}

/// Manuell „Daten zurücktauschen“ (falls das automatische Zurücktauschen nicht klappte).
pub fn recover(state: &AppState, ch: BedrockChannel) -> AppResult<bool> {
    if adopting(ch) {
        return Err(AppError::Invalid("Bitte warte, bis die Übernahme fertig ist.".into()));
    }
    let t = target(ch)?;
    let sw = swapper(&state.paths, &t);
    if let Some(j) = sw.load_journal() {
        if state.game.is_running(&j.instance_id) {
            return Err(AppError::Invalid("Die Instanz läuft noch.".into()));
        }
    }
    let _g = DATA_LOCK.lock();
    let r = sw.swap_out(&|| game_running(ch));
    super::super::issues::record(ch, &r);
    Ok(r?.is_some())
}
