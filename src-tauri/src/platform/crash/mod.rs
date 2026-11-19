//! Crash-Analyse: regelbasiertes Auswerten von Crash-Reports und Logs.
//! Ergebnis sind „Diagnosen“ mit Schuldigem (Mod), Klartext-Erklärung (Frontend), Fundstelle und Fix-Vorschlag.
//!
//! Die Muster stehen als Daten in `patterns.toml` (Regex + Auswertung), bekannte unverträgliche Mod-Paare in
//! `conflicts.toml`. Beispiel-Logs (anonymisiert) liegen unter `testdata/` und sind die Tests der Regeln.
//! Ausgewertet wird nur das letzte Startprotokoll (Crash-Report der Sitzung, `latest.log`, Konsolenausgabe);
//! große Dateien werden gestreamt (`logs.rs`).
mod logs;

pub use logs::LogText;

use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Culprit {
    pub mod_id: Option<String>,
    pub name: Option<String>,
    /// Dateiname im mods-Ordner, falls zugeordnet
    pub file: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Action {
    /// Mod-Datei deaktivieren
    DisableMod { file: String },
    /// Deaktivierte Abhängigkeit (`.jar.disabled`) wieder aktivieren
    EnableMod { file: String, name: Option<String> },
    /// Abhängigkeit installieren (Modrinth-Slug/ID bzw. Mod-ID)
    InstallDependency { mod_id: String, name: Option<String> },
    /// Installierte Mod auf eine passende (neuere) Version tauschen
    UpdateMod { file: String, mod_id: String },
    /// Kaputte Config-Datei (relativ zum Spielordner, `config/…`) sichern und zurücksetzen
    ResetConfig { path: String },
    /// Java-Hauptversion verwenden
    SetJava { major: u32 },
    /// Arbeitsspeicher erhöhen (Vorschlag in MB)
    IncreaseRam { suggest_mb: u32 },
    /// Grafiktreiber aktualisieren (nur Hinweis + Link)
    UpdateDrivers,
    /// Log/Report zu mclo.gs hochladen
    Upload,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Diagnosis {
    /// Kennung der Ursache: missing_dependency, outdated_dependency, wrong_minecraft, wrong_loader, loader_version,
    /// mixin, mixin_conflict, mod_conflict, known_conflict, java_version, out_of_memory, heap_reserve, duplicate_mod,
    /// broken_config, graphics, suspected_mod, exit_code
    pub id: String,
    /// 0–100: wie sicher die Regel ist (zum Sortieren)
    pub confidence: u8,
    pub culprit: Option<Culprit>,
    /// Kurze Parameter für die Klartext-Texte im Frontend (z. B. benötigte Version)
    pub params: BTreeMap<String, String>,
    pub actions: Vec<Action>,
    /// Gefundene Fundstelle (eine Zeile) zum Anzeigen
    pub evidence: Option<String>,
    /// Datei der Fundstelle (`logs/latest.log`, `crash-reports/…`, `console`)
    pub source: Option<String>,
    /// Zeile in dieser Datei (ab 1)
    pub line: Option<u32>,
    /// Regel aus `patterns.toml`
    pub rule: Option<String>,
}

impl Diagnosis {
    fn new(id: &str, confidence: u8) -> Self {
        Diagnosis {
            id: id.into(),
            confidence,
            culprit: None,
            params: BTreeMap::new(),
            actions: vec![],
            evidence: None,
            source: None,
            line: None,
            rule: None,
        }
    }
    fn param(mut self, k: &str, v: impl Into<String>) -> Self {
        self.params.insert(k.into(), v.into());
        self
    }
    fn culprit(mut self, mod_id: Option<&str>, name: Option<&str>) -> Self {
        if mod_id.is_some() || name.is_some() {
            self.culprit = Some(Culprit { mod_id: mod_id.map(Into::into), name: name.map(Into::into), file: None });
        }
        self
    }
    fn action(mut self, a: Action) -> Self {
        self.actions.push(a);
        self
    }
    fn evidence(mut self, line: &str) -> Self {
        self.evidence = Some(line.trim().chars().take(300).collect());
        self
    }
}

// ------------------------------------------------------------------ Mods im Ordner

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ModEntry {
    pub file: String,
    pub name: Option<String>,
    pub version: Option<String>,
}

/// Mods im mods-Ordner. Wird zum Zuordnen von Schuldigen benutzt.
#[derive(Debug, Default, Clone)]
pub struct ModIndex {
    /// Mod-ID (klein) -> aktive Dateien
    pub by_id: HashMap<String, Vec<ModEntry>>,
    /// Deaktivierte Jars (`.jar.disabled`): Mod-ID -> Datei
    pub disabled: HashMap<String, ModEntry>,
    /// Mixin-Config (Dateiname, klein) -> Mod-ID
    pub mixins: HashMap<String, String>,
    /// Paket der Mixin-Klassen (`me.x.mixin.`) -> Mod-ID
    pub packages: Vec<(String, String)>,
    /// Alle aktiven Jar-Dateien (auch ohne Metadaten, z. B. OptiFine)
    pub files: Vec<String>,
}

impl ModIndex {
    pub fn file_of(&self, id: &str) -> Option<&ModEntry> {
        self.by_id.get(&id.to_ascii_lowercase()).and_then(|v| v.first())
    }

    pub fn add(&mut self, id: &str, e: ModEntry) {
        if !self.files.contains(&e.file) {
            self.files.push(e.file.clone());
        }
        self.by_id.entry(id.to_ascii_lowercase()).or_default().push(e);
    }

    /// Mod-ID zu einer Datei
    fn id_of_file(&self, file: &str) -> Option<&str> {
        self.by_id.iter().find(|(_, v)| v.iter().any(|e| e.file == file)).map(|(k, _)| k.as_str())
    }

    /// Liest Mod-IDs, Versionen und Mixin-Configs aus fabric.mod.json / quilt.mod.json / (neoforge.)mods.toml aller
    /// aktiven Jars (und getrennt die IDs der deaktivierten `.jar.disabled`).
    pub fn scan(mods_dir: &Path) -> ModIndex {
        let mut idx = ModIndex::default();
        let Ok(rd) = std::fs::read_dir(mods_dir) else {
            return idx;
        };
        let mut entries: Vec<_> = rd.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let p = e.path();
            let file = e.file_name().to_string_lossy().to_string();
            if file.ends_with(".jar.disabled") {
                for (id, name, version) in read_jar(&p).ids {
                    idx.disabled.entry(id.to_ascii_lowercase()).or_insert(ModEntry { file: file.clone(), name, version });
                }
                continue;
            }
            if p.extension().and_then(|x| x.to_str()) != Some("jar") {
                continue;
            }
            let info = read_jar(&p);
            idx.files.push(file.clone());
            if let Some((first, ..)) = info.ids.first() {
                for c in &info.mixins {
                    idx.mixins.insert(c.to_ascii_lowercase(), first.to_ascii_lowercase());
                }
                for pkg in &info.packages {
                    idx.packages.push((format!("{pkg}."), first.to_ascii_lowercase()));
                }
            }
            for (id, name, version) in info.ids {
                idx.add(&id, ModEntry { file: file.clone(), name, version });
            }
        }
        idx
    }
}

#[derive(Default)]
struct JarInfo {
    ids: Vec<(String, Option<String>, Option<String>)>,
    mixins: Vec<String>,
    packages: Vec<String>,
}

fn read_entry(z: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Option<String> {
    let mut e = z.by_name(name).ok()?;
    if e.size() > 4 << 20 {
        return None;
    }
    let mut s = String::new();
    std::io::Read::read_to_string(&mut e, &mut s).ok()?;
    Some(s)
}

fn read_jar(jar: &Path) -> JarInfo {
    let mut out = JarInfo::default();
    let Ok(f) = std::fs::File::open(jar) else { return out };
    let Ok(mut z) = zip::ZipArchive::new(f) else { return out };
    for name in ["fabric.mod.json", "quilt.mod.json"] {
        let Some(s) = read_entry(&mut z, name) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) else { continue };
        let root = &v;
        let v = v.get("quilt_loader").unwrap_or(root);
        if let Some(id) = v.get("id").and_then(|x| x.as_str()) {
            let n = v.get("name").or_else(|| v.pointer("/metadata/name")).and_then(|x| x.as_str()).map(String::from);
            let ver = v.get("version").and_then(|x| x.as_str()).map(String::from);
            out.ids.push((id.to_string(), n, ver));
        }
        // Fabric: "mixins": ["a.json", {"config": "b.json"}]; Quilt: "mixin": "a.json" | [...]
        for key in ["mixins", "mixin"] {
            match root.get(key) {
                Some(serde_json::Value::String(s)) => out.mixins.push(s.clone()),
                Some(serde_json::Value::Array(a)) => {
                    for m in a {
                        if let Some(s) = m.as_str().or_else(|| m.get("config").and_then(|c| c.as_str())) {
                            out.mixins.push(s.to_string());
                        }
                    }
                }
                _ => {}
            }
        }
    }
    static MODID: OnceLock<Regex> = OnceLock::new();
    static TOML_MIXIN: OnceLock<Regex> = OnceLock::new();
    static VERSION: OnceLock<Regex> = OnceLock::new();
    let modid = MODID.get_or_init(|| Regex::new(r#"(?m)^\s*modId\s*=\s*"([^"]+)""#).unwrap());
    let toml_mixin = TOML_MIXIN.get_or_init(|| Regex::new(r#"(?m)^\s*config\s*=\s*"([^"]+\.json)""#).unwrap());
    let version = VERSION.get_or_init(|| Regex::new(r#"(?m)^\s*version\s*=\s*"([^"$]+)""#).unwrap());
    for name in ["META-INF/neoforge.mods.toml", "META-INF/mods.toml"] {
        if let Some(s) = read_entry(&mut z, name) {
            let ver = version.captures(&s).map(|c| c[1].to_string());
            for c in modid.captures_iter(&s) {
                out.ids.push((c[1].to_string(), None, ver.clone()));
            }
            for c in toml_mixin.captures_iter(&s) {
                out.mixins.push(c[1].to_string());
            }
            break;
        }
    }
    if let Some(m) = read_entry(&mut z, "META-INF/MANIFEST.MF") {
        for l in m.lines() {
            if let Some(v) = l.strip_prefix("MixinConfigs:") {
                out.mixins.extend(v.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));
            }
        }
    }
    out.mixins.dedup();
    for c in out.mixins.clone() {
        if let Some(pkg) = read_entry(&mut z, &c)
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("package").and_then(|p| p.as_str()).map(String::from))
        {
            out.packages.push(pkg);
        }
    }
    out
}

// ------------------------------------------------------------------ Regeltabellen

#[derive(Debug, Deserialize)]
struct RawPattern {
    id: String,
    kind: String,
    confidence: u8,
    #[serde(default)]
    fatal: bool,
    also: Option<String>,
    unless: Option<String>,
    #[serde(default)]
    fallback: bool,
    loader: Option<Vec<String>>,
    regex: String,
    #[allow(dead_code)]
    example: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ClassHint {
    prefix: String,
    #[serde(rename = "mod")]
    slug: String,
    name: String,
    ids: Vec<String>,
    loader: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct RawTable {
    fatal_markers: Vec<String>,
    pattern: Vec<RawPattern>,
    class_hint: Vec<ClassHint>,
}

#[derive(Debug, Clone, Deserialize)]
struct PairSide {
    name: String,
    ids: Vec<String>,
    file: Option<String>,
    version: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawPair {
    id: String,
    a: PairSide,
    b: PairSide,
    source: String,
}

#[derive(Debug, Deserialize)]
struct RawPairs {
    pair: Vec<RawPair>,
}

struct Pattern {
    raw: RawPattern,
    re: Regex,
    also: Option<Regex>,
    unless: Option<Regex>,
}

struct Pair {
    raw: RawPair,
    a_file: Option<Regex>,
    b_file: Option<Regex>,
}

struct Table {
    fatal: Vec<String>,
    patterns: Vec<Pattern>,
    hints: Vec<ClassHint>,
    pairs: Vec<Pair>,
}

const PATTERNS: &str = include_str!("patterns.toml");
const CONFLICTS: &str = include_str!("conflicts.toml");

fn compile(s: &str, what: &str) -> Regex {
    Regex::new(s).unwrap_or_else(|e| panic!("Crash-Muster {what}: {e}"))
}

fn table() -> &'static Table {
    static T: OnceLock<Table> = OnceLock::new();
    T.get_or_init(|| {
        let raw: RawTable = toml::from_str(PATTERNS).expect("patterns.toml");
        let pairs: RawPairs = toml::from_str(CONFLICTS).expect("conflicts.toml");
        Table {
            fatal: raw.fatal_markers,
            patterns: raw
                .pattern
                .into_iter()
                .map(|p| Pattern {
                    re: compile(&p.regex, &p.id),
                    also: p.also.as_deref().map(|s| compile(s, &p.id)),
                    unless: p.unless.as_deref().map(|s| compile(&regex::escape(s), &p.id)),
                    raw: p,
                })
                .collect(),
            hints: raw.class_hint,
            pairs: pairs
                .pair
                .into_iter()
                .map(|p| Pair {
                    a_file: p.a.file.as_deref().map(|s| compile(s, &p.id)),
                    b_file: p.b.file.as_deref().map(|s| compile(s, &p.id)),
                    raw: p,
                })
                .collect(),
        }
    })
}

fn re(s: &str) -> Regex {
    Regex::new(s).expect("Regex")
}

fn line_of(text: &str, start: usize) -> &str {
    let s = text[..start].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let e = text[start..].find('\n').map(|i| start + i).unwrap_or(text.len());
    &text[s..e]
}

/// Ausschnitt `[start-before, start+after)` an Zeichengrenzen.
fn window(text: &str, start: usize, before: usize, after: usize) -> &str {
    let mut a = start.saturating_sub(before);
    while !text.is_char_boundary(a) {
        a -= 1;
    }
    let mut b = (start + after).min(text.len());
    while !text.is_char_boundary(b) {
        b += 1;
    }
    &text[a..b]
}

/// Mod-IDs, die in Fehlermeldungen vorkommen, aber nie Schuldige sind.
fn is_builtin(id: &str) -> bool {
    matches!(
        id.to_ascii_lowercase().as_str(),
        "minecraft" | "java" | "fabricloader" | "fabric-loader" | "forge" | "neoforge" | "quilt_loader" | "mixinextras" | "mcp" | "fml" | "javafml"
    )
}

const LOADER_IDS: &[&str] = &["fabricloader", "fabric-loader", "forge", "neoforge", "quilt_loader"];

/// Fabric-API-Module tauchen in fast jedem Stacktrace auf – als Konfliktpartner nur, wenn nichts anderes da ist.
fn is_noise(id: &str) -> bool {
    is_builtin(id) || id.starts_with("fabric-") || id.starts_with("fabric_") || id == "fabric-api"
}

// ------------------------------------------------------------------ Kontext

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
fn cmp_version(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |s: &str| -> Vec<u64> {
        s.split(['+', '-', ' ']).next().unwrap_or(s).split(|c: char| !c.is_ascii_digit()).filter(|x| !x.is_empty()).filter_map(|x| x.parse().ok()).collect()
    };
    parse(a).cmp(&parse(b))
}

/// Braucht die Anforderung eine neuere Version als die vorhandene? `None` = unklar.
fn needs_newer(range: &str, present: &str) -> Option<bool> {
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
fn clean_range(r: &str) -> String {
    let r = r.trim();
    if r.eq_ignore_ascii_case("any version") || r == "*" {
        return String::new();
    }
    r.strip_prefix("version ").unwrap_or(r).to_string()
}

// ------------------------------------------------------------------ Auswertungen

fn g<'t>(c: &Captures<'t>, name: &str) -> Option<&'t str> {
    [name.to_string(), format!("{name}2"), format!("{name}3")]
        .iter()
        .find_map(|n| c.name(n).map(|m| m.as_str().trim()))
        .filter(|s| !s.is_empty())
}

/// Fehlende Abhängigkeit: liegt sie deaktiviert in `mods/`, heißt die Lösung „aktivieren“ statt „installieren“.
fn missing_dependency(mods: &ModIndex, conf: u8, dep_id: &str, ids: &[&str], dep_name: Option<&str>) -> Diagnosis {
    let d = Diagnosis::new("missing_dependency", conf).param("dependency", dep_id);
    let off = std::iter::once(dep_id).chain(ids.iter().copied()).find_map(|i| mods.disabled.get(&i.to_ascii_lowercase()));
    match off {
        Some(e) => {
            let name = e.name.clone().or_else(|| dep_name.map(Into::into));
            d.param("dependency_name", name.as_deref().unwrap_or(dep_id))
                .param("disabled_file", &e.file)
                .action(Action::EnableMod { file: e.file.clone(), name })
        }
        None => d
            .param("dependency_name", dep_name.unwrap_or(dep_id))
            .action(Action::InstallDependency { mod_id: dep_id.into(), name: dep_name.map(Into::into) }),
    }
}

/// Mod-IDs in einem Textstück, in Reihenfolge des Auftretens (from mod X, Mixin-Configs, Handler-Namen, Pakete).
fn mods_in(s: &str, mods: &ModIndex) -> Vec<String> {
    static FROM: OnceLock<Regex> = OnceLock::new();
    static CFG: OnceLock<Regex> = OnceLock::new();
    static HANDLER: OnceLock<Regex> = OnceLock::new();
    static CLASS: OnceLock<Regex> = OnceLock::new();
    let from = FROM.get_or_init(|| re(r"from mod ([\w\-]+)"));
    let cfg = CFG.get_or_init(|| re(r"([\w\-.]*mixins?[\w\-.]*\.json)"));
    let handler = HANDLER.get_or_init(|| re(r"(?:handler|redirect|modify|localvar|wrapOperation|wrapWithCondition|constant|inject)\$[a-z0-9]{6}\$([a-z][a-z0-9_]*)\$"));
    let class = CLASS.get_or_init(|| re(r"\b([a-z][\w]*(?:\.[a-z][\w]*){2,}\.[\w$]+)"));
    let mut found: Vec<(usize, String)> = vec![];
    for c in from.captures_iter(s) {
        found.push((c.get(1).unwrap().start(), c[1].to_ascii_lowercase()));
    }
    for c in cfg.captures_iter(s) {
        let name = c[1].to_ascii_lowercase();
        if name.contains("refmap") {
            continue;
        }
        let id = mods.mixins.get(&name).cloned().or_else(|| {
            // Ohne Index: „betterclouds.mixins.json“ / „mixins.sodium.json“ / „sodium-common.mixins.json“
            let stem = name.trim_end_matches(".json").trim_end_matches(".mixins").trim_end_matches(".mixin").trim_start_matches("mixins.").trim_end_matches("-mixins");
            let stem = stem.split(['.']).next().unwrap_or(stem);
            let cand = stem.trim_end_matches("-common").trim_end_matches("-client").trim_end_matches("-fabric").trim_end_matches("-forge").trim_end_matches("-neoforge");
            (!cand.is_empty() && cand != "mixins").then(|| cand.to_string())
        });
        if let Some(id) = id {
            found.push((c.get(1).unwrap().start(), id));
        }
    }
    for c in handler.captures_iter(s) {
        found.push((c.get(1).unwrap().start(), c[1].to_string()));
    }
    if !mods.packages.is_empty() {
        for c in class.captures_iter(s) {
            if let Some((_, id)) = mods.packages.iter().filter(|(p, _)| c[1].starts_with(p.as_str())).max_by_key(|(p, _)| p.len()) {
                found.push((c.get(1).unwrap().start(), id.clone()));
            }
        }
    }
    found.sort_by_key(|(p, _)| *p);
    let mut out: Vec<String> = vec![];
    for (_, id) in found {
        // Mod-ID im Index bevorzugen (Config-Name ≈ Mod-ID)
        let id = if mods.by_id.contains_key(&id) { id } else { mods.by_id.keys().find(|k| k.replace(['-', '_'], "") == id.replace(['-', '_'], "")).cloned().unwrap_or(id) };
        if !out.contains(&id) && !is_builtin(&id) {
            out.push(id);
        }
    }
    out
}

/// Pfad unter `config/` aus einer Fundstelle (absolut oder relativ), normalisiert und ohne `..`.
fn config_path(s: &str) -> Option<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let r = RE.get_or_init(|| re(r#"(?i)(?:^|[^\w])config[\\/](?P<rel>[^\s'"()\[\],;]+?\.(?:json5|jsonc|json|toml|cfg|conf|properties|yaml|yml|txt|snbt|ini))\b"#));
    let rel = r.captures(s)?.name("rel")?.as_str().replace('\\', "/");
    safe_rel(&rel).map(|r| format!("config/{r}"))
}

fn safe_rel(rel: &str) -> Option<String> {
    let rel = rel.trim_start_matches("./");
    if rel.is_empty() || rel.starts_with('/') || rel.contains(':') || rel.split('/').any(|p| p.is_empty() || p == "..") {
        return None;
    }
    Some(rel.to_string())
}

fn handle(p: &Pattern, c: &Captures, src: &LogText, start: usize, ctx: &Ctx, mods: &ModIndex) -> Option<Diagnosis> {
    let conf = p.raw.confidence;
    let text = &src.text;
    match p.raw.kind.as_str() {
        "missing_dependency" => {
            let dep = g(c, "dep_id")?;
            if is_builtin(dep) || mods.by_id.contains_key(&dep.to_ascii_lowercase()) {
                return None;
            }
            let mut d = missing_dependency(mods, conf, dep, &[], g(c, "dep_name")).culprit(g(c, "mod_id"), g(c, "mod_name"));
            let r = clean_range(g(c, "range").unwrap_or(""));
            if !r.is_empty() {
                d = d.param("range", r);
            }
            Some(d)
        }
        "dependency_version" => {
            let dep = g(c, "dep_id")?.to_ascii_lowercase();
            let range = g(c, "range").unwrap_or("");
            let present = g(c, "present").unwrap_or("");
            let (mod_id, mod_name) = (g(c, "mod_id"), g(c, "mod_name"));
            if dep == "minecraft" {
                return Some(Diagnosis::new("wrong_minecraft", conf).culprit(mod_id, mod_name).param("required", clean_range(range)).param("present", present));
            }
            if dep == "java" {
                let major: u32 = range.split(|ch: char| !ch.is_ascii_digit()).find(|s| !s.is_empty())?.parse().ok()?;
                return (major >= 8).then(|| {
                    Diagnosis::new("java_version", conf).param("required", major.to_string()).param("present", present).action(Action::SetJava { major })
                });
            }
            if LOADER_IDS.contains(&dep.as_str()) {
                return Some(Diagnosis::new("loader_version", conf).culprit(mod_id, mod_name).param("loader", dep).param("required", clean_range(range)).param("present", present));
            }
            let dep_name = g(c, "dep_name").map(String::from).or_else(|| mods.file_of(&dep).and_then(|e| e.name.clone())).unwrap_or_else(|| dep.clone());
            let mut d = Diagnosis::new("outdated_dependency", conf)
                .culprit(mod_id, mod_name)
                .param("dependency", &dep)
                .param("dependency_name", &dep_name)
                .param("range", clean_range(range))
                .param("present", present);
            match needs_newer(range, present) {
                // Die anfragende Mod ist zu alt (will eine ältere Abhängigkeit) -> sie aktualisieren
                Some(false) => {
                    d = d.param("direction", "older");
                    if let Some(e) = mod_id.and_then(|m| mods.file_of(m)) {
                        d = d.action(Action::UpdateMod { file: e.file.clone(), mod_id: mod_id.unwrap_or_default().into() });
                    }
                }
                _ => {
                    if let Some(e) = mods.file_of(&dep) {
                        d = d.param("dependency_file", &e.file).action(Action::UpdateMod { file: e.file.clone(), mod_id: dep.clone() });
                    }
                }
            }
            Some(d)
        }
        "declared_conflict" => {
            // Die Mod, die den Konflikt erklärt, schützt sich meist selbst -> die andere deaktivieren
            let other = g(c, "other_id")?;
            if is_builtin(other) {
                return None;
            }
            let mut d = Diagnosis::new("mod_conflict", conf).culprit(Some(other), g(c, "other_name"));
            if let Some(m) = g(c, "mod_id") {
                d = d.param("other_id", m);
            }
            if let Some(n) = g(c, "mod_name") {
                d = d.param("other_name", n);
            }
            Some(d)
        }
        "missing_class" => {
            let cls = g(c, "class")?.replace('.', "/");
            let hint = table().hints.iter().find(|h| {
                cls.starts_with(&h.prefix) && h.loader.as_ref().map(|l| ctx.loader.as_ref().is_some_and(|x| l.contains(x))).unwrap_or(true)
            })?;
            if hint.ids.iter().any(|i| mods.by_id.contains_key(i)) {
                return None;
            }
            let ids: Vec<&str> = hint.ids.iter().map(String::as_str).collect();
            let mut d = missing_dependency(mods, conf, &hint.slug, &ids, Some(&hint.name)).param("class", cls.replace('/', "."));
            if let Some(id) = mods_in(window(text, start, 0, 4000), mods).into_iter().find(|i| !is_noise(i)) {
                d = d.culprit(Some(&id), None);
            }
            Some(d)
        }
        "wrong_loader_file" => {
            let path = g(c, "file")?;
            let file = path.rsplit(['/', '\\']).next().unwrap_or(path).trim();
            let loader = g(c, "loader").unwrap_or("").to_ascii_lowercase().replace("minecraft ", "");
            let mut d = Diagnosis::new("wrong_loader", conf).param("mod_loader", loader).param("file", file);
            d.culprit = Some(Culprit { mod_id: mods.id_of_file(file).map(String::from), name: None, file: Some(file.to_string()) });
            Some(d)
        }
        "duplicate_files" => {
            let files: Vec<String> = g(c, "files")?.split(',').map(|f| f.trim().to_string()).filter(|f| !f.is_empty()).collect();
            let mut d = Diagnosis::new("duplicate_mod", conf).culprit(g(c, "mod_id"), None).param("files", files.join(", "));
            if let Some(f) = files.get(1) {
                d = d.action(Action::DisableMod { file: f.clone() });
            }
            Some(d)
        }
        "duplicate_id" => {
            let id = g(c, "mod_id")?;
            if is_builtin(id) {
                return None;
            }
            let mut d = Diagnosis::new("duplicate_mod", conf).culprit(Some(id), None);
            if let Some(v) = mods.by_id.get(&id.to_ascii_lowercase()).filter(|v| v.len() > 1) {
                let names: Vec<String> = v.iter().map(|e| e.file.clone()).collect();
                d = d.param("files", names.join(", ")).action(Action::DisableMod { file: names[names.len() - 1].clone() });
            }
            Some(d)
        }
        "java_class_version" => {
            let class: u32 = g(c, "class")?.parse().ok()?;
            if class < 45 {
                return None;
            }
            let major = class - 44;
            let present = g(c, "runtime").and_then(|v| v.parse::<u32>().ok()).filter(|v| *v >= 45).map(|v| (v - 44).to_string()).unwrap_or_default();
            Some(Diagnosis::new("java_version", conf).param("required", major.to_string()).param("present", present).action(Action::SetJava { major }))
        }
        "java_too_new" => {
            let runtime = g(c, "runtime")?.parse::<u32>().ok()?.checked_sub(44)?;
            let rec = recommended_java(ctx.mc_version.as_deref()?)?;
            (rec < runtime).then(|| {
                Diagnosis::new("java_version", conf)
                    .param("required", rec.to_string())
                    .param("present", runtime.to_string())
                    .param("direction", "older")
                    .action(Action::SetJava { major: rec })
            })
        }
        "java_8" => {
            if ctx.mc_version.as_deref().and_then(recommended_java).is_some_and(|r| r > 8) {
                return None;
            }
            Some(Diagnosis::new("java_version", conf).param("required", "8").param("direction", "older").action(Action::SetJava { major: 8 }))
        }
        "out_of_memory" => {
            let detail = g(c, "detail").unwrap_or("").to_string();
            let suggest = suggest_ram(ctx.max_memory_mb, ctx.system_memory_mb);
            let mut d = Diagnosis::new("out_of_memory", conf)
                .param("current", ctx.max_memory_mb.to_string())
                .param("suggest", suggest.to_string())
                .param("detail", detail);
            if suggest > ctx.max_memory_mb {
                d = d.action(Action::IncreaseRam { suggest_mb: suggest });
            } else {
                d = d.param("limit", ctx.system_memory_mb.to_string());
            }
            Some(d)
        }
        "heap_reserve" => Some(Diagnosis::new("heap_reserve", conf).param("current", ctx.max_memory_mb.to_string()).param("system", ctx.system_memory_mb.to_string())),
        "mixin_conflict" => {
            let a = mods_in(g(c, "a")?, mods).into_iter().next()?;
            let b = mods_in(g(c, "b")?, mods).into_iter().next()?;
            (a != b).then(|| Diagnosis::new("mixin_conflict", conf).culprit(Some(&a), None).param("other_id", b))
        }
        "mixin_failure" => {
            // Beteiligte Mods zuerst aus der Meldung selbst (die ersten Zeilen), sonst aus dem Stacktrace
            let w = window(text, start, 0, 8000);
            let msg: String = w.lines().take(3).collect::<Vec<_>>().join("\n");
            // Konfliktpartner nur aus der Meldung – Stacktrace-Frames („[from mod x]“) nennen nur, wer die Methode
            // ebenfalls verändert, und taugen höchstens als Hinweis auf den Verursacher
            let mut ids = mods_in(&msg, mods);
            if ids.is_empty() {
                ids = mods_in(w, mods).into_iter().filter(|i| !is_noise(i)).take(1).collect();
            }
            let clean: Vec<String> = ids.iter().filter(|i| !is_noise(i)).cloned().collect();
            let ids = if clean.is_empty() { ids } else { clean };
            match ids.as_slice() {
                [] => None,
                [one] => Some(Diagnosis::new("mixin", conf).culprit(Some(one), None)),
                [a, b, ..] => Some(Diagnosis::new("mixin_conflict", conf.max(88)).culprit(Some(a), None).param("other_id", b)),
            }
        }
        "broken_config" => {
            let path = match g(c, "path") {
                Some(p) => {
                    if g(c, "ctype").is_some_and(|t| t.eq_ignore_ascii_case("server")) {
                        return None;
                    }
                    config_path(&format!(" {p}")).or_else(|| safe_rel(&p.replace('\\', "/")).map(|r| format!("config/{r}")))?
                }
                None => {
                    // Pfad in der Zeile oder den Nachbarzeilen (2 davor, 4 danach)
                    let ls = text[..start].rfind('\n').map(|i| i + 1).unwrap_or(0);
                    let before: Vec<&str> = text[..ls].lines().rev().take(2).collect();
                    let after: Vec<&str> = text[ls..].lines().take(5).collect();
                    after.iter().chain(before.iter()).find_map(|l| config_path(l))?
                }
            };
            Some(Diagnosis::new("broken_config", conf).culprit(g(c, "mod_id"), None).param("path", &path).action(Action::ResetConfig { path }))
        }
        "graphics" => {
            let mut d = Diagnosis::new("graphics", conf).action(Action::UpdateDrivers);
            if let Some(dll) = g(c, "detail") {
                d = d.param("dll", dll);
            }
            Some(d)
        }
        "suspected_mod" => {
            let (id, name) = match (g(c, "mod_id"), g(c, "detail")) {
                (Some(id), _) => (id.to_string(), None),
                (None, Some(det)) => {
                    // „Sodium (sodium), Version: 0.5.8“
                    let first = det.split(',').next().unwrap_or("").trim();
                    match (first.find('('), first.find(')')) {
                        (Some(a), Some(b)) if b > a => (first[a + 1..b].to_string(), Some(first[..a].trim().to_string())),
                        _ => (first.to_string(), None),
                    }
                }
                _ => return None,
            };
            if id.is_empty() || is_builtin(&id) || id.eq_ignore_ascii_case("none") {
                return None;
            }
            Some(Diagnosis::new("suspected_mod", conf).culprit(Some(&id), name.as_deref()))
        }
        other => {
            tracing::warn!("Crash-Muster {}: unbekannte Auswertung {other}", p.raw.id);
            None
        }
    }
}

/// Bekannte unverträgliche Paare (`conflicts.toml`) unter den aktiven Mods.
#[derive(Debug, Clone, PartialEq)]
pub struct PairHit {
    pub id: String,
    pub a_file: String,
    pub a_name: String,
    pub b_file: String,
    pub b_name: String,
    pub source: String,
}

fn side_file(mods: &ModIndex, s: &PairSide, file_re: Option<&Regex>) -> Option<(String, String)> {
    let ver_ok = |v: Option<&str>| match &s.version {
        None => true,
        Some(want) => v.is_some_and(|v| v.starts_with(want.as_str())),
    };
    for id in &s.ids {
        if let Some(e) = mods.by_id.get(&id.to_ascii_lowercase()).and_then(|v| v.iter().find(|e| ver_ok(e.version.as_deref()))) {
            return Some((e.file.clone(), e.name.clone().unwrap_or_else(|| s.name.clone())));
        }
    }
    // Datei ohne Metadaten (OptiFine) bzw. Version im Dateinamen
    let re = file_re?;
    mods.files
        .iter()
        .find(|f| re.is_match(f) && mods.id_of_file(f).is_none() && s.version.as_ref().map(|v| f.contains(v.as_str())).unwrap_or(true))
        .map(|f| (f.clone(), s.name.clone()))
}

pub fn known_pairs(mods: &ModIndex) -> Vec<PairHit> {
    let mut out = vec![];
    for p in &table().pairs {
        let (Some((af, an)), Some((bf, bn))) = (side_file(mods, &p.raw.a, p.a_file.as_ref()), side_file(mods, &p.raw.b, p.b_file.as_ref())) else {
            continue;
        };
        if af == bf || out.iter().any(|h: &PairHit| h.a_file == af && h.b_file == bf) {
            continue;
        }
        out.push(PairHit { id: p.raw.id.clone(), a_file: af, a_name: an, b_file: bf, b_name: bn, source: p.raw.source.clone() });
    }
    out
}

// ------------------------------------------------------------------ Auswertung

fn dedupe_key(d: &Diagnosis) -> String {
    // Dieselbe fehlende Abhängigkeit (mehrere Mods brauchen sie, mehrere Fehlerzeilen) nur einmal
    if d.id == "missing_dependency" {
        return format!("{}:{:?}", d.id, d.params.get("dependency"));
    }
    let c = d.culprit.as_ref();
    format!(
        "{}:{:?}:{:?}:{:?}:{:?}:{:?}",
        d.id,
        c.and_then(|c| c.mod_id.clone()),
        c.and_then(|c| c.file.clone()),
        d.params.get("dependency"),
        d.params.get("path"),
        d.params.get("other_id")
    )
}

/// Hauptfunktion: Protokolle (Crash-Report, Log, Konsole – wichtigstes zuerst) auswerten.
pub fn analyze(sources: &[LogText], ctx: &Ctx, mods: &ModIndex) -> Vec<Diagnosis> {
    let t = table();
    let fatal = ctx.crash_report || ctx.exit_code.is_some_and(|c| c != 0) || sources.iter().any(|s| t.fatal.iter().any(|m| s.text.contains(m.as_str())));
    let mut out: Vec<Diagnosis> = vec![];
    let mut seen: HashSet<String> = HashSet::new();
    let mut push = |d: Diagnosis, out: &mut Vec<Diagnosis>| {
        if seen.insert(dedupe_key(&d)) {
            out.push(d);
            true
        } else {
            false
        }
    };

    'passes: for fallback in [false, true] {
        if fallback && out.iter().any(|d| d.confidence >= 85) {
            break;
        }
        for p in t.patterns.iter().filter(|p| p.raw.fallback == fallback) {
            if p.raw.fatal && !fatal {
                continue;
            }
            if let Some(l) = &p.raw.loader {
                if !ctx.loader.as_ref().is_some_and(|x| l.contains(x)) {
                    continue;
                }
            }
            for src in sources {
                if p.also.as_ref().is_some_and(|a| !a.is_match(&src.text)) {
                    continue;
                }
                for c in p.re.captures_iter(&src.text).take(20) {
                    let m = c.get(0).unwrap();
                    let line = line_of(&src.text, m.start());
                    if p.unless.as_ref().is_some_and(|u| u.is_match(line)) {
                        continue;
                    }
                    let Some(mut d) = handle(p, &c, src, m.start(), ctx, mods) else { continue };
                    d.rule = Some(p.raw.id.clone());
                    d.source = Some(src.name.clone());
                    d.line = Some(src.line_no(m.start()));
                    let d = d.evidence(line);
                    // Unsichere Regeln: nur der erste Treffer
                    if push(d, &mut out) && fallback {
                        break 'passes;
                    }
                }
            }
        }
    }

    if fatal {
        // Doppelte Mods (aus dem mods-Ordner selbst – zuverlässig)
        let mut dups: Vec<_> = mods.by_id.iter().filter(|(id, v)| v.len() > 1 && !is_builtin(id)).collect();
        dups.sort_by(|a, b| a.0.cmp(b.0));
        for (id, files) in dups {
            let names: Vec<String> = files.iter().map(|f| f.file.clone()).collect();
            let d = Diagnosis::new("duplicate_mod", 80)
                .culprit(Some(id), files[0].name.as_deref())
                .param("files", names.join(", "))
                .action(Action::DisableMod { file: names[names.len() - 1].clone() });
            push(d, &mut out);
        }
        // Bekannte unverträgliche Paare
        for h in known_pairs(mods) {
            let mut d = Diagnosis::new("known_conflict", 78)
                .param("other_file", &h.b_file)
                .param("other_name", &h.b_name)
                .param("source", &h.source)
                .action(Action::DisableMod { file: h.a_file.clone() });
            d.rule = Some(h.id.clone());
            d.culprit = Some(Culprit { mod_id: mods.id_of_file(&h.a_file).map(String::from), name: Some(h.a_name.clone()), file: Some(h.a_file.clone()) });
            push(d, &mut out);
        }
    }

    // Exit-Codes als letzter Hinweis
    if let Some(code) = ctx.exit_code {
        if code != 0 && out.is_empty() {
            let id = match code {
                -1073741819 => "exit_access_violation",
                -805306369 => "exit_hang",
                -1073740791 | -1073740940 => "exit_native",
                137 | -9 => "exit_killed",
                _ => "exit_code",
            };
            let mut d = Diagnosis::new("exit_code", 30).param("code", code.to_string()).param("hint", id);
            if id == "exit_access_violation" {
                d = d.action(Action::UpdateDrivers);
            }
            push(d, &mut out);
        }
    }

    // Schuldige den Dateien zuordnen, sinnvolle Standard-Aktionen ergänzen
    for d in out.iter_mut() {
        if let Some(c) = d.culprit.as_mut() {
            if let Some(id) = c.mod_id.clone() {
                if let Some(e) = mods.file_of(&id) {
                    if c.file.is_none() {
                        c.file = Some(e.file.clone());
                    }
                    if c.name.is_none() {
                        c.name = e.name.clone();
                    }
                }
            }
        }
        if let Some(o) = d.params.get("other_id").cloned() {
            if let Some(e) = mods.file_of(&o) {
                d.params.entry("other_file".into()).or_insert_with(|| e.file.clone());
                if let Some(n) = &e.name {
                    d.params.entry("other_name".into()).or_insert_with(|| n.clone());
                }
            }
        }
        let disable = matches!(d.id.as_str(), "mixin" | "mixin_conflict" | "mod_conflict" | "wrong_minecraft" | "wrong_loader" | "suspected_mod");
        if let (true, Some(f)) = (disable, d.culprit.as_ref().and_then(|c| c.file.clone())) {
            if !d.actions.iter().any(|a| matches!(a, Action::DisableMod { .. })) {
                d.actions.insert(0, Action::DisableMod { file: f });
            }
        }
        d.actions.push(Action::Upload);
    }

    // Überschneidungen: derselbe Mixin-Fehler als Einzel- und Paarbefund, bekanntes Paar mit konkretem Konflikt
    // (Mod-ID, Datei) der vorgeschlagenen Mod und der Alternative
    type Side = (Option<String>, Option<String>);
    let pairs: Vec<(Side, Side)> = out
        .iter()
        .filter(|d| matches!(d.id.as_str(), "mixin_conflict" | "mod_conflict"))
        .map(|d| {
            let c = d.culprit.as_ref();
            ((c.and_then(|c| c.mod_id.clone()), c.and_then(|c| c.file.clone())), (d.params.get("other_id").cloned(), d.params.get("other_file").cloned()))
        })
        .collect();
    out.retain(|d| {
        let c = d.culprit.as_ref();
        let id = c.and_then(|c| c.mod_id.clone());
        let file = c.and_then(|c| c.file.clone());
        match d.id.as_str() {
            "mixin" => !pairs.iter().any(|((a, _), (b, _))| id.is_some() && (id == *a || id == *b)),
            "known_conflict" => {
                let other = d.params.get("other_file").cloned();
                !pairs.iter().any(|((_, af), (_, bf))| file.is_some() && ((file == *af && other == *bf) || (file == *bf && other == *af)))
            }
            _ => true,
        }
    });
    out.sort_by_key(|d| std::cmp::Reverse(d.confidence));
    out
}

/// Kurzform für einen einzelnen Text (Tests, Logs-Tab).
pub fn analyze_text(text: &str, exit_code: Option<i32>, mods: &ModIndex, max_memory_mb: u32) -> Vec<Diagnosis> {
    let ctx = Ctx { exit_code, max_memory_mb, ..Default::default() };
    analyze(&[LogText::new("log", text)], &ctx, mods)
}

fn modified(p: &Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// Pfad muss im Spielordner der Instanz liegen.
fn inside(base: &Path, p: &str) -> Option<std::path::PathBuf> {
    let c = std::path::PathBuf::from(p).canonicalize().ok()?;
    let b = base.canonicalize().ok()?;
    c.starts_with(&b).then_some(c)
}

/// Protokolle des letzten Starts: Crash-Report, JVM-Absturzdatei (hs_err), latest.log, Konsolenausgabe.
/// Ältere Dateien (von einem früheren Start) werden ausgelassen.
pub fn collect_sources(game: &Path, crash_report: Option<&str>, started_ms: Option<i64>, session: &str) -> Vec<LogText> {
    use std::time::{Duration, UNIX_EPOCH};
    let started = started_ms.map(|ms| UNIX_EPOCH + Duration::from_millis(ms.max(0) as u64) - Duration::from_secs(5));
    let mut out = vec![];
    let report = crash_report.and_then(|p| inside(game, p).or_else(|| inside(game, &game.join(p).to_string_lossy())));
    let report_time = report.as_deref().and_then(modified);
    if let Some(p) = &report {
        let name = p.strip_prefix(game.canonicalize().unwrap_or_default()).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_else(|_| "crash-report".into());
        out.extend(LogText::read(p, name));
    }
    // Gehört der gewählte Crash-Report zu einem früheren Start, passen latest.log/Konsole nicht dazu
    let newer_than_report = |t: Option<std::time::SystemTime>| match (report_time, t) {
        (Some(r), Some(t)) => t.duration_since(r).map(|d| d > Duration::from_secs(600)).unwrap_or(false),
        _ => false,
    };
    // JVM-Absturz (nativer Code, oft Grafiktreiber)
    if let (Some(since), Ok(rd)) = (started, std::fs::read_dir(game)) {
        let mut best: Option<(std::time::SystemTime, std::path::PathBuf)> = None;
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.starts_with("hs_err_pid") && n.ends_with(".log") {
                if let Some(t) = modified(&e.path()).filter(|t| *t >= since) {
                    if best.as_ref().map(|(b, _)| t > *b).unwrap_or(true) {
                        best = Some((t, e.path()));
                    }
                }
            }
        }
        if let Some((_, p)) = best {
            let n = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            out.extend(LogText::read(&p, n));
        }
    }
    let latest = game.join("logs").join("latest.log");
    let lt = modified(&latest);
    let stale = match (started, lt) {
        (Some(s), Some(t)) => t < s,
        _ => false,
    };
    if !stale && !newer_than_report(lt) {
        out.extend(LogText::read(&latest, "logs/latest.log"));
    }
    if !session.trim().is_empty() && !newer_than_report(started) {
        out.push(LogText::new("console", session));
    }
    out
}

/// Crash-Report (falls angegeben), `latest.log` und Sitzungs-Log einer Instanz auswerten.
pub async fn analyze_instance(
    state: &crate::state::AppState,
    instance_id: &str,
    crash_report: Option<String>,
    exit_code: Option<i32>,
) -> crate::error::AppResult<Vec<Diagnosis>> {
    let inst = state.instances.get(instance_id)?;
    let game = state.paths.game_dir(instance_id);
    let session: String = state.game.session_log(instance_id).iter().map(|l| format!("{}\n", l.text)).collect();
    let started = state.game.states().into_iter().find(|s| s.instance_id == instance_id).and_then(|s| s.started_at);
    let loader = match inst.loader.kind {
        crate::instance::LoaderKind::Vanilla => None,
        k => serde_json::to_value(k).ok().and_then(|v| v.as_str().map(String::from)),
    };
    let ctx = Ctx {
        exit_code,
        crash_report: crash_report.is_some(),
        max_memory_mb: inst.java.max_memory_mb.unwrap_or(state.settings().max_memory_mb),
        system_memory_mb: crate::settings::system_memory_mb().min(u32::MAX as u64) as u32,
        mc_version: Some(inst.mc_version.clone()),
        loader,
    };
    tokio::task::spawn_blocking(move || {
        let sources = collect_sources(&game, crash_report.as_deref(), started, &session);
        let mods = ModIndex::scan(&game.join("mods"));
        analyze(&sources, &ctx, &mods)
    })
    .await
    .map_err(|e| crate::error::AppError::msg(e.to_string()))
}

#[cfg(test)]
mod tests;
