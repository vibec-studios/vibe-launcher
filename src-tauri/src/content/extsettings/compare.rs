use super::*;

// ------------------------------------------------------------------ Übernehmen / Vergleichen

/// Gewählte Bereiche in die Instanz schreiben (nur vorhandene Werte; Umgebungsvariablen werden ergänzt).
pub fn apply(inst: &mut Instance, s: &ExtSettings, keys: &HashSet<String>) {
    let on = |k: &str| keys.contains(k);
    if on("memory") {
        if s.max_memory_mb.is_some() {
            inst.java.max_memory_mb = s.max_memory_mb;
        }
        if s.min_memory_mb.is_some() {
            inst.java.min_memory_mb = s.min_memory_mb;
        }
    }
    if on("java") && s.java_path.is_some() {
        inst.java.path = s.java_path.clone();
    }
    if on("jvm_args") && s.jvm_args.is_some() {
        inst.java.jvm_args = s.jvm_args.clone();
    }
    if on("env") {
        for (k, v) in &s.env {
            inst.java.env.insert(k.clone(), v.clone());
        }
    }
    if on("window") {
        if s.width.is_some() && s.height.is_some() {
            inst.window.width = s.width;
            inst.window.height = s.height;
        }
        if s.fullscreen.is_some() {
            inst.window.fullscreen = s.fullscreen;
        }
    }
    if on("hooks") {
        if s.pre_launch.is_some() {
            inst.hooks.pre_launch = s.pre_launch.clone();
        }
        if s.post_exit.is_some() {
            inst.hooks.post_exit = s.post_exit.clone();
        }
        if s.wrapper.is_some() {
            inst.hooks.wrapper = s.wrapper.clone();
        }
    }
    if on("notes") && s.notes.is_some() {
        inst.notes = s.notes.clone();
    }
    if on("group") && s.group.is_some() {
        inst.group = s.group.clone();
    }
}

/// Teil der Instanz, den ein Bereich betrifft (für „alt → neu“).
pub(super) fn part(inst: &Instance, key: &str) -> Value {
    match key {
        "memory" => json!({ "min": inst.java.min_memory_mb, "max": inst.java.max_memory_mb }),
        "java" => json!({ "path": inst.java.path }),
        "jvm_args" => json!(inst.java.jvm_args),
        "env" => json!(inst.java.env.iter().collect::<BTreeMap<_, _>>()),
        "window" => json!({ "width": inst.window.width, "height": inst.window.height, "fullscreen": inst.window.fullscreen }),
        "hooks" => json!({ "pre_launch": inst.hooks.pre_launch, "post_exit": inst.hooks.post_exit, "wrapper": inst.hooks.wrapper }),
        "notes" => json!(inst.notes),
        "group" => json!(inst.group),
        _ => Value::Null,
    }
}

/// Wert ist leer/Standard (dann ist Überschreiben unkritisch und standardmäßig an).
pub(super) fn blank(v: &Value) -> bool {
    match v {
        Value::Null => true,
        Value::String(s) => s.trim().is_empty(),
        Value::Object(m) => m.values().all(blank),
        Value::Array(a) => a.is_empty(),
        _ => false,
    }
}

/// Eine Abweichung zwischen Vibe-Instanz und fremdem Launcher.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Change {
    pub key: String,
    pub old: Value,
    pub new: Value,
    /// Vorausgewählt (nicht bei Start-Befehlen und nicht, wenn in Vibe schon ein eigener Wert steht)
    pub default_on: bool,
    /// Wert stammt aus den Standard-Einstellungen des fremden Launchers
    pub inherited: bool,
}

/// Bereiche, in denen sich die Übernahme von `s` auswirken würde.
pub fn diff(inst: &Instance, s: &ExtSettings) -> Vec<Change> {
    let mut out = Vec::new();
    for key in KEYS {
        if !s.has(key) {
            continue;
        }
        let mut after = inst.clone();
        apply(&mut after, s, &HashSet::from([key.to_string()]));
        let (old, mut new) = (part(inst, key), part(&after, key));
        if old == new {
            continue;
        }
        if key == "java" {
            new["version"] = json!(s.java_version);
        }
        // Umgebungsvariablen: nur Ergänzungen sind unkritisch
        let conflict = if key == "env" { s.env.keys().any(|k| inst.java.env.contains_key(k)) } else { !blank(&old) };
        out.push(Change { key: key.to_string(), old, new, default_on: default_on(key) && !conflict, inherited: s.inherited.iter().any(|k| k == key) });
    }
    out
}
