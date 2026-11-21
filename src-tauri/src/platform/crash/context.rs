/// Rahmenbedingungen der Auswertung.
#[derive(Debug, Clone, Default)]
pub struct Ctx {
    pub exit_code: Option<i32>,
    /// Ein Crash-Report gehört zur Sitzung
    pub crash_report: bool,
    pub max_memory_mb: u32,
    /// Gesamter Arbeitsspeicher des Systems (0 = unbekannt)
    pub system_memory_mb: u32,
    pub mc_version: Option<String>,
    /// fabric | quilt | forge | neoforge
    pub loader: Option<String>,
}

/// Empfohlene Java-Version für eine Minecraft-Version.
pub fn recommended_java(mc: &str) -> Option<u32> {
    let nums: Vec<u32> = mc.split(|c: char| !c.is_ascii_digit()).filter(|s| !s.is_empty()).take(3).filter_map(|s| s.parse().ok()).collect();
    if mc.starts_with("1.") {
        let minor = *nums.get(1)?;
        let patch = nums.get(2).copied().unwrap_or(0);
        return Some(match (minor, patch) {
            (0..=16, _) => 8,
            (17..=19, _) | (20, 0..=4) => 17,
            _ => 21,
        });
    }
    // Neue Versionsnummern ab 2026 (26.1 …)
    match nums.first() {
        Some(y) if *y >= 26 && !mc.contains('w') => Some(25),
        _ => None,
    }
}

/// Vorschlag für mehr RAM: +50 %, auf 1024 gerundet, mindestens 4 GB, höchstens 16 GB – und nie mehr, als das System
/// hergibt (mind. 3 GB bzw. ein Viertel bleiben frei). Gleich `current` = mehr geht nicht.
pub fn suggest_ram(current: u32, system_mb: u32) -> u32 {
    let cap = if system_mb == 0 { 16384 } else { (system_mb.saturating_sub(3072).min(system_mb / 4 * 3) / 1024 * 1024).clamp(2048, 16384) };
    let v = ((current as f64 * 1.5) / 1024.0).ceil() as u32 * 1024;
    v.clamp(4096, 16384).max(current + 1024).min(cap).max(current)
}

/// Versionsvergleich für Fehlermeldungen (Zahlenblöcke, Rest ignoriert).
pub(super) fn cmp_version(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |s: &str| -> Vec<u64> {
        s.split(['+', '-', ' ']).next().unwrap_or(s).split(|c: char| !c.is_ascii_digit()).filter(|x| !x.is_empty()).filter_map(|x| x.parse().ok()).collect()
    };
    parse(a).cmp(&parse(b))
}

/// Braucht die Anforderung eine neuere Version als die vorhandene? `None` = unklar.
pub(super) fn needs_newer(range: &str, present: &str) -> Option<bool> {
    let r = range.trim();
    let l = r.to_ascii_lowercase();
    if l.contains("or later") || l.contains("or above") || l.contains("or newer") || l.starts_with(">=") || l.starts_with('>') {
        return Some(true);
    }
    if l.contains("or earlier") || l.contains("or below") || l.contains("before") || l.starts_with('<') {
        return Some(false);
    }
    // Maven-Bereich: [a,b) / [a,)
    if let Some(inner) = r.strip_prefix(['[', '(']) {
        let inner = inner.trim_end_matches([']', ')']);
        let mut it = inner.split(',');
        let lo = it.next().unwrap_or("").trim();
        if !lo.is_empty() && cmp_version(present, lo).is_lt() {
            return Some(true);
        }
        return Some(false);
    }
    // „version 1.2.3“ / „any 1.20.x version“
    let v = l.trim_start_matches("version ").trim_start_matches("any ").trim_end_matches(" version");
    if v.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        return Some(cmp_version(present, v).is_lt());
    }
    None
}

/// „any version“ -> "", „version 13.0.0 or later“ -> „13.0.0 or later“
pub(super) fn clean_range(r: &str) -> String {
    let r = r.trim();
    if r.eq_ignore_ascii_case("any version") || r == "*" {
        return String::new();
    }
    r.strip_prefix("version ").unwrap_or(r).to_string()
}
