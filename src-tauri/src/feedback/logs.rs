use super::*;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum Cut {
    /// Ende behalten (Logs)
    Tail,
    /// Anfang behalten (Crash-Reports: Ursache steht oben)
    Head,
}

pub(super) struct Source {
    pub(super) name: String,
    pub(super) path: PathBuf,
    pub(super) kind: &'static str,
    pub(super) cut: Cut,
}

pub(super) fn newest(dir: &Path, accept: impl Fn(&str) -> bool) -> Option<(PathBuf, SystemTime)> {
    let mut best: Option<(PathBuf, SystemTime)> = None;
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Ok(m) = e.metadata() else { continue };
        if !m.is_file() || !accept(&name) {
            continue;
        }
        let t = m.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        if best.as_ref().map_or(true, |(_, bt)| t > *bt) {
            best = Some((e.path(), t));
        }
    }
    best
}

pub(super) fn sources(state: &AppState, instance_id: Option<&str>) -> Vec<Source> {
    let mut out = Vec::new();
    // Launcher-Log (täglich rotiert: launcher.log.YYYY-MM-DD)
    if let Some((p, _)) = newest(&state.paths.launcher_logs(), |n| n.starts_with("launcher.log")) {
        out.push(Source { name: "launcher.log".into(), path: p, kind: "launcher", cut: Cut::Tail });
    }
    let Some(id) = instance_id.filter(|id| state.instances.get(id).is_ok()) else { return out };
    let game = state.paths.game_dir(id);
    let latest = game.join("logs").join("latest.log");
    if latest.is_file() {
        out.push(Source { name: "latest.log".into(), path: latest, kind: "game", cut: Cut::Tail });
    }
    let crash_dir = game.join("crash-reports");
    // Crash-Report der letzten Sitzung, sonst der neueste, wenn er frisch ist
    let from_session = state
        .game
        .states()
        .into_iter()
        .find(|s| s.instance_id == id)
        .and_then(|s| s.crash_report)
        .map(PathBuf::from)
        .filter(|p| p.is_file() && p.parent().is_some_and(|d| same_dir(d, &crash_dir)));
    let crash = from_session.or_else(|| {
        newest(&crash_dir, |n| n.to_ascii_lowercase().ends_with(".txt"))
            .filter(|(_, t)| t.elapsed().map(|e| e < CRASH_MAX_AGE).unwrap_or(false))
            .map(|(p, _)| p)
    });
    if let Some(p) = crash {
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "crash-report.txt".into());
        out.push(Source { name, path: p, kind: "crash", cut: Cut::Head });
    }
    out.truncate(MAX_FILES);
    out
}

pub(super) fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// Welche Logs angehängt würden (Name, Größe) – für die Liste im Dialog.
pub fn available_logs(state: &AppState, instance_id: Option<&str>) -> Vec<AvailableLog> {
    sources(state, instance_id)
        .into_iter()
        .map(|s| AvailableLog { bytes: std::fs::metadata(&s.path).map(|m| m.len()).unwrap_or(0), name: s.name, kind: s.kind.to_string() })
        .collect()
}

/// Datei lesen und auf `max` Bytes kürzen (Ende oder Anfang behalten, an Zeilengrenzen).
/// Liefert (Text, Originalgröße, gekürzt).
pub(super) fn read_cut(path: &Path, max: u64, cut: Cut) -> std::io::Result<(String, u64, bool)> {
    let mut f = std::fs::File::open(path)?;
    let len = f.metadata()?.len();
    let mut buf = Vec::new();
    let truncated = len > max;
    if truncated && cut == Cut::Tail {
        f.seek(SeekFrom::Start(len - max))?;
    }
    f.take(max).read_to_end(&mut buf)?;
    let mut text = String::from_utf8_lossy(&buf).into_owned();
    if truncated {
        match cut {
            Cut::Tail => {
                // angeschnittene erste Zeile weg
                if let Some(i) = text.find('\n') {
                    text = text[i + 1..].to_string();
                }
                text = format!("[Vibe Launcher: Anfang gekürzt – nur die letzten {} KB]\n{text}", max / 1024);
            }
            Cut::Head => {
                if let Some(i) = text.rfind('\n') {
                    text.truncate(i + 1);
                }
                text.push_str(&format!("[Vibe Launcher: Ende gekürzt – nur die ersten {} KB]\n", max / 1024));
            }
        }
    }
    Ok((text, len, truncated))
}

/// Bereinigtes Log für den Versand.
pub fn clean_log(name: &str, raw: &str, original_bytes: u64, truncated: bool, known: &redact::Known) -> LogPreview {
    let r = redact::redact(raw, known);
    let mut text = r.text;
    if text.len() > LOG_LIMIT {
        let mut cut = text.len() - LOG_LIMIT;
        while !text.is_char_boundary(cut) {
            cut += 1;
        }
        text = text[cut..].to_string();
    }
    LogPreview { name: name.to_string(), original_bytes, bytes: text.len() as u64, truncated, redactions: r.count, text }
}
