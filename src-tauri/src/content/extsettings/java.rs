use super::*;

// ------------------------------------------------------------------ Java prüfen

/// Benötigte Java-Hauptversion (Faustregel; `None` = unbekanntes Versionsformat).
pub fn java_major_for(mc: &str) -> Option<u32> {
    let mut it = mc.split(['.', '-', ' ']).map(|x| x.parse::<u32>().ok());
    let (a, b, c) = (it.next().flatten()?, it.next().flatten(), it.next().flatten().unwrap_or(0));
    if a >= 25 {
        // Jahres-Versionen (26.1 …)
        return Some(21);
    }
    if a != 1 {
        return None;
    }
    let b = b?;
    Some(match b {
        0..=16 => 8,
        17 => 16,
        18 | 19 => 17,
        20 if c < 5 => 17,
        _ => 21,
    })
}

/// Passt eine Java-Hauptversion zur Minecraft-Version? Alte Versionen (< 1.17) brauchen Java 8.
pub fn java_fits(major: u32, mc: &str) -> bool {
    match java_major_for(mc) {
        Some(8) => major == 8,
        Some(req) => major >= req,
        None => major >= 8,
    }
}

/// Java-Pfad prüfen (existiert, startet, passende Version). Ungültig -> Pfad entfernen (automatische Wahl) + Hinweis.
pub async fn check_java(s: &mut ExtSettings, mc: &str) -> Option<String> {
    let p = s.java_path.clone()?;
    let Some(exe) = crate::minecraft::java::normalize_java_path(Path::new(&p)) else {
        s.java_path = None;
        return Some(format!("Java-Pfad {p} existiert nicht – Vibe wählt Java automatisch."));
    };
    match crate::minecraft::java::probe(&exe, false).await {
        Ok(j) if java_fits(j.major, mc) => {
            s.java_path = Some(exe.to_string_lossy().to_string());
            s.java_version = Some(j.version);
            None
        }
        Ok(j) => {
            s.java_path = None;
            Some(format!("Java {} passt nicht zu Minecraft {mc} – Vibe wählt Java automatisch.", j.major))
        }
        Err(_) => {
            s.java_path = None;
            Some(format!("{p} ist keine gültige Java-Installation – Vibe wählt Java automatisch."))
        }
    }
}

/// Für die Übernahme vorbereiten: Vibe-Standards berücksichtigen, Java prüfen (nur wenn gewählt).
pub async fn prepare(vibe: &Settings, s: &ExtSettings, mc: &str, check: bool) -> (ExtSettings, Option<String>) {
    let mut s = s.clone().effective(vibe);
    let note = if check { check_java(&mut s, mc).await } else { None };
    (s, note)
}
