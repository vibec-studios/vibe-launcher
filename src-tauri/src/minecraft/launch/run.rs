use super::*;

/// Komplettablauf von `instance_launch` (innerhalb der Aufgabe).
pub async fn launch(
    state: &AppState,
    id: &str,
    run: &str,
    account_id: Option<String>,
    world: Option<String>,
    server: Option<String>,
    task: &TaskHandle,
) -> AppResult<()> {
    let gm = state.game.clone();
    let inst = state.instances.get(id)?;
    let slot = gm.state_of(run).map(|s| s.slot).unwrap_or(1);
    let label = if slot > 1 { format!(" (Sitzung #{slot})") } else { String::new() };
    gm.launcher_line(run, LogLevel::Launcher, format!("Vibe Launcher {} – {}{label} wird vorbereitet", env!("CARGO_PKG_VERSION"), inst.name));
    if gm.others_active(id, run) == 0 {
        crate::vibey_client::before_launch(state, id, task).await;
        crate::content::autoupdate::before_launch(state, id, task).await;
        crate::content::worldbackup::before_launch(state, id, task).await;
    } else {
        gm.launcher_line(run, LogLevel::Launcher, "Die Instanz läuft bereits – automatische Updates und Welt-Backups werden für diese weitere Sitzung übersprungen.".into());
    }
    task.check()?;
    let prep = super::super::install::install_instance_opts(state, id, &task.sub(0.0, 0.9), false).await?;
    task.check()?;
    task.stage("Account wird geprüft …", Some(0.92));
    let acc = state.auth.launch_account(state, account_id.as_deref()).await.map_err(|e| match e {
        AppError::NotConfigured(_) => AppError::NotConfigured("Kein Account ausgewählt – bitte unter „Accounts“ anmelden.".into()),
        e => e,
    })?;
    gm.set_secret(run, &acc.access_token);
    gm.set_account(run, &acc.username, &acc.uuid);
    if let Some(other) = gm.account_in_use(&acc.uuid, run) {
        let name = state.instances.get(&other.instance_id).map(|i| i.name).unwrap_or(other.instance_id);
        gm.launcher_line(
            run,
            LogLevel::Warn,
            format!("Achtung: {} spielt bereits in „{name}“ (Sitzung #{}). Server trennen meist die ältere Verbindung.", acc.username, other.slot),
        );
    }
    task.check()?;
    let inst = state.instances.get(id)?;
    let settings = state.settings();
    let mut plan = build(state, &inst, &prep, &acc, &settings)?;
    if let Some(cfg) = prep.log_config.as_deref().filter(|_| slot > 1) {
        if let Some(p) = redirect_logs(&mut plan, cfg, slot) {
            gm.launcher_line(run, LogLevel::Launcher, format!("Log-Datei dieser Sitzung: logs/vibe-session-{slot}/latest.log ({})", p.display()));
        }
    }
    // Quick Play (ab 1.20): direkt in eine Einzelspielerwelt starten
    if let Some(w) = world {
        // Der Barrierefreiheits-Willkommensbildschirm beim allerersten Start würde Quick Play blockieren
        skip_onboarding(&plan.cwd);
        plan.args.extend(["--quickPlaySingleplayer".to_string(), w.clone()]);
        plan.display.push_str(&format!(" --quickPlaySingleplayer \"{w}\""));
    } else if let Some(s) = server {
        // Direkt auf einen Server: Quick Play ab 1.20, davor die alten Argumente --server/--port
        skip_onboarding(&plan.cwd);
        let args = if crate::platform::servers::supports_quick_play(&inst.mc_version) {
            vec!["--quickPlayMultiplayer".to_string(), s.clone()]
        } else {
            let (host, port) = crate::platform::servers::parse_address(&s)?;
            vec!["--server".to_string(), host, "--port".to_string(), port.to_string()]
        };
        plan.display.push_str(&format!(" {}", args.join(" ")));
        plan.args.extend(args);
    }
    let j = &prep.java;
    gm.launcher_line(
        run,
        LogLevel::Launcher,
        format!("Java {} ({}, {}): {}", j.version, j.vendor.clone().unwrap_or_else(|| "unbekannt".into()), j.arch, j.path),
    );
    gm.launcher_line(run, LogLevel::Launcher, format!("Version: {} · Spielordner: {}", prep.resolved.id, plan.cwd.display()));
    if let Some(w) = log4shell_warning(&prep.resolved.base_id, prep.resolved.logging.is_some() && prep.log_config.is_some()) {
        gm.launcher_line(run, LogLevel::Warn, w);
    }
    crate::afk::prepare(state, id, run, &prep, &mut plan).await;
    gm.launcher_line(run, LogLevel::Launcher, format!("Startbefehl: {}", plan.display));
    if let Some(cmd) = inst.hooks.pre_launch.as_deref().filter(|c| !c.trim().is_empty()) {
        task.stage("Pre-Launch-Befehl läuft …", Some(0.95));
        super::super::hooks::run(state, &inst, run, "Pre-Launch", cmd, Some(&prep.java.path)).await?;
        task.check()?;
    }
    task.stage("Spiel wird gestartet …", Some(0.97));

    tokio::fs::create_dir_all(&plan.cwd).await?;
    // java.exe statt javaw.exe (CREATE_NO_WINDOW verhindert das Konsolenfenster): Startfehler der
    // JVM landen so im Log statt in einem blockierenden Windows-Dialog.
    let program = super::super::java::console_java(&plan.program);
    crate::platform::gpupref::apply_for_launch(&state.paths, settings.prefer_dgpu, &program);
    let mut cmd = tokio::process::Command::new(&program);
    cmd.args(&plan.args)
        .current_dir(&plan.cwd)
        .envs(&plan.env)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(super::super::java::CREATE_NO_WINDOW);
    #[cfg(unix)]
    cmd.process_group(0);
    let child = cmd.spawn().map_err(|e| AppError::msg(format!("Spiel konnte nicht gestartet werden ({}): {e}", program.display())))?;
    gm.attach(state.clone(), run.to_string(), child);
    Ok(())
}

/// Warnung, wenn eine anfällige Version (< 1.18.1) ohne Mojangs Log-Konfiguration startet.
pub(super) fn log4shell_warning(mc: &str, has_logging: bool) -> Option<String> {
    use super::super::log4shell::{exposure, Exposure};
    let e = exposure(mc);
    if has_logging || !e.vulnerable() {
        return None;
    }
    let extra = if e == Exposure::Legacy { " Bei 1.7–1.11 wirkt die JVM-Option nicht – bitte Instanz reparieren." } else { "" };
    Some(format!(
        "Log4Shell-Warnung: Die Versionsdaten von {mc} enthalten keine Log-Konfiguration (Mojangs Schutz fehlt, z. B. kaputte oder importierte Version-JSON). Aktiv ist nur -Dlog4j2.formatMsgNoLookups=true.{extra}"
    ))
}

pub(super) fn redirect_logs(plan: &mut LaunchPlan, cfg: &std::path::Path, slot: u32) -> Option<PathBuf> {
    let xml = std::fs::read_to_string(cfg).ok()?;
    let out = super::super::sessions::rewrite_log_config(&xml, slot)?;
    let name = cfg.file_name()?.to_string_lossy().to_string();
    let target = cfg.with_file_name(format!("vibe-session-{slot}-{name}"));
    std::fs::write(&target, out).ok()?;
    let from = cfg.to_string_lossy().to_string();
    let to = target.to_string_lossy().to_string();
    let mut hit = false;
    for a in plan.args.iter_mut().filter(|a| a.contains(&from)) {
        *a = a.replace(&from, &to);
        hit = true;
    }
    hit.then(|| {
        plan.display = plan.display.replace(&from, &to);
        target
    })
}

/// `onboardAccessibility:false` in options.txt setzen (nur dieser Schlüssel, Rest bleibt unverändert).
pub(super) fn skip_onboarding(game_dir: &std::path::Path) {
    let file = game_dir.join("options.txt");
    let text = std::fs::read_to_string(&file).unwrap_or_default();
    if text.lines().any(|l| l.trim() == "onboardAccessibility:false") {
        return;
    }
    let mut out: Vec<String> = text.lines().filter(|l| !l.starts_with("onboardAccessibility:")).map(str::to_string).collect();
    out.push("onboardAccessibility:false".into());
    if let Err(e) = std::fs::create_dir_all(game_dir).and_then(|_| std::fs::write(&file, out.join("
") + "
")) {
        tracing::warn!("options.txt nicht anpassbar: {e}");
    }
}
