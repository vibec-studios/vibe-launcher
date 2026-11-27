use super::*;

pub(super) fn instance_meta(state: &AppState, id: &str) -> Option<Value> {
    let inst = state.instances.get(id).ok()?;
    let mods = std::fs::read_dir(state.paths.game_dir(id).join("mods"))
        .map(|rd| rd.flatten().filter(|e| e.file_name().to_string_lossy().to_ascii_lowercase().ends_with(".jar")).count())
        .unwrap_or(0);
    let loader = if inst.is_bedrock() { "bedrock".to_string() } else { inst.loader.kind.as_str().to_string() };
    let java = if inst.is_bedrock() { None } else { java_from_session(&state.game.session_log(id)) };
    Some(json!({
        "mc_version": inst.mc_version,
        "loader": loader,
        "loader_version": inst.loader.version,
        "custom_loader": inst.custom_loader,
        "mod_count": mods,
        "java": java,
    }))
}

/// „Java 21.0.5 (Microsoft, x64)“ aus der Startzeile der letzten Sitzung – ohne den Pfad.
pub fn java_from_session(lines: &[crate::minecraft::LogLine]) -> Option<String> {
    lines.iter().rev().find_map(|l| {
        let t = l.text.strip_prefix("Java ")?;
        if l.logger.as_deref() != Some("Vibe Launcher") {
            return None;
        }
        let end = t.find("): ").map(|i| i + 1).unwrap_or(t.len());
        Some(format!("Java {}", &t[..end]))
    })
}

pub fn os_name() -> String {
    sysinfo::System::long_os_version().unwrap_or_else(|| std::env::consts::OS.to_string())
}

pub(super) fn clean_page(p: Option<&str>) -> Option<String> {
    let p = p?.trim();
    // Nur der Pfad (keine Suchbegriffe aus der Query)
    let p = p.split(['?', '#']).next().unwrap_or_default();
    (p.starts_with('/') && p.len() <= 200).then(|| p.to_string())
}

/// Eingaben prüfen und `meta` bauen (ohne Zustand, testbar).
pub fn build_meta(d: &Draft, version: &str, channel: &str, os: &str, arch: &str, instance: Option<Value>) -> AppResult<Value> {
    if !matches!(d.kind.as_str(), "bug" | "idea" | "other") {
        return Err(AppError::Invalid("Unbekannte Art der Meldung".into()));
    }
    let message = d.message.trim();
    let n = message.chars().count();
    if n < MESSAGE_MIN {
        return Err(AppError::Invalid(format!("Bitte beschreibe es etwas genauer (mindestens {MESSAGE_MIN} Zeichen).")));
    }
    if n > MESSAGE_MAX {
        return Err(AppError::Invalid(format!("Der Text ist zu lang (höchstens {MESSAGE_MAX} Zeichen).")));
    }
    let contact = d.contact.as_deref().map(str::trim).filter(|c| !c.is_empty());
    if contact.is_some_and(|c| c.chars().count() > CONTACT_MAX) {
        return Err(AppError::Invalid(format!("Die Kontaktangabe ist zu lang (höchstens {CONTACT_MAX} Zeichen).")));
    }
    let locale: String = d.locale.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(16).collect();
    Ok(json!({
        "kind": d.kind,
        "message": message,
        "contact": contact,
        "app": "launcher",
        "version": version,
        "channel": if channel == "dev" { "dev" } else { "release" },
        "os": os,
        "arch": arch,
        "locale": if locale.is_empty() { "de".to_string() } else { locale },
        "page": clean_page(d.page.as_deref()),
        "instance": instance,
    }))
}
