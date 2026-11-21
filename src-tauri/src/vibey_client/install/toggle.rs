use super::*;

/// Schalter an: Zustand merken und installieren (Task-Körper).
pub async fn enable(state: AppState, task: TaskHandle, id: String) -> AppResult<()> {
    let inst = state.instances.get(&id)?;
    if loader_name(inst.loader.kind).is_none() {
        return Err(AppError::Invalid("Der Vibey Client läuft nur mit Fabric oder NeoForge.".into()));
    }
    if state.game.is_running(&id) {
        return Err(AppError::Invalid("Die Instanz läuft gerade – bitte zuerst beenden.".into()));
    }
    task.stage("Suche den neuesten Vibey Client …", Some(0.02));
    let rel = super::super::latest(&state, true).await?;
    let mut s = load(&state, &id);
    s.enabled = true;
    save(&state, &id, &s)?;
    let log = |m: String| state.game.launcher_line(&id, LogLevel::Launcher, m);
    sync(&state, &id, &rel, &task, &log).await?;
    task.message(format!("Vibey Client {} ist installiert", rel.version));
    Ok(())
}

/// Schalter aus: verwaltetes Jar entfernen (Abhängigkeiten bleiben – andere Mods brauchen sie evtl.).
pub async fn disable(state: &AppState, id: &str) -> AppResult<()> {
    state.instances.get(id)?;
    if state.game.is_running(id) {
        return Err(AppError::Invalid("Die Instanz läuft gerade – bitte zuerst beenden.".into()));
    }
    let mut s = load(state, id);
    if let Some((p, _)) = managed_file(state, id, &s) {
        tokio::fs::remove_file(&p).await?;
    }
    s.enabled = false;
    s.file = None;
    s.version = None;
    s.sha256 = None;
    save(state, id, &s)?;
    state.content.emit_changed(id);
    Ok(())
}

/// Hook vor dem Spielstart: bei aktivem Schalter still aktualisieren. Schlägt nie fehl.
pub async fn before_launch(state: &AppState, id: &str, task: &TaskHandle) {
    let s = load(state, id);
    if !s.enabled {
        return;
    }
    let log = |m: String| state.game.launcher_line(id, LogLevel::Launcher, m);
    if !state.settings().vibe.enabled {
        log("Vibey Client: Update-Prüfung übersprungen (Vibe-Dienste aus)".into());
        return;
    }
    task.stage("Vibey Client wird geprüft …", None);
    let run = async {
        let rel = super::super::latest(state, true).await?;
        sync(state, id, &rel, task, &log).await
    };
    match tokio::time::timeout(Duration::from_secs(90), run).await {
        Ok(Ok(false)) => log(format!("Vibey Client: aktuell ({})", s.version.unwrap_or_default())),
        Ok(Ok(true)) => {}
        Ok(Err(AppError::Cancelled)) => {}
        Ok(Err(e)) => log(format!("Vibey Client: Update übersprungen: {e}")),
        Err(_) => log("Vibey Client: Update übersprungen (Zeitlimit)".into()),
    }
}

/// Neueste vom Vibey Client unterstützte Release-Version (Reihenfolge des Mojang-Manifests).
pub async fn newest_supported(state: &AppState, rel: &ClientRelease, loader: &str) -> Option<String> {
    let list = rel.mc_versions(loader);
    if list.is_empty() {
        return None;
    }
    if let Ok(m) = crate::minecraft::meta::manifest(state, false).await {
        if let Some(e) = m.versions.iter().find(|e| list.contains(&e.id)) {
            return Some(e.id.clone());
        }
    }
    list.into_iter().max_by(|a, b| cmp_versions(a, b))
}

/// Grober Versionsvergleich (1.21.10 > 1.21.9 > 1.21; 26.1 > 1.21.11).
pub fn cmp_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |s: &str| s.split(['.', '-']).map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    parse(a).cmp(&parse(b))
}
