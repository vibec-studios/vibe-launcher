use super::*;

/// Ergebnis eines Abgleichs (für Log und Oberfläche).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SyncSummary {
    /// Übertragene/entfernte Einträge (Ordner, Server)
    pub changes: usize,
    pub conflicts: Vec<ConflictNote>,
    pub errors: Vec<String>,
    /// Neu gesammelte Screenshots
    pub screenshots: usize,
    /// Angewendete Einstellungen
    pub options: usize,
}

/// Ordner + Server-Liste (+ Screenshots) einer Instanz abgleichen. Läuft unter [`LOCK`].
pub(super) fn sync_files(root: &Path, game_dir: &Path, id: &str, name: &str, mc_version: &str, collect_shots: bool) -> SyncSummary {
    let cfg = SyncConfig::load(&config_path(root));
    let inst = cfg.for_instance(id);
    let mut sum = SyncSummary::default();
    if !inst.enabled || !AREAS.iter().any(|a| inst.has(a)) {
        return sum;
    }
    let mut st = InstanceState::load(root, id);
    let now = crate::util::now_ms();
    for area in DIR_AREAS {
        if !inst.has(area) {
            continue;
        }
        let base = st.dirs.entry(area.to_string()).or_default();
        match syncdir::sync(&game_dir.join(area), &shared_dir(root, area), &trash_dir(root, area), base, name) {
            Ok(r) => {
                sum.changes += r.changes();
                sum.errors.extend(r.errors.iter().map(|e| format!("{area}: {e}")));
                sum.conflicts.extend(r.conflicts.into_iter().map(|c| ConflictNote { at: now, area: area.to_string(), name: c.name, renamed: c.renamed }));
            }
            Err(e) => sum.errors.push(format!("{area}: {e}")),
        }
    }
    if inst.has("servers") {
        match syncservers::sync(&game_dir.join("servers.dat"), &shared_servers(root), &mut st.servers) {
            Ok(r) => sum.changes += (r.to_instance + r.to_shared) as usize,
            Err(e) => sum.errors.push(format!("servers.dat: {e}")),
        }
    }
    for area in personal::AREAS {
        if !inst.has(area) {
            continue;
        }
        match personal::sync(root, game_dir, area, mc_version, &mut st) {
            Ok((changes, conflict)) => {
                sum.changes += changes;
                sum.conflicts.extend(conflict);
            }
            Err(error) => sum.errors.push(format!("{area}: {error}")),
        }
    }
    if collect_shots && inst.has("screenshots") {
        match syncdir::collect(&game_dir.join("screenshots"), &shared_dir(root, "screenshots"), &mut st.screenshots, name) {
            Ok(n) => sum.screenshots = n,
            Err(e) => sum.errors.push(format!("screenshots: {e}")),
        }
    }
    st.last_sync = Some(now);
    st.errors = sum.errors.clone();
    st.conflicts.extend(sum.conflicts.iter().cloned());
    let len = st.conflicts.len();
    if len > 30 {
        st.conflicts.drain(..len - 30);
    }
    if let Err(e) = st.save(root, id) {
        sum.errors.push(format!("Abgleichstand: {e}"));
    }
    sum
}

pub(super) fn log_summary(what: &str, id: &str, s: &SyncSummary) {
    if s.changes + s.screenshots + s.options > 0 || !s.conflicts.is_empty() {
        tracing::info!("Sync {what} {id}: {} Änderungen, {} Einstellungen, {} Screenshots, {} Konflikte", s.changes, s.options, s.screenshots, s.conflicts.len());
    }
    for e in &s.errors {
        tracing::warn!("Sync {what} {id}: {e}");
    }
}

/// Vor dem Start: gemeinsame Ordner und Server-Liste in die Instanz holen, dann Optionen/Pack-/Shader-Auswahl schreiben.
pub fn before_launch(root: &Path, game_dir: &Path, id: &str, name: &str, mc_version: &str) -> SyncSummary {
    let _g = LOCK.lock();
    let mut s = sync_files(root, game_dir, id, name, mc_version, false);
    match apply(root, game_dir, id, mc_version) {
        Ok(n) => s.options = n,
        Err(e) => s.errors.push(format!("Optionen: {e}")),
    }
    log_summary("vor dem Start", id, &s);
    s
}

/// Nach dem Beenden: Optionen/Auswahl übernehmen, Ordner und Server-Liste abgleichen, Screenshots sammeln.
pub fn after_exit(root: &Path, game_dir: &Path, id: &str, name: &str, mc_version: &str, since: Option<i64>) -> SyncSummary {
    let _g = LOCK.lock();
    let mut errors = vec![];
    let options = match pull(root, game_dir, id, mc_version, since) {
        Ok(n) => n,
        Err(e) => {
            errors.push(format!("Optionen: {e}"));
            0
        }
    };
    let mut s = sync_files(root, game_dir, id, name, mc_version, true);
    s.options = options;
    s.errors.extend(errors);
    log_summary("nach dem Spielen", id, &s);
    s
}

/// „Jetzt abgleichen“ (Einstellungen, neu eingeschaltete Bereiche): nur Dateien und Server-Liste, keine Optionen.
/// Die Instanz darf nicht laufen (prüft der Aufrufer).
pub fn sync_now(root: &Path, game_dir: &Path, id: &str, name: &str, mc_version: &str) -> SyncSummary {
    let _g = LOCK.lock();
    let s = sync_files(root, game_dir, id, name, mc_version, true);
    log_summary("manuell", id, &s);
    s
}

/// Master-Profil sofort in die Instanzen schreiben (`(id, game_dir, mc)`). Gibt die Anzahl betroffener Instanzen zurück.
pub fn apply_all(root: &Path, targets: &[(String, PathBuf, String)]) -> AppResult<usize> {
    let _g = LOCK.lock();
    let mut n = 0;
    for (id, game, mc) in targets {
        if apply(root, game, id, mc)? > 0 {
            n += 1;
        }
    }
    Ok(n)
}

/// Konfliktmeldungen einer Instanz quittieren.
pub fn clear_conflicts(root: &Path, id: &str) -> AppResult<()> {
    let _g = LOCK.lock();
    let mut st = InstanceState::load(root, id);
    st.conflicts.clear();
    st.errors.clear();
    st.save(root, id)
}
