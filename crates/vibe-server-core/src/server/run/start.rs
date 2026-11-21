use super::*;

/// Java für den Server: fester Pfad > verwaltete Runtime der Komponente > Auflösung (lädt ggf. herunter).
pub(super) async fn server_java(state: &Core, s: &Server, spec: &crate::server::install::LaunchSpec, task: Option<&crate::tasks::TaskHandle>) -> AppResult<std::path::PathBuf> {
    use crate::minecraft::java;
    if let Some(p) = s.java_path.as_deref().filter(|p| !p.trim().is_empty()) {
        return java::normalize_java_path(std::path::Path::new(p.trim()))
            .ok_or_else(|| AppError::msg(format!("Der eingestellte Java-Pfad existiert nicht: {p}")));
    }
    if let Some(c) = &spec.java_component {
        if let Some((_, p)) = java::managed_runtimes(&state.paths.java_root()).into_iter().find(|(n, _)| n == c) {
            return Ok(p);
        }
    }
    let owned;
    let task = match task {
        Some(t) => t,
        None => {
            owned = state.tasks.create("java", format!("Java {} wird vorbereitet", spec.java_major), Some(format!("server:{}", s.id)));
            &owned
        }
    };
    let r = java::resolve_with(state, None, spec.java_major, spec.java_component.as_deref(), false, &task.sub(0.0, 1.0)).await;
    task.finish(r.as_ref().map(|_| ()).map_err(|e| AppError::msg(e.to_string())));
    Ok(std::path::PathBuf::from(r?.path))
}

/// Server starten (Prozess läuft im Hintergrund weiter).
pub fn start(state: &Core, id: &str) -> AppResult<()> {
    let s = state.servers.get(id)?;
    let mgr = state.server_mgr.clone();
    if mgr.is_active(id) {
        return Err(AppError::Invalid("Der Server läuft bereits.".into()));
    }
    if s.install_state != crate::model::InstallState::Installed || s.launch.is_none() {
        return Err(AppError::Invalid("Der Server ist noch nicht (fertig) installiert.".into()));
    }
    if !s.eula {
        return Err(AppError::Invalid("Bitte zuerst die Minecraft-EULA akzeptieren.".into()));
    }
    if let Some(other) = state.servers.list().into_iter().find(|o| o.id != s.id && o.port == s.port && mgr.is_active(&o.id)) {
        return Err(AppError::Invalid(format!("Port {} wird schon vom laufenden Server „{}“ verwendet.", s.port, other.name)));
    }
    if !port_free(s.port) {
        return Err(AppError::Invalid(format!(
            "Port {} ist belegt – läuft dort schon ein anderer Server oder ein Programm? Ändere den Port in den Einstellungen.",
            s.port
        )));
    }
    mgr.ensure_flusher();
    mgr.update(id, |x| {
        x.status.state = RunState::Starting;
        x.status.exit_code = None;
        x.status.players.clear();
        x.status.detached = false;
        x.status.tunnel = None;
        x.stopping = false;
        x.restart_after = false;
        x.log.clear();
        x.seq = 0;
        x.pending.clear();
    });
    let state2 = state.clone();
    let id2 = id.to_string();
    crate::rt::spawn(async move {
        let mgr = state2.server_mgr.clone();
        if let Err(e) = spawn_process(&state2, &id2).await {
            mgr.launcher_line(&id2, LogLevel::Error, format!("Start fehlgeschlagen: {e}"));
            mgr.update(&id2, |x| {
                x.status.state = RunState::Crashed;
                x.stdin = None;
            });
            let exited = mgr.sessions.lock().get(&id2).map(|s| s.exited.clone());
            if let Some(n) = exited {
                n.notify_waiters();
            }
        }
    });
    Ok(())
}

pub(super) async fn spawn_process(state: &Core, id: &str) -> AppResult<()> {
    let mgr = state.server_mgr.clone();
    let s = state.servers.get(id)?;
    let spec = s.launch.clone().ok_or_else(|| AppError::msg("Startdaten fehlen – bitte Server reparieren."))?;
    let dir = server_dir(&state.paths, id);
    // eula.txt + Port synchronisieren
    std::fs::write(dir.join("eula.txt"), "# Akzeptiert im Vibe Launcher (https://aka.ms/MinecraftEULA)\neula=true\n")?;
    crate::server::props::set(&dir.join("server.properties"), &[("server-port".into(), s.port.to_string())])?;
    for line in crate::server::extras::before_start(state, &s) {
        mgr.launcher_line(id, LogLevel::Launcher, line);
    }
    let java = server_java(state, &s, &spec, None).await?;
    let java = crate::minecraft::java::console_java(&java);
    let mem = s.memory();
    // stdout/stderr als UTF-8 (sonst Systemcodepage unter Windows: „ℹ“ & Co. kommen als „?“ an; Java < 19 ignoriert das)
    let mut args: Vec<String> = vec![
        format!("-Xms{}M", mem.min(1024)),
        format!("-Xmx{mem}M"),
        "-Dstdout.encoding=UTF-8".into(),
        "-Dstderr.encoding=UTF-8".into(),
    ];
    let user_jvm = s.jvm_args.as_deref().map(crate::util::split_args).unwrap_or_default();
    // Log4Shell (CVE-2021-44228/-45046): JVM-Option immer, für 1.7–1.16.5 zusätzlich Mojangs gepatchte Log-Konfiguration
    let own_log4j = crate::minecraft::log4shell::has_own_config(&user_jvm);
    let log4j_cfg = if own_log4j {
        None
    } else {
        match crate::minecraft::log4shell::ensure_server_config(&state.net, &state.paths.assets().join("log_configs"), &s.mc_version).await {
            Ok(p) => p,
            Err(e) => {
                mgr.launcher_line(id, LogLevel::Warn, format!("Log4j-Schutzkonfiguration nicht verfügbar ({e}) – nur JVM-Option gesetzt."));
                None
            }
        }
    };
    let log4j_args = crate::minecraft::log4shell::server_args(&user_jvm, log4j_cfg.as_deref());
    args.extend(user_jvm);
    args.extend(log4j_args);
    args.extend(spec.args.iter().cloned());
    mgr.launcher_line(id, LogLevel::Launcher, log4shell_note(&s.mc_version, log4j_cfg.is_some(), own_log4j));
    args.push("nogui".into());
    mgr.launcher_line(id, LogLevel::Launcher, format!("Java: {}", java.display()));
    mgr.launcher_line(id, LogLevel::Launcher, format!("Startbefehl: java {}", args.join(" ")));
    let mut cmd = tokio::process::Command::new(&java);
    cmd.args(&args)
        .current_dir(&dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(crate::minecraft::java::CREATE_NO_WINDOW);
    #[cfg(unix)]
    cmd.process_group(0);
    let child = cmd.spawn().map_err(|e| AppError::msg(format!("Server konnte nicht gestartet werden: {e}")))?;
    let _ = state.servers.modify(id, |x| x.last_started = Some(crate::util::now_ms()));
    mgr.attach(state.clone(), id.to_string(), child);
    Ok(())
}

/// Hinweiszeile zum Log4Shell-Schutz fürs Server-Log.
pub(super) fn log4shell_note(mc: &str, config: bool, own_config: bool) -> String {
    let how = if own_config {
        "JVM-Option gesetzt, eigene Log4j-Konfiguration bleibt"
    } else if config {
        "JVM-Option + Mojangs gepatchte Log-Konfiguration"
    } else if crate::minecraft::log4shell::exposure(mc).vulnerable() {
        "JVM-Option gesetzt"
    } else {
        "Version bereits gepatcht, JVM-Option zusätzlich gesetzt"
    };
    format!("Log4Shell-Schutz aktiv ({how})")
}
