use super::*;

/// Bis wann (ms seit 1970) das Polling laufen darf. Die Seite verlängert alle ~10 s; schließt sie (oder lädt das
/// Fenster neu, ohne abzumelden), endet das Polling spätestens nach `LEASE_MS`.
pub(super) static LEASE_UNTIL: AtomicI64 = AtomicI64::new(0);
pub(super) static POLLING: AtomicBool = AtomicBool::new(false);
pub(super) const LEASE_MS: i64 = 25_000;
pub(super) const POLL: Duration = Duration::from_millis(1000);
pub(super) const DEBOUNCE: Duration = Duration::from_millis(500);

pub(super) fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Fingerabdruck aller `<id>.json` (Name, Größe, Änderungszeit) je Instanz – günstig: nur `read_dir` + Metadaten.
pub(super) fn signature(dirs: &[(String, PathBuf)]) -> Vec<(String, u64)> {
    use std::hash::{Hash, Hasher};
    dirs.iter()
        .map(|(iid, dir)| {
            let mut entries: Vec<(String, u64, u128)> = Vec::new();
            if let Ok(rd) = std::fs::read_dir(dir) {
                for e in rd.flatten() {
                    let name = e.file_name().to_string_lossy().to_string();
                    if !name.strip_suffix(".json").is_some_and(valid_id) {
                        continue;
                    }
                    let Ok(m) = e.metadata() else { continue };
                    let mt = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0);
                    entries.push((name, m.len(), mt));
                }
            }
            entries.sort();
            let mut h = std::collections::hash_map::DefaultHasher::new();
            entries.hash(&mut h);
            (iid.clone(), h.finish())
        })
        .collect()
}

pub(super) fn changed_instances(a: &[(String, u64)], b: &[(String, u64)]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for (iid, h) in b {
        if a.iter().find(|(x, _)| x == iid).map(|(_, y)| y) != Some(h) {
            out.push(iid.clone());
        }
    }
    for (iid, _) in a {
        if !b.iter().any(|(x, _)| x == iid) && !out.contains(iid) {
            out.push(iid.clone());
        }
    }
    out
}

/// Payload von `clips://changed`
#[derive(Debug, Clone, Serialize)]
pub struct ClipsChanged {
    pub instance_ids: Vec<String>,
}

pub(super) fn spawn_poller(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let list_dirs = || {
                let st = app.state::<AppState>();
                dirs_for(&st, None).unwrap_or_default()
            };
            let mut last = {
                let d = list_dirs();
                tokio::task::spawn_blocking(move || signature(&d)).await.unwrap_or_default()
            };
            while LEASE_UNTIL.load(Ordering::SeqCst) > now_ms() {
                tokio::time::sleep(POLL).await;
                let d = list_dirs();
                let sig = tokio::task::spawn_blocking(move || signature(&d)).await.unwrap_or_default();
                if sig == last {
                    continue;
                }
                // Entprellen: das Spiel schreibt JSON zuletzt; kurz warten, bis Ruhe ist
                tokio::time::sleep(DEBOUNCE).await;
                let d = list_dirs();
                let settled = tokio::task::spawn_blocking(move || signature(&d)).await.unwrap_or_default();
                let ids = changed_instances(&last, &settled);
                last = settled;
                if !ids.is_empty() {
                    crate::events::emit(&app, crate::events::CLIPS_CHANGED, &ClipsChanged { instance_ids: ids });
                }
            }
            POLLING.store(false, Ordering::SeqCst);
            // Zwischen Prüfung und Abmelden verlängert? Dann weiterlaufen, sonst Ende.
            if LEASE_UNTIL.load(Ordering::SeqCst) > now_ms() && !POLLING.swap(true, Ordering::SeqCst) {
                continue;
            }
            break;
        }
    });
}

/// Polling der Clip-Ordner an (`active`, verlängert die Laufzeit um ~25 s) oder aus. Solange es läuft, sendet das
/// Backend `clips://changed`, wenn `<id>.json` dazukommen, sich ändern oder verschwinden (entprellt ~500 ms).
#[tauri::command]
pub async fn clips_watch(app: AppHandle, active: bool) -> AppResult<()> {
    if active {
        LEASE_UNTIL.store(now_ms() + LEASE_MS, Ordering::SeqCst);
        if !POLLING.swap(true, Ordering::SeqCst) {
            spawn_poller(app);
        }
    } else {
        LEASE_UNTIL.store(0, Ordering::SeqCst);
    }
    Ok(())
}
