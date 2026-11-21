use super::*;

pub(super) fn modified(p: &Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// Pfad muss im Spielordner der Instanz liegen.
pub(super) fn inside(base: &Path, p: &str) -> Option<std::path::PathBuf> {
    let c = std::path::PathBuf::from(p).canonicalize().ok()?;
    let b = base.canonicalize().ok()?;
    c.starts_with(&b).then_some(c)
}

/// Protokolle des letzten Starts: Crash-Report, JVM-Absturzdatei (hs_err), latest.log, Konsolenausgabe.
/// Ältere Dateien (von einem früheren Start) werden ausgelassen.
pub fn collect_sources(game: &Path, crash_report: Option<&str>, started_ms: Option<i64>, session: &str) -> Vec<LogText> {
    use std::time::{Duration, UNIX_EPOCH};
    let started = started_ms.map(|ms| UNIX_EPOCH + Duration::from_millis(ms.max(0) as u64) - Duration::from_secs(5));
    let mut out = vec![];
    let report = crash_report.and_then(|p| inside(game, p).or_else(|| inside(game, &game.join(p).to_string_lossy())));
    let report_time = report.as_deref().and_then(modified);
    if let Some(p) = &report {
        let name = p.strip_prefix(game.canonicalize().unwrap_or_default()).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_else(|_| "crash-report".into());
        out.extend(LogText::read(p, name));
    }
    // Gehört der gewählte Crash-Report zu einem früheren Start, passen latest.log/Konsole nicht dazu
    let newer_than_report = |t: Option<std::time::SystemTime>| match (report_time, t) {
        (Some(r), Some(t)) => t.duration_since(r).map(|d| d > Duration::from_secs(600)).unwrap_or(false),
        _ => false,
    };
    // JVM-Absturz (nativer Code, oft Grafiktreiber)
    if let (Some(since), Ok(rd)) = (started, std::fs::read_dir(game)) {
        let mut best: Option<(std::time::SystemTime, std::path::PathBuf)> = None;
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.starts_with("hs_err_pid") && n.ends_with(".log") {
                if let Some(t) = modified(&e.path()).filter(|t| *t >= since) {
                    if best.as_ref().map(|(b, _)| t > *b).unwrap_or(true) {
                        best = Some((t, e.path()));
                    }
                }
            }
        }
        if let Some((_, p)) = best {
            let n = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            out.extend(LogText::read(&p, n));
        }
    }
    let latest = game.join("logs").join("latest.log");
    let lt = modified(&latest);
    let stale = match (started, lt) {
        (Some(s), Some(t)) => t < s,
        _ => false,
    };
    if !stale && !newer_than_report(lt) {
        out.extend(LogText::read(&latest, "logs/latest.log"));
    }
    if !session.trim().is_empty() && !newer_than_report(started) {
        out.push(LogText::new("console", session));
    }
    out
}

/// Crash-Report (falls angegeben), `latest.log` und Sitzungs-Log einer Instanz auswerten.
pub async fn analyze_instance(
    state: &crate::state::AppState,
    instance_id: &str,
    crash_report: Option<String>,
    exit_code: Option<i32>,
) -> crate::error::AppResult<Vec<Diagnosis>> {
    let inst = state.instances.get(instance_id)?;
    let game = state.paths.game_dir(instance_id);
    let key = state.game.latest_crash(instance_id).map(|s| s.run_id).unwrap_or_else(|| instance_id.to_string());
    let session: String = state.game.session_log(&key).iter().map(|l| format!("{}\n", l.text)).collect();
    let started = state.game.state_of(&key).and_then(|s| s.started_at);
    let loader = match inst.loader.kind {
        crate::instance::LoaderKind::Vanilla => None,
        k => serde_json::to_value(k).ok().and_then(|v| v.as_str().map(String::from)),
    };
    let ctx = Ctx {
        exit_code,
        crash_report: crash_report.is_some(),
        max_memory_mb: inst.java.max_memory_mb.unwrap_or(state.settings().max_memory_mb),
        system_memory_mb: crate::settings::system_memory_mb().min(u32::MAX as u64) as u32,
        mc_version: Some(inst.mc_version.clone()),
        loader,
    };
    tokio::task::spawn_blocking(move || {
        let sources = collect_sources(&game, crash_report.as_deref(), started, &session);
        let mods = ModIndex::scan(&game.join("mods"));
        analyze(&sources, &ctx, &mods)
    })
    .await
    .map_err(|e| crate::error::AppError::msg(e.to_string()))
}
