use super::*;

// ------------------------------------------------------------------ CurseForge App

/// `minecraftinstance.json`: `allocatedMemory` (bei `isMemoryOverride`), `javaArgsOverride`.
pub fn curseforge(v: &Value) -> ExtSettings {
    let mut s = ExtSettings::default();
    if boolean(v.get("isMemoryOverride")).unwrap_or(v.get("isMemoryOverride").is_none()) {
        s.max_memory_mb = num(v.get("allocatedMemory"));
    }
    s.jvm_args = text(v.get("javaArgsOverride"));
    s.sanitize()
}

// ------------------------------------------------------------------ ATLauncher

/// `instance.json` (`launcher.*`) mit Rückfall auf `configs/ATLauncher.json` (globale Standards).
pub fn atlauncher(l: &Value, global: Option<&Value>) -> ExtSettings {
    let mut s = ExtSettings::default();
    let gl = |k: &str| global.and_then(|g| g.get(k)).filter(|v| !v.is_null());
    let li = |k: &str| l.get(k).filter(|v| !v.is_null());
    if num(li("maximumMemory")).is_some() {
        s.max_memory_mb = num(li("maximumMemory"));
        s.min_memory_mb = num(li("initialMemory"));
    } else if num(gl("maximumMemory")).is_some() {
        s.max_memory_mb = num(gl("maximumMemory"));
        s.min_memory_mb = num(gl("initialMemory"));
        s.inherit("memory");
    }
    // „Java von Minecraft verwenden“ (Standard: an) hat Vorrang vor einem eigenen Pfad
    let mojang_java = boolean(li("useJavaProvidedByMinecraft")).or(boolean(gl("useJavaProvidedByMinecraft"))).unwrap_or(true);
    if !mojang_java {
        s.java_path = text(li("javaPath"));
    }
    if let Some(a) = text(li("javaArguments")) {
        s.jvm_args = Some(a);
    } else if let Some(a) = text(gl("javaParameters")) {
        s.jvm_args = Some(a);
        s.inherit("jvm_args");
    }
    if let (Some(w), Some(h)) = (num(gl("windowWidth")), num(gl("windowHeight"))) {
        (s.width, s.height) = (Some(w), Some(h));
        s.inherit("window");
    }
    let inst_cmds = boolean(li("enableCommands"));
    if inst_cmds.or(boolean(gl("enableCommands"))) == Some(true) {
        let from_inst = inst_cmds == Some(true);
        let cmd = |k: &str| if from_inst { text(li(k)) } else { text(gl(k)) }.map(|c| shell_vars(&c));
        (s.pre_launch, s.post_exit, s.wrapper) = (cmd("preLaunchCommand"), cmd("postExitCommand"), cmd("wrapperCommand"));
        if !from_inst {
            s.inherit("hooks");
        }
    }
    s.sanitize()
}

/// Globale ATLauncher-Einstellungen (`<wurzel>/configs/ATLauncher.json`) zu einem Instanzordner.
/// Nur diese Schlüssel werden behalten (Proxy-Daten usw. der Launcher-Konfiguration werden verworfen).
pub fn atlauncher_global(instance_dir: &Path) -> Option<Value> {
    const KEYS: &[&str] = &[
        "initialMemory", "maximumMemory", "javaParameters", "windowWidth", "windowHeight", "useJavaProvidedByMinecraft",
        "enableCommands", "preLaunchCommand", "postExitCommand", "wrapperCommand",
    ];
    let root = instance_dir.parent()?.parent()?;
    let v: Value = serde_json::from_slice(&std::fs::read(root.join("configs").join("ATLauncher.json")).ok()?).ok()?;
    Some(Value::Object(v.as_object()?.iter().filter(|(k, _)| KEYS.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect()))
}

/// Modpack-Herkunft aus ATLauncher (Modrinth/CurseForge-Packs).
pub fn atlauncher_pack(l: &Value) -> Option<PackSource> {
    use crate::instance::PackSourceKind;
    let id = |v: Option<&Value>| v.and_then(|x| x.get("id")).and_then(|x| x.as_str().map(str::to_string).or_else(|| x.as_u64().map(|n| n.to_string())));
    let name = text(l.get("pack"));
    let version_name = text(l.get("version"));
    if let Some(pid) = id(l.get("modrinthProject")) {
        return Some(PackSource { kind: PackSourceKind::Modrinth, project_id: Some(pid), version_id: id(l.get("modrinthVersion")), name, version_name });
    }
    if let Some(pid) = id(l.get("curseForgeProject")) {
        return Some(PackSource { kind: PackSourceKind::Curseforge, project_id: Some(pid), version_id: id(l.get("curseForgeFile")), name, version_name });
    }
    None
}

// ------------------------------------------------------------------ NoRisk Client

/// Profil-`settings` (JSON) des NoRisk-Launchers. Standard-Profile (`is_standard_version`) nutzen RAM und
/// JVM-Argumente aus `launcher_config.json` (wie der NoRisk-Launcher beim Start), alle Profile die globalen Hooks.
pub fn norisk(settings: &Value, group: Option<String>, description: Option<String>, is_standard: bool, global: &crate::content::norisk::global::NrGlobal) -> ExtSettings {
    let mut s = ExtSettings::default();
    let mem = settings.get("memory").filter(|m| m.is_object());
    let gmem = Some(&global.memory).filter(|m| m.is_object());
    match (is_standard, mem, gmem) {
        (true, _, Some(g)) | (false, None, Some(g)) => {
            s.min_memory_mb = num(g.get("min"));
            s.max_memory_mb = num(g.get("max"));
            s.inherit("memory");
        }
        (_, m, _) => {
            s.min_memory_mb = num(m.and_then(|m| m.get("min")));
            s.max_memory_mb = num(m.and_then(|m| m.get("max")));
        }
    }
    if boolean(settings.get("use_custom_java_path")) == Some(true) {
        s.java_path = text(settings.get("java_path"));
    }
    if is_standard {
        s.jvm_args = global.jvm_args.clone();
        s.inherit("jvm_args");
    } else {
        s.jvm_args = text(settings.get("custom_jvm_args"));
    }
    if let Some(r) = settings.get("resolution").filter(|r| r.is_object()) {
        (s.width, s.height) = (num(r.get("width")), num(r.get("height")));
    }
    if boolean(settings.get("fullscreen")) == Some(true) {
        s.fullscreen = Some(true);
    }
    (s.pre_launch, s.wrapper, s.post_exit) = (global.pre_launch.clone(), global.wrapper.clone(), global.post_exit.clone());
    s.inherit("hooks");
    s.notes = description;
    s.group = group;
    s.sanitize()
}
