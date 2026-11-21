use super::*;

// ------------------------------------------------------------------ Prism / MultiMC

/// `instance.cfg` (+ globale `prismlauncher.cfg`/`multimc.cfg`, Gruppe aus `instgroups.json`).
pub fn prism(cfg: &HashMap<String, String>, global: &HashMap<String, String>, group: Option<String>) -> ExtSettings {
    let mut s = ExtSettings::default();
    let on = |k: &str| cfg.get(k).is_some_and(|v| v.eq_ignore_ascii_case("true"));
    let get = |m: &HashMap<String, String>, k: &str| m.get(k).cloned().filter(|v| !v.trim().is_empty());
    let n = |m: &HashMap<String, String>, k: &str| m.get(k).and_then(|v| v.trim().parse::<u32>().ok());
    // RAM
    if on("OverrideMemory") {
        s.min_memory_mb = n(cfg, "MinMemAlloc");
        s.max_memory_mb = n(cfg, "MaxMemAlloc");
    } else if global.contains_key("MaxMemAlloc") {
        s.min_memory_mb = n(global, "MinMemAlloc");
        s.max_memory_mb = n(global, "MaxMemAlloc");
        s.inherit("memory");
    }
    // Java (nur ein fester Pfad der Instanz – die globale Wahl macht Prism je Version selbst)
    if on("OverrideJavaLocation") || on("OverrideJava") {
        s.java_path = get(cfg, "JavaPath");
        s.java_version = get(cfg, "JavaVersion");
    }
    if on("OverrideJavaArgs") {
        s.jvm_args = get(cfg, "JvmArgs");
    } else if let Some(a) = get(global, "JvmArgs") {
        s.jvm_args = Some(a);
        s.inherit("jvm_args");
    }
    // Fenster (LaunchMaximized hat in Vibe keine Entsprechung)
    let win = |m: &HashMap<String, String>| (n(m, "MinecraftWinWidth"), n(m, "MinecraftWinHeight"));
    if on("OverrideWindow") {
        (s.width, s.height) = win(cfg);
    } else if global.contains_key("MinecraftWinWidth") {
        (s.width, s.height) = win(global);
        s.inherit("window");
    }
    // Start-Befehle
    let cmds = |m: &HashMap<String, String>| (get(m, "PreLaunchCommand").map(|c| shell_vars(&c)), get(m, "PostExitCommand").map(|c| shell_vars(&c)), get(m, "WrapperCommand").map(|c| shell_vars(&c)));
    if on("OverrideCommands") {
        (s.pre_launch, s.post_exit, s.wrapper) = cmds(cfg);
    } else {
        (s.pre_launch, s.post_exit, s.wrapper) = cmds(global);
        s.inherit("hooks");
    }
    // Umgebungsvariablen (Prism 9: JSON-Objekt)
    let env = |m: &HashMap<String, String>| m.get("Env").filter(|v| !v.starts_with('@')).and_then(|v| serde_json::from_str::<Value>(v).ok()).and_then(|v| env_of(&v));
    if on("OverrideEnv") {
        s.env = env(cfg).unwrap_or_default();
    } else if let Some(e) = env(global).filter(|e| !e.is_empty()) {
        s.env = e;
        s.inherit("env");
    }
    s.notes = cfg.get("notes").cloned();
    s.group = group;
    s.sanitize()
}

/// Gruppe einer Prism-Instanz aus `<instanzen>/instgroups.json`.
pub fn prism_group(instances_dir: &Path, folder: &str) -> Option<String> {
    let v: Value = serde_json::from_slice(&std::fs::read(instances_dir.join("instgroups.json")).ok()?).ok()?;
    v.get("groups")?.as_object()?.iter().find_map(|(name, g)| {
        g.get("instances")?.as_array()?.iter().any(|i| i.as_str().is_some_and(|i| i.eq_ignore_ascii_case(folder))).then(|| name.clone())
    })
}

/// Modpack-Herkunft aus Prism (`ManagedPack…`).
pub fn prism_pack(cfg: &HashMap<String, String>) -> Option<PackSource> {
    if !cfg.get("ManagedPack").is_some_and(|v| v == "true") {
        return None;
    }
    let kind = match cfg.get("ManagedPackType").map(|s| s.to_ascii_lowercase()).as_deref() {
        Some("modrinth") => crate::instance::PackSourceKind::Modrinth,
        Some("flame") | Some("curseforge") => crate::instance::PackSourceKind::Curseforge,
        _ => return None,
    };
    let get = |k: &str| cfg.get(k).cloned().filter(|v| !v.trim().is_empty());
    Some(PackSource { kind, project_id: Some(get("ManagedPackID")?), version_id: get("ManagedPackVersionID"), name: get("ManagedPackName"), version_name: get("ManagedPackVersionName") })
}
