use super::*;

/// Start als Aufgabe (wie bei Java). Gibt die Task-ID zurück.
pub fn start(state: &AppState, id: &str) -> AppResult<String> {
    let inst = state.instances.get(id)?;
    let o = options(&inst)?;
    // Als „ungültig“ melden – „nicht konfiguriert“ würde in der Oberfläche zur Account-Anmeldung führen
    target(o.channel).map_err(|e| AppError::Invalid(e.to_string()))?;
    if adopting(o.channel) {
        return Err(AppError::Invalid("Bestehende Bedrock-Daten werden gerade übernommen – bitte kurz warten.".into()));
    }
    state.game.begin_exclusive(id)?;
    let st = state.clone();
    let iid = id.to_string();
    let task_id = state.tasks.spawn("launch", format!("{} wird gestartet", inst.name), Some(id.to_string()), move |task| async move {
        let r = run(&st, &iid, &task).await;
        if let Err(e) = &r {
            st.game.fail(&iid, e);
        }
        r
    });
    state.game.set_task(id, &task_id);
    Ok(task_id)
}

pub(super) async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(f).await?
}

pub(super) async fn run(state: &AppState, id: &str, task: &TaskHandle) -> AppResult<()> {
    let inst = state.instances.get(id)?;
    let o = options(&inst)?;
    let ch = o.channel;
    let t = target(ch)?;
    let name = if ch == BedrockChannel::Preview { "Minecraft Bedrock Preview" } else { "Minecraft Bedrock" };
    task.stage(format!("{name} wird gesucht …"), None);
    let found = blocking(move || Ok(detect::install(ch))).await?;
    if !found.installed {
        return Err(AppError::Invalid(format!("{name} ist nicht installiert. Installiere es über den Microsoft Store.")));
    }
    let isolated = o.profile == BedrockProfile::Isolated;
    // Offene Reste aufräumen, beim ersten Mal sichern, eintauschen
    {
        let (st, iid, t2, task2) = (state.clone(), id.to_string(), t.clone(), task.clone());
        let recovered = blocking(move || {
            if game_running(ch) {
                return Err(AppError::Invalid(format!("{name} läuft bereits. Bitte schließe das Spiel und starte es dann über den Launcher.")));
            }
            let _g = DATA_LOCK.lock();
            let r = swapper(&st.paths, &t2).swap_out(&|| game_running(ch))?;
            drop(_g);
            if isolated {
                let total: u64 = t2.layout.slots(&t2.base).iter().map(|s| super::super::dir_size(&super::super::slot_path(&t2.base, s))).sum();
                let done = std::sync::atomic::AtomicU64::new(0);
                let marker = super::super::launcher_dir(&st.paths).join(format!("initial-backup-{}.json", ch.as_str()));
                if !marker.exists() {
                    task2.stage("Erste vollständige Sicherung deiner Bedrock-Daten …", Some(0.0));
                }
                let on = |n: u64| {
                    let d = done.fetch_add(n, std::sync::atomic::Ordering::Relaxed) + n;
                    if total > 0 {
                        task2.progress(d as f64 / total as f64);
                    }
                };
                let backups = super::super::launcher_dir(&st.paths).join("backups").join(ch.as_str());
                if let Some(p) = swap::ensure_initial_backup(&t2.base, t2.layout, &backups, &marker, &on, &|| task2.is_cancelled())? {
                    tracing::info!("Bedrock: erste Sicherung unter {p:?}");
                    st.game.launcher_line(&iid, LogLevel::Launcher, format!("Erste Sicherung deiner Bedrock-Daten: {}", p.display()));
                }
                task2.stage("Profil wird eingetauscht …", None);
                let profile = profile_dir(&st.paths, &iid);
                std::fs::create_dir_all(&profile)?;
                if game_running(ch) {
                    return Err(AppError::Invalid(swap::RUNNING_MSG.into()));
                }
                let _g = DATA_LOCK.lock();
                swapper(&st.paths, &t2).swap_in(&iid, &profile, &|| game_running(ch))?;
            }
            Ok(r)
        })
        .await?;
        if let Some(r) = recovered {
            tracing::info!("Bedrock: offenen Tausch von {} abgeschlossen", r.instance_id);
        }
    }
    // Ab hier bei jedem Fehler zurücktauschen
    let started_ms = crate::util::now_ms();
    let res: AppResult<Option<u32>> = async {
        task.stage(format!("{name} wird geöffnet …"), None);
        state.game.launcher_line(id, LogLevel::Launcher, format!("{name} wird geöffnet ({})", if isolated { "eigenes Profil" } else { "gemeinsames Profil" }));
        open_game(state, id, ch, &t)?;
        task.stage(format!("Warte auf {name} …"), None);
        let deadline = std::time::Instant::now() + START_TIMEOUT;
        loop {
            if task.is_cancelled() {
                return Err(AppError::Cancelled);
            }
            if super::super::simulated() {
                if sim_alive(id) {
                    return Ok(None);
                }
            } else if let Some(pid) = blocking(move || Ok(detect::running_pid(ch))).await? {
                return Ok(Some(pid));
            }
            if std::time::Instant::now() > deadline {
                return Err(AppError::msg(format!("{name} wurde nicht gestartet. Öffne es einmal direkt und melde dich bei Xbox an, dann klappt es auch hier.")));
            }
            tokio::time::sleep(Duration::from_millis(800)).await;
        }
    }
    .await;
    let pid = match res {
        Ok(pid) => pid,
        Err(e) => {
            if isolated {
                swap_back(state, ch).await;
            }
            return Err(e);
        }
    };
    state.game.mark_running(id, pid, started_ms);
    let _ = state.instances.modify(id, |i| i.last_played = Some(started_ms));
    crate::minecraft::process::apply_launch_behavior(state, true);
    let st = state.clone();
    let iid = id.to_string();
    tauri::async_runtime::spawn(async move { monitor(st, iid, ch, isolated, started_ms).await });
    Ok(())
}

/// Spiel öffnen: über das Protokoll des installierten Pakets (`minecraft:` / `minecraft-preview:`).
pub(super) fn open_game(_state: &AppState, id: &str, ch: BedrockChannel, t: &super::super::Target) -> AppResult<()> {
    if super::super::simulated() {
        // Wie das echte Spiel beim ersten Start: Spieler- und Pack-Ordner anlegen
        if t.layout == Layout::Gdk {
            std::fs::create_dir_all(t.base.join("Users/2535400000000001/games/com.mojang/minecraftWorlds"))?;
            std::fs::create_dir_all(t.base.join("Users/2535400000000001/games/com.mojang/minecraftpe"))?;
        }
        std::fs::create_dir_all(t.packs_dir().join("resource_packs"))?;
        let secs = std::env::var("VIBE_BEDROCK_SIM_SECS").ok().and_then(|s| s.parse().ok()).unwrap_or(20u64);
        SIM.lock().get_or_insert_with(HashMap::new).insert(id.to_string(), (std::time::Instant::now() + Duration::from_secs(secs), false));
        return Ok(());
    }
    let uri = match ch {
        BedrockChannel::Release => "minecraft:",
        BedrockChannel::Preview => "minecraft-preview:",
    };
    #[cfg(windows)]
    {
        std::process::Command::new("explorer").arg(uri).spawn().map_err(|e| AppError::msg(format!("Spiel konnte nicht geöffnet werden: {e}")))?;
    }
    #[cfg(not(windows))]
    {
        let _ = uri;
        return Err(AppError::Invalid("Minecraft Bedrock gibt es nur unter Windows.".into()));
    }
    #[allow(unreachable_code)]
    Ok(())
}
