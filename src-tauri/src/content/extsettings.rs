//! Einstellungen der Instanz aus einem anderen Launcher (RAM, Java, JVM-Argumente, Umgebungsvariablen,
//! Fenster, Start-Befehle, Notizen, Gruppe) – auslesen, mit der Vibe-Instanz vergleichen und übernehmen.
//! Quellen je Launcher: docs/IMPORT-SETTINGS.md.
//!
//! - Beim Import übernimmt `external::run_import` die gewählten Bereiche (`KEYS`, Standard: alle außer
//!   Start-Befehlen – die laufen auf dem Rechner und werden nur nach ausdrücklicher Wahl übernommen).
//! - Nachträglich: [`pending`] (alle importierten Instanzen mit Unterschieden in Einstellungen oder Daten),
//!   [`offer`] (eine Instanz), [`apply_offer`] (gewählte Werte setzen; Daten nach [`super::gamedata`]: fehlende
//!   nur hinzufügen, Überschreiben nur pro Eintrag ausdrücklich, vorher Snapshot bzw. Welt-Backup).
//! - Fremde Ordner werden nur gelesen. Accounts/Tokens werden nie angefasst.
use super::external::{self, Found};
use super::gamedata::{self, DataEntry, DataPick};
use super::LauncherKind;
use crate::error::{AppError, AppResult};
use crate::instance::{Instance, PackSource};
use crate::settings::Settings;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

/// Bereiche, die beim Import (und nachträglich) gewählt werden können.
pub const KEYS: [&str; 8] = ["memory", "java", "jvm_args", "env", "window", "hooks", "notes", "group"];
/// Nur nachträglich (beim Import immer übernommen): Spielzeit, Icon, Modpack-Herkunft, fehlende Mods (NoRisk).
pub const EXTRA_KEYS: [&str; 4] = ["playtime", "icon", "pack", "mods"];

/// Start-Befehle laufen auf dem Rechner: nie automatisch übernehmen.
pub fn default_on(key: &str) -> bool {
    key != "hooks"
}

/// Standard-Auswahl beim Import.
pub fn default_keys() -> Vec<String> {
    KEYS.iter().filter(|k| default_on(k)).map(|k| k.to_string()).collect()
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ExtSettings {
    pub min_memory_mb: Option<u32>,
    pub max_memory_mb: Option<u32>,
    /// Fester Java-Pfad der Instanz (globale Java-Wahl des fremden Launchers wird nicht übernommen)
    pub java_path: Option<String>,
    /// Java-Version laut fremdem Launcher bzw. Prüfung (nur Anzeige)
    pub java_version: Option<String>,
    pub jvm_args: Option<String>,
    pub env: BTreeMap<String, String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fullscreen: Option<bool>,
    pub pre_launch: Option<String>,
    pub post_exit: Option<String>,
    pub wrapper: Option<String>,
    pub notes: Option<String>,
    pub group: Option<String>,
    /// Bereiche, deren Werte aus den Standard-Einstellungen des fremden Launchers stammen (Instanz erbt sie)
    pub inherited: Vec<String>,
}

fn clean(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

impl ExtSettings {
    /// Gibt es für diesen Bereich einen Wert?
    pub fn has(&self, key: &str) -> bool {
        match key {
            "memory" => self.min_memory_mb.is_some() || self.max_memory_mb.is_some(),
            "java" => self.java_path.is_some(),
            "jvm_args" => self.jvm_args.is_some(),
            "env" => !self.env.is_empty(),
            "window" => self.width.is_some() || self.height.is_some() || self.fullscreen.is_some(),
            "hooks" => self.pre_launch.is_some() || self.post_exit.is_some() || self.wrapper.is_some(),
            "notes" => self.notes.is_some(),
            "group" => self.group.is_some(),
            _ => false,
        }
    }

    pub fn is_empty(&self) -> bool {
        !KEYS.iter().any(|k| self.has(k))
    }

    fn inherit(&mut self, key: &str) {
        if !self.inherited.iter().any(|k| k == key) {
            self.inherited.push(key.to_string());
        }
    }

    /// Unsinnige Werte verwerfen, Texte trimmen.
    pub fn sanitize(mut self) -> Self {
        self.max_memory_mb = self.max_memory_mb.filter(|m| (256..=1024 * 1024).contains(m));
        self.min_memory_mb = self.min_memory_mb.filter(|m| *m >= 128 && self.max_memory_mb.map_or(true, |max| *m <= max));
        self.width = self.width.filter(|w| (100..=16384).contains(w));
        self.height = self.height.filter(|h| (100..=16384).contains(h));
        if self.width.is_none() || self.height.is_none() {
            self.width = None;
            self.height = None;
        }
        self.java_path = clean(self.java_path);
        self.java_version = clean(self.java_version);
        self.jvm_args = clean(self.jvm_args);
        self.pre_launch = clean(self.pre_launch);
        self.post_exit = clean(self.post_exit);
        self.wrapper = clean(self.wrapper);
        self.notes = self.notes.filter(|n| !n.trim().is_empty());
        self.group = clean(self.group);
        self.env = std::mem::take(&mut self.env).into_iter().map(|(k, v)| (k.trim().to_string(), v)).filter(|(k, _)| !k.is_empty() && !k.contains('=')).collect();
        let keep: Vec<String> = self.inherited.iter().filter(|k| self.has(k)).cloned().collect();
        self.inherited = keep;
        self
    }

    /// Geerbte Werte, die ohnehin den Vibe-Standards entsprechen, nicht je Instanz festschreiben.
    pub fn effective(mut self, vibe: &Settings) -> Self {
        let inh = |k: &str| self.inherited.iter().any(|x| x == k);
        if inh("memory") {
            if self.max_memory_mb == Some(vibe.max_memory_mb) {
                self.max_memory_mb = None;
            }
            if self.min_memory_mb == Some(vibe.min_memory_mb) {
                self.min_memory_mb = None;
            }
        }
        if inh("window") {
            if self.width == Some(vibe.game_width) && self.height == Some(vibe.game_height) {
                self.width = None;
                self.height = None;
            }
            if self.fullscreen == Some(vibe.fullscreen) {
                self.fullscreen = None;
            }
        }
        if inh("jvm_args") && self.jvm_args.as_deref().map(str::trim) == Some(vibe.jvm_args.trim()) {
            self.jvm_args = None;
        }
        if inh("hooks") && self.wrapper.is_some() && self.wrapper == clean(vibe.wrapper_command.clone()) {
            self.wrapper = None;
        }
        self.sanitize()
    }
}

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
fn part(inst: &Instance, key: &str) -> Value {
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
fn blank(v: &Value) -> bool {
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

// ------------------------------------------------------------------ Hilfen für die Leser

/// Prism/ATLauncher-Variablen (`$INST_DIR`, `${INST_JAVA}`) unter Windows für `cmd` umschreiben (`%INST_DIR%`).
/// Vibe setzt dieselben Umgebungsvariablen (siehe `minecraft::hooks`).
pub fn shell_vars(cmd: &str) -> String {
    if !cfg!(windows) {
        return cmd.to_string();
    }
    let re = regex::Regex::new(r"\$\{(INST_[A-Z_]+)\}|\$(INST_[A-Z_]+)").expect("regex");
    re.replace_all(cmd, |c: &regex::Captures| format!("%{}%", c.get(1).or(c.get(2)).map(|m| m.as_str()).unwrap_or_default())).to_string()
}

/// Argumentliste zu einer Zeile (Argumente mit Leerzeichen in Anführungszeichen).
fn join_args(a: &[String]) -> String {
    a.iter().map(|x| if x.contains(char::is_whitespace) && !x.contains('"') { format!("\"{x}\"") } else { x.clone() }).collect::<Vec<_>>().join(" ")
}

/// Umgebungsvariablen aus JSON: `{"K":"V"}`, `[["K","V"]]` oder `[{"key":..,"value":..}]`.
fn env_of(v: &Value) -> Option<BTreeMap<String, String>> {
    let sv = |x: &Value| x.as_str().map(str::to_string).or_else(|| (x.is_number() || x.is_boolean()).then(|| x.to_string()));
    match v {
        Value::Object(m) => Some(m.iter().filter_map(|(k, v)| Some((k.clone(), sv(v)?))).collect()),
        Value::Array(a) => Some(
            a.iter()
                .filter_map(|e| match e {
                    Value::Array(p) if p.len() == 2 => Some((p[0].as_str()?.to_string(), sv(&p[1])?)),
                    Value::Object(o) => Some((o.get("key").or(o.get("name"))?.as_str()?.to_string(), sv(o.get("value")?)?)),
                    _ => None,
                })
                .collect(),
        ),
        Value::String(s) => serde_json::from_str::<Value>(s).ok().filter(|v| !v.is_string()).and_then(|v| env_of(&v)),
        _ => None,
    }
}

fn args_of(v: &Value) -> Option<String> {
    match v {
        Value::Array(a) => Some(join_args(&a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect::<Vec<_>>())),
        Value::String(s) => match serde_json::from_str::<Value>(s) {
            Ok(inner @ Value::Array(_)) => args_of(&inner),
            _ => Some(s.clone()),
        },
        _ => None,
    }
}

fn num(v: Option<&Value>) -> Option<u32> {
    let v = v?;
    v.as_u64().or_else(|| v.as_f64().map(|f| f as u64)).or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())).and_then(|n| u32::try_from(n).ok())
}

fn boolean(v: Option<&Value>) -> Option<bool> {
    match v? {
        Value::Bool(b) => Some(*b),
        Value::Number(n) => n.as_i64().map(|n| n != 0),
        Value::String(s) => match s.trim() {
            "true" | "1" => Some(true),
            "false" | "0" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn text(v: Option<&Value>) -> Option<String> {
    v.and_then(|x| x.as_str()).map(str::to_string).filter(|s| !s.trim().is_empty())
}

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

// ------------------------------------------------------------------ Modrinth App

/// Spaltenwerte einer Zeile (nur ausgewählte Spalten).
pub type Row = HashMap<String, Value>;

/// Profil-/Instanzzeile + globale `settings`-Zeile der Modrinth App (`override_*` fehlt/NULL = Standard der App).
pub fn modrinth(row: &Row, global: &Row, java_versions: &HashMap<String, String>) -> ExtSettings {
    let mut s = ExtSettings::default();
    let g = |k: &str| row.get(&format!("override_{k}")).filter(|v| !v.is_null());
    let gl = |k: &str| global.get(k).filter(|v| !v.is_null());
    // RAM (nur Maximum)
    if let Some(m) = num(g("mc_memory_max")) {
        s.max_memory_mb = Some(m);
    } else if let Some(m) = num(gl("mc_memory_max")) {
        s.max_memory_mb = Some(m);
        s.inherit("memory");
    }
    s.java_path = text(g("java_path"));
    if let Some(p) = &s.java_path {
        s.java_version = java_versions.get(&external::norm(p)).cloned();
    }
    if let Some(a) = g("extra_launch_args").and_then(args_of) {
        s.jvm_args = Some(a);
    } else if let Some(a) = gl("extra_launch_args").and_then(args_of).filter(|a| !a.trim().is_empty()) {
        s.jvm_args = Some(a);
        s.inherit("jvm_args");
    }
    if let Some(e) = g("custom_env_vars").and_then(env_of) {
        s.env = e;
    } else if let Some(e) = gl("custom_env_vars").and_then(env_of).filter(|e| !e.is_empty()) {
        s.env = e;
        s.inherit("env");
    }
    match (num(g("mc_game_resolution_x")), num(g("mc_game_resolution_y"))) {
        (Some(w), Some(h)) => (s.width, s.height) = (Some(w), Some(h)),
        _ => {
            if let (Some(w), Some(h)) = (num(gl("mc_game_resolution_x")), num(gl("mc_game_resolution_y"))) {
                (s.width, s.height) = (Some(w), Some(h));
                s.inherit("window");
            }
        }
    }
    if let Some(f) = boolean(g("mc_force_fullscreen")) {
        s.fullscreen = Some(f);
    } else if let Some(f) = boolean(gl("mc_force_fullscreen")) {
        s.fullscreen = Some(f);
        s.inherit("window");
    }
    let mut inherited_hook = false;
    let mut hook = |k: &str| {
        text(g(&format!("hook_{k}"))).or_else(|| {
            let v = text(gl(&format!("hook_{k}")));
            inherited_hook |= v.is_some();
            v
        })
    };
    (s.pre_launch, s.wrapper, s.post_exit) = (hook("pre_launch"), hook("wrapper"), hook("post_exit"));
    if inherited_hook {
        s.inherit("hooks");
    }
    s.group = row.get("groups").and_then(|v| match v {
        Value::String(t) => serde_json::from_str::<Value>(t).ok(),
        v => Some(v.clone()),
    })
    .and_then(|v| v.as_array().and_then(|a| a.iter().find_map(|x| text(Some(x)))));
    s.sanitize()
}

/// Sehr alte Modrinth App: `profile.json` (`java`, `memory`, `resolution`, `fullscreen`, `hooks`, `metadata.groups`).
pub fn modrinth_profile_json(v: &Value) -> ExtSettings {
    let mut s = ExtSettings::default();
    if let Some(j) = v.get("java") {
        s.java_path = text(j.get("override_version").and_then(|o| o.get("path")));
        s.java_version = text(j.get("override_version").and_then(|o| o.get("version")));
        s.jvm_args = j.get("extra_arguments").and_then(args_of);
        s.env = j.get("custom_env_args").and_then(env_of).unwrap_or_default();
    }
    s.max_memory_mb = num(v.get("memory").and_then(|m| m.get("maximum")));
    if let Some(r) = v.get("resolution").and_then(|r| r.as_array()).filter(|r| r.len() == 2) {
        (s.width, s.height) = (num(r.first()), num(r.get(1)));
    }
    s.fullscreen = boolean(v.get("fullscreen"));
    if let Some(h) = v.get("hooks") {
        (s.pre_launch, s.wrapper, s.post_exit) = (text(h.get("pre_launch")), text(h.get("wrapper")), text(h.get("post_exit")));
    }
    s.group = v.get("metadata").and_then(|m| m.get("groups")).and_then(|g| g.as_array()).and_then(|a| a.iter().find_map(|x| text(Some(x))));
    s.sanitize()
}

/// Spalten aus einer Tabelle lesen (nur vorhandene aus `wanted`; nie `SELECT *`).
pub fn select_rows(c: &rusqlite::Connection, table: &str, wanted: &[&str]) -> Vec<Row> {
    let have: Vec<String> = {
        let Ok(mut st) = c.prepare(&format!("PRAGMA table_info({table})")) else { return vec![] };
        st.query_map([], |r| r.get::<_, String>(1)).map(|it| it.flatten().collect()).unwrap_or_default()
    };
    let cols: Vec<&str> = wanted.iter().copied().filter(|w| have.iter().any(|h| h == w)).collect();
    if cols.is_empty() {
        return vec![];
    }
    let sql = format!("SELECT {} FROM {table}", cols.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(", "));
    let Ok(mut st) = c.prepare(&sql) else { return vec![] };
    let rows = st.query_map([], |r| {
        let mut m = Row::new();
        for (i, c) in cols.iter().enumerate() {
            use rusqlite::types::ValueRef;
            let v = match r.get_ref(i)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => json!(n),
                ValueRef::Real(f) => json!(f),
                ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).to_string()),
                ValueRef::Blob(_) => Value::Null,
            };
            m.insert(c.to_string(), v);
        }
        Ok(m)
    });
    rows.map(|it| it.flatten().collect()).unwrap_or_default()
}

/// Instanz-Spalten der Modrinth App (ältere `profiles`, neuere `instances`).
pub const MR_INSTANCE_COLS: &[&str] = &[
    "id",
    "path",
    "groups",
    "override_java_path",
    "override_extra_launch_args",
    "override_custom_env_vars",
    "override_mc_memory_max",
    "override_mc_force_fullscreen",
    "override_mc_game_resolution_x",
    "override_mc_game_resolution_y",
    "override_hook_pre_launch",
    "override_hook_wrapper",
    "override_hook_post_exit",
];
/// Globale Standardwerte der Modrinth App (Tabelle `settings`; nur diese Spalten).
pub const MR_GLOBAL_COLS: &[&str] = &[
    "extra_launch_args",
    "custom_env_vars",
    "mc_memory_max",
    "mc_force_fullscreen",
    "mc_game_resolution_x",
    "mc_game_resolution_y",
    "hook_pre_launch",
    "hook_wrapper",
    "hook_post_exit",
];

/// Einstellungen aller Modrinth-Profile (Schlüssel: Ordnername klein).
pub fn modrinth_all(c: &rusqlite::Connection) -> HashMap<String, ExtSettings> {
    let global = select_rows(c, "settings", MR_GLOBAL_COLS).into_iter().next().unwrap_or_default();
    let java: HashMap<String, String> = select_rows(c, "java_versions", &["path", "full_version"])
        .into_iter()
        .filter_map(|r| Some((external::norm(r.get("path")?.as_str()?), r.get("full_version")?.as_str()?.to_string())))
        .collect();
    let mut out = HashMap::new();
    for table in ["profiles", "instances"] {
        for r in select_rows(c, table, MR_INSTANCE_COLS) {
            let Some(path) = r.get("path").and_then(|p| p.as_str()).map(|p| p.to_lowercase()) else { continue };
            out.insert(path, modrinth(&r, &global, &java));
        }
    }
    out
}

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
pub fn norisk(settings: &Value, group: Option<String>, description: Option<String>, is_standard: bool, global: &super::norisk::global::NrGlobal) -> ExtSettings {
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

// ------------------------------------------------------------------ Nachträglich übernehmen

/// Angebot für eine bereits importierte Instanz.
#[derive(Debug, Clone, Serialize)]
pub struct SettingsOffer {
    pub instance_id: String,
    pub instance_name: String,
    pub launcher: LauncherKind,
    pub launcher_name: String,
    pub source_path: String,
    pub changes: Vec<Change>,
    /// Ordner/Dateien der Quelle, die in Vibe fehlen oder in der Quelle neuer sind ([`super::gamedata::scan`])
    pub data: Vec<DataEntry>,
    /// z. B. „Java 8 passt nicht zu Minecraft 1.21 – automatische Wahl“
    pub notes: Vec<String>,
}

/// Unterschiede der Extras (Spielzeit, Icon, Herkunft) – nur, wenn in Vibe noch nichts gesetzt ist.
fn extra_changes(inst: &Instance, f: &Found) -> Vec<Change> {
    let mut out = Vec::new();
    let secs = f.info.play_time_secs.unwrap_or(0);
    if inst.play_time_secs == 0 && secs > 0 {
        out.push(Change { key: "playtime".into(), old: json!({ "secs": 0, "last_played": inst.last_played }), new: json!({ "secs": secs, "last_played": f.info.last_played }), default_on: true, inherited: false });
    }
    if inst.icon.is_none() && f.icon_path.as_ref().is_some_and(|p| p.is_file()) {
        out.push(Change { key: "icon".into(), old: Value::Null, new: json!(f.info.icon), default_on: true, inherited: false });
    }
    let has_pack = inst.source.as_ref().is_some_and(|s| s.project_id.is_some());
    if let Some(p) = f.pack.as_ref().filter(|p| p.project_id.is_some() && !has_pack) {
        out.push(Change { key: "pack".into(), old: json!(inst.source), new: json!(p), default_on: true, inherited: false });
    }
    out
}

async fn build_offer(state: &AppState, inst: &Instance, mark: &external::ExternalMark, f: &Found) -> SettingsOffer {
    let vibe = state.settings();
    let kind = mark.launcher;
    let (s, note) = prepare(&vibe, &f.settings, &inst.mc_version, true).await;
    let mut changes = diff(inst, &s);
    changes.extend(extra_changes(inst, f));
    if let Some(plan) = f.norisk.as_ref() {
        let m = super::norisk::mods::missing(state, inst, plan).await;
        if !m.is_empty() {
            changes.push(Change { key: "mods".into(), old: json!([]), new: json!(m.names()), default_on: true, inherited: false });
        }
    }
    let (src, ov, dst, prior) = (f.game_dir.clone(), f.overlays.clone(), state.paths.game_dir(&inst.id), mark.prior());
    let data = tokio::task::spawn_blocking(move || gamedata::scan(&src, &ov, &dst, kind, &prior)).await.unwrap_or_default();
    SettingsOffer {
        instance_id: inst.id.clone(),
        instance_name: inst.name.clone(),
        launcher: kind,
        launcher_name: external::launcher_name(kind).to_string(),
        source_path: mark.source_path.clone(),
        changes,
        data,
        notes: note.into_iter().collect(),
    }
}

/// Alle importierten Instanzen, deren Quelle noch da ist und deren Einstellungen oder Daten abweichen.
pub async fn pending(state: &AppState) -> AppResult<Vec<SettingsOffer>> {
    let marks: Vec<(Instance, external::ExternalMark)> = state.instances.list().into_iter().filter_map(|i| external::read_mark(state, &i.id).map(|m| (i, m))).collect();
    if marks.is_empty() {
        return Ok(vec![]);
    }
    let tmp = state.paths.tmp();
    let reqs: Vec<(LauncherKind, String)> = marks.iter().map(|(_, m)| (m.launcher, m.source_path.clone())).collect();
    let found = tokio::task::spawn_blocking(move || external::describe_many(&reqs, &tmp)).await?;
    let mut out = Vec::new();
    for ((inst, mark), f) in marks.iter().zip(found) {
        let Some(f) = f else { continue };
        let o = build_offer(state, inst, mark, &f).await;
        if !o.changes.is_empty() || !o.data.is_empty() {
            out.push(o);
        }
    }
    Ok(out)
}

/// Angebot für eine Instanz (`None`: nicht importiert oder Quelle nicht mehr vorhanden).
pub async fn offer(state: &AppState, instance_id: &str) -> AppResult<Option<SettingsOffer>> {
    let inst = state.instances.get(instance_id)?;
    let Some(mark) = external::read_mark(state, instance_id) else { return Ok(None) };
    let tmp = state.paths.tmp();
    let req = vec![(mark.launcher, mark.source_path.clone())];
    let Some(f) = tokio::task::spawn_blocking(move || external::describe_many(&req, &tmp)).await?.pop().flatten() else { return Ok(None) };
    Ok(Some(build_offer(state, &inst, &mark, &f).await))
}

/// Nachträglich übernehmen (nur die Instanz-Daten, keine Dateien): Einstellungen + Extras (Spielzeit, Herkunft),
/// Extras nur, wenn sie wie angezeigt abweichen. Das Icon setzt [`apply_offer`] (Datei im Instanzordner).
pub fn apply_found(i: &mut Instance, s: &ExtSettings, f: &Found, keys: &HashSet<String>) {
    let extra = extra_changes(i, f);
    apply(i, s, keys);
    for c in extra.iter().filter(|c| keys.contains(&c.key)) {
        match c.key.as_str() {
            "playtime" => {
                i.play_time_secs = f.info.play_time_secs.unwrap_or(0);
                if i.last_played.is_none() {
                    i.last_played = f.info.last_played;
                }
            }
            "pack" => i.source = f.pack.clone(),
            _ => {}
        }
    }
}

/// Gewählte Werte übernehmen. `data`: Ordner/Dateien aus [`offer`] – ohne `overwrite` werden nur fehlende Dateien
/// hinzugefügt, mit `overwrite` auch neuere ersetzt (Welten komplett). Das Kopieren läuft als Aufgabe im
/// Hintergrund; vorher Snapshot (Configs/Packs/Optionen) bzw. Welt-Backup, andere ersetzte Dateien werden nach
/// `backups/reimport/<instanz>/<zeit>/` gesichert.
pub async fn apply_offer(state: &AppState, instance_id: &str, keys: Vec<String>, data: Vec<DataPick>) -> AppResult<Instance> {
    let inst = state.instances.get(instance_id)?;
    let mark = external::read_mark(state, instance_id).ok_or_else(|| AppError::Invalid("Diese Instanz wurde nicht aus einem anderen Launcher importiert".into()))?;
    let tmp = state.paths.tmp();
    let req = vec![(mark.launcher, mark.source_path.clone())];
    let f = tokio::task::spawn_blocking(move || external::describe_many(&req, &tmp))
        .await?
        .pop()
        .flatten()
        .ok_or_else(|| AppError::NotFound(format!("Die Instanz im {} ({})", external::launcher_name(mark.launcher), mark.source_path)))?;
    let keys: HashSet<String> = keys.into_iter().filter(|k| KEYS.contains(&k.as_str()) || EXTRA_KEYS.contains(&k.as_str())).collect();
    if !data.is_empty() && state.game.is_running(instance_id) {
        return Err(AppError::Invalid("Bitte beende zuerst das Spiel – Dateien werden nur bei geschlossenem Spiel übernommen.".into()));
    }
    let vibe = state.settings();
    let (s, _) = prepare(&vibe, &f.settings, &inst.mc_version, keys.contains("java")).await;
    let icon = keys.contains("icon") && extra_changes(&inst, &f).iter().any(|c| c.key == "icon");
    let mut updated = state.instances.modify(instance_id, |i| apply_found(i, &s, &f, &keys))?;
    if icon {
        if let Some(bytes) = f.icon_path.as_ref().and_then(|p| std::fs::read(p).ok()) {
            super::import::set_icon_bytes(state, instance_id, &bytes).await?;
            updated = state.instances.get(instance_id)?;
        }
    }
    if keys.contains("mods") {
        if let Some(plan) = f.norisk.clone() {
            let (st, id) = (state.clone(), instance_id.to_string());
            state.tasks.spawn("import", "Mods aus NoRisk Client übernehmen".to_string(), Some(id.clone()), move |task| super::norisk::mods::run_missing(st, task, id, plan));
        }
    }
    if !data.is_empty() {
        let (src, ov, dst, kind, prior) = (f.game_dir.clone(), f.overlays.clone(), state.paths.game_dir(instance_id), mark.launcher, mark.prior());
        let plan = tokio::task::spawn_blocking(move || gamedata::plan(&src, &ov, &dst, kind, &prior, &data)).await?;
        if !plan.is_empty() {
            let launcher = external::launcher_name(kind);
            let (st, id) = (state.clone(), instance_id.to_string());
            state.tasks.spawn("import", format!("Daten aus {launcher} übernehmen"), Some(id.clone()), move |task| copy_data(st, task, id, plan, launcher));
        }
    }
    Ok(updated)
}

/// Aufgabe: gewählte Daten kopieren (vorher Snapshot bzw. Welt-Backup).
async fn copy_data(state: AppState, task: crate::tasks::TaskHandle, id: String, plan: gamedata::CopyPlan, launcher: &'static str) -> AppResult<()> {
    if state.game.is_running(&id) {
        return Err(AppError::Invalid("Bitte beende zuerst das Spiel – Dateien werden nur bei geschlossenem Spiel übernommen.".into()));
    }
    if plan.touches_snapshot() || plan.ops.iter().any(|o| o.replace) {
        task.stage("Lege Snapshot an …", Some(0.0));
        super::snapshots::create(&state, &id, &format!("Vor Übernahme aus {launcher}"), false, None).await?;
    }
    for w in &plan.replace_worlds {
        task.stage(format!("Sichere Welt „{w}“ …"), Some(0.0));
        super::worldbackup::create(&state, &id, w, None).await?;
    }
    let n_files = plan.ops.len();
    task.stage(if n_files == 1 { "Kopiere 1 Datei …".to_string() } else { format!("Kopiere {n_files} Dateien …") }, Some(0.0));
    let dst = state.paths.game_dir(&id);
    let keep = super::snapshots::backups_root(&state.paths).join("reimport").join(&id).join(chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string());
    let total = plan.total().max(1);
    let content_lock = state.content.lock(&id);
    let _c = content_lock.lock().await;
    let (t2, k2) = (task.clone(), keep.clone());
    let n = tokio::task::spawn_blocking(move || gamedata::execute(&plan, &dst, &k2, |done| t2.progress(done as f64 / total as f64), || t2.check())).await??;
    let mut msg = if n == 1 { format!("1 Datei aus {launcher} übernommen") } else { format!("{n} Dateien aus {launcher} übernommen") };
    if keep.is_dir() {
        msg.push_str(&format!(" · ersetzte Dateien gesichert in {}", keep.display()));
    }
    task.message(msg);
    state.content.emit_changed(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ini(t: &str) -> HashMap<String, String> {
        super::super::import::parse_ini(t)
    }

    fn inst() -> Instance {
        serde_json::from_value(json!({
            "id": "x", "name": "X", "icon": null, "accent": null, "group": null, "mc_version": "1.20.1",
            "loader": {"kind": "vanilla", "version": null}, "created_at": 0
        }))
        .unwrap()
    }

    #[test]
    fn prism_instance_and_global() {
        let cfg = ini(
            "[General]\nOverrideMemory=true\nMinMemAlloc=2048\nMaxMemAlloc=6144\nOverrideJavaLocation=true\nJavaPath=C:/Java/jdk-17/bin/javaw.exe\nJavaVersion=17.0.9\n\
             OverrideJavaArgs=false\nJvmArgs=-Dignored\nOverrideWindow=true\nMinecraftWinWidth=1920\nMinecraftWinHeight=1080\nLaunchMaximized=false\n\
             OverrideCommands=true\nPreLaunchCommand=\"echo $INST_NAME\"\nOverrideEnv=true\nEnv={\"MESA_GL_VERSION_OVERRIDE\":\"4.5\"}\nnotes=\"Zeile 1\\nZeile 2\"\n",
        );
        let global = ini("[General]\nMinMemAlloc=512\nMaxMemAlloc=4096\nJvmArgs=-XX:+UseG1GC\nMinecraftWinWidth=854\nMinecraftWinHeight=480\nJavaPath=C:/global/java.exe\n");
        let s = prism(&cfg, &global, Some("Survival".into()));
        assert_eq!((s.min_memory_mb, s.max_memory_mb), (Some(2048), Some(6144)));
        assert_eq!(s.java_path.as_deref(), Some("C:/Java/jdk-17/bin/javaw.exe"));
        assert_eq!(s.java_version.as_deref(), Some("17.0.9"));
        // Instanz überschreibt die Argumente nicht -> globale (geerbt)
        assert_eq!(s.jvm_args.as_deref(), Some("-XX:+UseG1GC"));
        assert!(s.inherited.contains(&"jvm_args".to_string()));
        assert_eq!((s.width, s.height), (Some(1920), Some(1080)));
        let expect = if cfg!(windows) { "echo %INST_NAME%" } else { "echo $INST_NAME" };
        assert_eq!(s.pre_launch.as_deref(), Some(expect));
        assert_eq!(s.env.get("MESA_GL_VERSION_OVERRIDE").map(String::as_str), Some("4.5"));
        assert_eq!(s.notes.as_deref(), Some("Zeile 1\nZeile 2"));
        assert_eq!(s.group.as_deref(), Some("Survival"));
        assert!(!s.inherited.contains(&"memory".to_string()));

        // Ohne Overrides: alles aus den globalen Werten, Java nie
        let s2 = prism(&ini("[General]\nname=x\n"), &global, None);
        assert_eq!(s2.max_memory_mb, Some(4096));
        assert!(s2.inherited.contains(&"memory".to_string()) && s2.inherited.contains(&"window".to_string()));
        assert!(s2.java_path.is_none());
        // Geerbte Werte, die den Vibe-Standards entsprechen, werden nicht festgeschrieben
        let vibe = Settings { max_memory_mb: 4096, min_memory_mb: 512, game_width: 854, game_height: 480, ..Default::default() };
        let e = s2.effective(&vibe);
        assert_eq!((e.max_memory_mb, e.min_memory_mb, e.width), (None, None, None));
        assert_eq!(e.jvm_args.as_deref(), Some("-XX:+UseG1GC"));
    }

    #[test]
    fn prism_groups_and_pack() {
        let d = std::env::temp_dir().join(format!("vl-es-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("instgroups.json"), r#"{"formatVersion":"1","groups":{"Modpacks":{"hidden":false,"instances":["ATM9","Other"]}}}"#).unwrap();
        assert_eq!(prism_group(&d, "atm9").as_deref(), Some("Modpacks"));
        assert_eq!(prism_group(&d, "Nope"), None);
        let p = prism_pack(&ini("ManagedPack=true\nManagedPackType=modrinth\nManagedPackID=abc\nManagedPackVersionID=v1\nManagedPackName=Fabulously\n")).unwrap();
        assert_eq!(p.kind, crate::instance::PackSourceKind::Modrinth);
        assert_eq!(p.project_id.as_deref(), Some("abc"));
        assert!(prism_pack(&ini("ManagedPack=false\n")).is_none());
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn modrinth_db_rows() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE settings (id INTEGER, theme TEXT, extra_launch_args TEXT, custom_env_vars TEXT, mc_memory_max INTEGER, mc_force_fullscreen INTEGER,
                mc_game_resolution_x INTEGER, mc_game_resolution_y INTEGER, hook_pre_launch TEXT, hook_wrapper TEXT, hook_post_exit TEXT);
             INSERT INTO settings VALUES (0,'dark','[\"-XX:+UseG1GC\"]','[]',4096,0,854,480,NULL,'gamemoderun',NULL);
             CREATE TABLE profiles (path TEXT, name TEXT, groups TEXT, override_java_path TEXT, override_extra_launch_args TEXT, override_custom_env_vars TEXT,
                override_mc_memory_max INTEGER, override_mc_force_fullscreen INTEGER, override_mc_game_resolution_x INTEGER, override_mc_game_resolution_y INTEGER,
                override_hook_pre_launch TEXT, override_hook_wrapper TEXT, override_hook_post_exit TEXT);
             INSERT INTO profiles VALUES ('Eigen','Eigen','[\"Favoriten\"]','C:\\Java\\21\\javaw.exe','[\"-Xss2M\",\"-Dname=a b\"]','[[\"FOO\",\"1\"]]',6144,1,1920,1080,'echo hi',NULL,NULL);
             INSERT INTO profiles VALUES ('Standard','Standard','[]',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
             CREATE TABLE java_versions (major_version INTEGER, full_version TEXT, architecture TEXT, path TEXT);
             INSERT INTO java_versions VALUES (21,'21.0.5','x86_64','C:\\Java\\21\\javaw.exe');
             CREATE TABLE minecraft_users (uuid TEXT, access_token TEXT);",
        )
        .unwrap();
        let all = modrinth_all(&c);
        let e = &all["eigen"];
        assert_eq!(e.max_memory_mb, Some(6144));
        assert_eq!(e.java_version.as_deref(), Some("21.0.5"));
        assert_eq!(e.jvm_args.as_deref(), Some("-Xss2M \"-Dname=a b\""));
        assert_eq!(e.env.get("FOO").map(String::as_str), Some("1"));
        assert_eq!((e.width, e.height, e.fullscreen), (Some(1920), Some(1080), Some(true)));
        assert_eq!(e.pre_launch.as_deref(), Some("echo hi"));
        // Wrapper fehlt in der Instanz -> globaler Wrapper (geerbt)
        assert_eq!(e.wrapper.as_deref(), Some("gamemoderun"));
        assert!(e.inherited.contains(&"hooks".to_string()));
        assert_eq!(e.group.as_deref(), Some("Favoriten"));
        let d = &all["standard"];
        assert_eq!(d.max_memory_mb, Some(4096));
        assert_eq!(d.fullscreen, Some(false));
        assert!(d.inherited.contains(&"memory".to_string()) && d.inherited.contains(&"window".to_string()));
        assert!(d.java_path.is_none());
        // nie SELECT * – Spalten, die nicht gewünscht sind, kommen nicht vor
        let rows = select_rows(&c, "minecraft_users", &["uuid"]);
        assert!(rows.iter().all(|r| !r.contains_key("access_token")));
    }

    #[test]
    fn modrinth_old_profile_json() {
        let v = json!({"java": {"override_version": {"path": "/opt/java/bin/java", "version": "17.0.1"}, "extra_arguments": ["-Xss1M"], "custom_env_args": [["A","b"]]},
            "memory": {"maximum": 5000}, "resolution": [1280, 720], "fullscreen": false, "hooks": {"wrapper": "prime-run"}, "metadata": {"groups": ["G"]}});
        let s = modrinth_profile_json(&v);
        assert_eq!(s.max_memory_mb, Some(5000));
        assert_eq!(s.java_path.as_deref(), Some("/opt/java/bin/java"));
        assert_eq!((s.width, s.height, s.fullscreen), (Some(1280), Some(720), Some(false)));
        assert_eq!(s.wrapper.as_deref(), Some("prime-run"));
        assert_eq!(s.env.len(), 1);
        assert_eq!(s.group.as_deref(), Some("G"));
    }

    #[test]
    fn curseforge_instance() {
        let s = curseforge(&json!({"isMemoryOverride": true, "allocatedMemory": 8192, "javaArgsOverride": "-XX:+UseZGC"}));
        assert_eq!(s.max_memory_mb, Some(8192));
        assert_eq!(s.jvm_args.as_deref(), Some("-XX:+UseZGC"));
        let s = curseforge(&json!({"isMemoryOverride": false, "allocatedMemory": 8192, "javaArgsOverride": null}));
        assert!(s.is_empty());
    }

    #[test]
    fn atlauncher_instance_and_global() {
        let global = json!({"initialMemory": 512, "maximumMemory": 4096, "javaParameters": "-XX:+UseG1GC", "windowWidth": 1600, "windowHeight": 900,
            "enableCommands": false, "useJavaProvidedByMinecraft": true, "javaPath": "C:/global"});
        let l = json!({"maximumMemory": 7168, "initialMemory": 1024, "javaPath": "C:/Java/8/bin/javaw.exe", "useJavaProvidedByMinecraft": false,
            "enableCommands": true, "preLaunchCommand": "echo ${INST_DIR}", "wrapperCommand": null});
        let s = atlauncher(&l, Some(&global));
        assert_eq!((s.min_memory_mb, s.max_memory_mb), (Some(1024), Some(7168)));
        assert_eq!(s.java_path.as_deref(), Some("C:/Java/8/bin/javaw.exe"));
        assert_eq!(s.jvm_args.as_deref(), Some("-XX:+UseG1GC"));
        assert_eq!((s.width, s.height), (Some(1600), Some(900)));
        assert!(s.pre_launch.as_deref().unwrap().contains("INST_DIR"));
        assert!(!s.inherited.contains(&"hooks".to_string()));
        // Java von Minecraft (Standard) -> kein eigener Pfad; Befehle global aus -> keine
        let s = atlauncher(&json!({"javaPath": "C:/x", "preLaunchCommand": "evil"}), Some(&global));
        assert!(s.java_path.is_none() && s.pre_launch.is_none());
        assert_eq!(s.max_memory_mb, Some(4096));
        let p = atlauncher_pack(&json!({"pack": "Fabulously Optimized", "modrinthProject": {"id": "1KVo5zza"}, "modrinthVersion": {"id": "V"}})).unwrap();
        assert_eq!(p.project_id.as_deref(), Some("1KVo5zza"));
    }

    #[test]
    fn norisk_settings() {
        use super::super::norisk::global::NrGlobal;
        let none = NrGlobal::default();
        let s = norisk(&json!({"memory": {"min": 1024, "max": 3584}, "use_custom_java_path": false, "java_path": "x", "custom_jvm_args": "-Dfoo",
            "resolution": {"width": 1280, "height": 720}, "fullscreen": false}), Some("NRC".into()), Some("Beschreibung".into()), false, &none);
        assert_eq!((s.min_memory_mb, s.max_memory_mb), (Some(1024), Some(3584)));
        assert!(s.java_path.is_none());
        assert_eq!(s.jvm_args.as_deref(), Some("-Dfoo"));
        assert_eq!((s.width, s.height, s.fullscreen), (Some(1280), Some(720), None));
        assert_eq!(s.notes.as_deref(), Some("Beschreibung"));
        assert!(s.inherited.is_empty());
        let g = NrGlobal { memory: json!({"min": 2048, "max": 8192}), jvm_args: Some("-XX:+UseZGC".into()), wrapper: Some("prime-run".into()), ..Default::default() };
        let std = norisk(&json!({"memory": {"min": 1024, "max": 3584}, "custom_jvm_args": "-Dfoo"}), None, None, true, &g);
        assert_eq!((std.min_memory_mb, std.max_memory_mb), (Some(2048), Some(8192)));
        assert_eq!(std.jvm_args.as_deref(), Some("-XX:+UseZGC"));
        assert_eq!(std.wrapper.as_deref(), Some("prime-run"));
        for k in ["memory", "jvm_args", "hooks"] {
            assert!(std.inherited.contains(&k.to_string()), "{k}");
        }
        let own = norisk(&json!({"memory": {"min": 1024, "max": 3584}}), None, None, false, &g);
        assert_eq!(own.max_memory_mb, Some(3584));
        assert!(own.jvm_args.is_none(), "eigene Profile nutzen keine globalen JVM-Argumente");
        assert_eq!(own.inherited, vec!["hooks".to_string()]);
        assert!(!diff(&inst(), &own).iter().find(|c| c.key == "hooks").unwrap().default_on);
        let missing = norisk(&json!({}), None, None, false, &g);
        assert_eq!(missing.max_memory_mb, Some(8192));
        assert!(missing.inherited.contains(&"memory".to_string()));
    }

    #[test]
    fn apply_and_diff() {
        let mut i = inst();
        i.java.env.insert("FOO".into(), "old".into());
        i.notes = Some("eigene Notiz".into());
        let s = ExtSettings {
            max_memory_mb: Some(6144),
            jvm_args: Some("-Xss2M".into()),
            env: BTreeMap::from([("FOO".into(), "new".into()), ("BAR".into(), "1".into())]),
            width: Some(1920),
            height: Some(1080),
            pre_launch: Some("echo hi".into()),
            notes: Some("Prism-Notiz".into()),
            ..Default::default()
        };
        let d = diff(&i, &s);
        let by = |k: &str| d.iter().find(|c| c.key == k).cloned();
        assert!(by("memory").unwrap().default_on);
        assert!(!by("hooks").unwrap().default_on, "Start-Befehle nie vorausgewählt");
        assert!(!by("notes").unwrap().default_on, "eigene Notiz nicht ungefragt überschreiben");
        assert!(!by("env").unwrap().default_on, "FOO würde überschrieben");
        assert!(by("java").is_none());
        // Übernehmen: nur gewählte Bereiche
        apply(&mut i, &s, &HashSet::from(["memory".to_string(), "env".to_string(), "window".to_string()]));
        assert_eq!(i.java.max_memory_mb, Some(6144));
        assert_eq!(i.java.env.get("BAR").map(String::as_str), Some("1"));
        assert_eq!(i.window.width, Some(1920));
        assert!(i.hooks.pre_launch.is_none());
        assert_eq!(i.notes.as_deref(), Some("eigene Notiz"));
        // Danach keine Unterschiede mehr in diesen Bereichen
        let d = diff(&i, &s);
        assert!(d.iter().all(|c| !["memory", "env", "window"].contains(&c.key.as_str())));
    }

    #[test]
    fn java_rules() {
        assert_eq!(java_major_for("1.12.2"), Some(8));
        assert_eq!(java_major_for("1.17.1"), Some(16));
        assert_eq!(java_major_for("1.20.4"), Some(17));
        assert_eq!(java_major_for("1.20.5"), Some(21));
        assert_eq!(java_major_for("1.21.4"), Some(21));
        assert_eq!(java_major_for("26.1"), Some(21));
        assert!(java_fits(8, "1.12.2") && !java_fits(17, "1.12.2"));
        assert!(java_fits(21, "1.20.1") && !java_fits(17, "1.21"));
    }

    #[test]
    fn sanitize_values() {
        let s = ExtSettings { max_memory_mb: Some(100), min_memory_mb: Some(50), width: Some(1920), height: None, jvm_args: Some("  ".into()), ..Default::default() }.sanitize();
        assert!(s.is_empty());
        let s = ExtSettings { max_memory_mb: Some(4096), min_memory_mb: Some(8000), ..Default::default() }.sanitize();
        assert_eq!((s.min_memory_mb, s.max_memory_mb), (None, Some(4096)));
    }
}
