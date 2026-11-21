//! Synchronisieren zwischen Instanzen. Je Instanz einzeln an/aus und je Bereich wählbar:
//!
//! - **Optionen** (`options.txt`: Steuerung inkl. Mod-Tastenbelegungen, Sound, Grafik inkl. OptiFine-`optionsof.txt`,
//!   Sprache, Zugänglichkeit): globales „Master-Profil“ (`options-sync.json`), vor jedem Start in die Instanz
//!   geschrieben und nach dem Beenden aus ihr übernommen. Nur bekannte Schlüssel; Tastenbelegungen nur bei passendem
//!   Format (ab 1.13 „key.…“).
//! - **Resourcepacks**: gemeinsamer Ordner ([`syncdir`]) + Auswahl/Reihenfolge der aktiven Packs (`resourcePacks`).
//!   Damit für eine Version inkompatible Packs nicht herausfallen, kommen gewählte Packs zusätzlich nach
//!   `incompatibleResourcePacks` – Minecraft lädt sie dann und markiert sie nur. Was das Spiel selbst aus der Liste
//!   wirft (Pack fehlt in dieser Instanz, z. B. ein Pack aus einem Mod), gilt nicht als „abgewählt“.
//! - **Shader**: gemeinsamer Ordner + gewählter Shader (`optionsshaders.txt`, `config/iris.properties`,
//!   `config/oculus.properties` – nur vorhandene Dateien werden angepasst).
//! - **Server-Liste**: `servers.dat` wird zusammengeführt ([`syncservers`]).
//! - **Screenshots**: werden nach dem Spielen zusätzlich in einem gemeinsamen Ordner gesammelt.
//!
//! Abgeglichen wird nur die Instanz, die gerade startet bzw. beendet wurde – laufende Instanzen bleiben unberührt.
//! Ablage: `<data>/sync/{resourcepacks,shaderpacks,screenshots,servers.dat,trash}`, Abgleichstand je Instanz in
//! `<data>/sync/state/<id>.json`. Abschalten verwirft nur den Abgleichstand; alle Dateien bleiben in der Instanz.
use super::{syncdir, syncservers};
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::{Path, PathBuf};
mod personal;

/// Bereiche aus `options.txt`.
pub const CATEGORIES: [&str; 6] = ["controls", "keybinds", "sound", "video", "language", "accessibility"];
/// Weitere Bereiche (Ordner, Server-Liste).
pub const AREAS: [&str; 6] = ["resourcepacks", "shaderpacks", "servers", "screenshots", "hotbars", "command_history"];
/// Bereiche mit gemeinsamem Ordner, der in beide Richtungen abgeglichen wird.
const DIR_AREAS: [&str; 2] = ["resourcepacks", "shaderpacks"];

pub fn known_area(a: &str) -> bool {
    CATEGORIES.contains(&a) || AREAS.contains(&a)
}

const CONTROLS: &[&str] = &[
    "mouseSensitivity",
    "invertYMouse",
    "autoJump",
    "toggleCrouch",
    "toggleSprint",
    "rawMouseInput",
    "discrete_mouse_scroll",
    "mouseWheelSensitivity",
    "operatorItemsTab",
];
const SOUND: &[&str] = &["showSubtitles", "directionalAudio", "soundDevice"];
const VIDEO: &[&str] = &[
    "renderDistance",
    "simulationDistance",
    "graphicsMode",
    "fancyGraphics",
    "guiScale",
    "maxFps",
    "enableVsync",
    "fov",
    "gamma",
    "entityShadows",
    "particles",
    "renderClouds",
    "biomeBlendRadius",
    "ao",
    "mipmapLevels",
    "bobView",
    "fovEffectScale",
    "screenEffectScale",
    "entityDistanceScaling",
    "prioritizeChunkUpdates",
    "menuBackgroundBlurriness",
    "darknessEffectScale",
    "glintSpeed",
    "glintStrength",
    "attackIndicator",
    "chunkSectionFadeInTime",
];
const LANGUAGE: &[&str] = &["lang", "forceUnicodeFont"];
const ACCESSIBILITY: &[&str] = &[
    "narrator",
    "highContrast",
    "highContrastBlockOutline",
    "darkMojangStudiosBackground",
    "hideLightningFlashes",
    "chatOpacity",
    "textBackgroundOpacity",
    "backgroundForChatOnly",
    "chatScale",
    "chatWidth",
    "chatLineSpacing",
    "chatDelay",
    "notificationDisplayTime",
    "panoramaScrollSpeed",
    "damageTiltStrength",
    "narratorHotkey",
    "onboardAccessibility",
    "reducedDebugInfo",
    "showAutosaveIndicator",
];
/// OptiFine-Schlüssel, die vom Bildschirm abhängen und deshalb nicht übertragen werden.
const OPTIFINE_SKIP: &[&str] = &["ofFullscreenMode"];

/// Kategorie eines Schlüssels (None = wird nie synchronisiert).
pub fn category_of(key: &str) -> Option<&'static str> {
    if key.starts_with("key_") {
        return Some("keybinds");
    }
    if key.starts_with("soundCategory_") {
        return Some("sound");
    }
    for (cat, list) in [
        ("controls", CONTROLS),
        ("sound", SOUND),
        ("video", VIDEO),
        ("language", LANGUAGE),
        ("accessibility", ACCESSIBILITY),
    ] {
        if list.contains(&key) {
            return Some(cat);
        }
    }
    None
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct InstanceSync {
    pub enabled: bool,
    /// Gewählte Bereiche: Optionen-Kategorien ([`CATEGORIES`]) und weitere Bereiche ([`AREAS`])
    pub categories: Vec<String>,
}

impl InstanceSync {
    pub fn has(&self, area: &str) -> bool {
        self.enabled && self.categories.iter().any(|c| c == area)
    }
    fn option_categories(&self) -> Vec<String> {
        self.categories.iter().filter(|c| CATEGORIES.contains(&c.as_str())).cloned().collect()
    }
}

/// Gewählter Shader. Werte roh wie in der Properties-Datei (Java-Escapes bleiben erhalten).
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct ShaderSel {
    /// Dateiname des Packs („ComplementaryReimagined_r5.zip“); leer = noch keiner bekannt
    pub pack: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct SyncConfig {
    /// Master-Profil: Schlüssel -> Wert (nur bekannte Schlüssel)
    pub master: BTreeMap<String, String>,
    /// Woher das Profil zuletzt kam (Instanz-ID) und wann (ms)
    pub source: Option<String>,
    pub updated_at: Option<i64>,
    pub instances: BTreeMap<String, InstanceSync>,
    /// Aktive Resourcepacks in Reihenfolge (`resourcePacks` aus options.txt); None = noch nicht erfasst
    pub resource_packs: Option<Vec<String>>,
    /// Gewählter Shader
    pub shader: Option<ShaderSel>,
    /// OptiFine-Einstellungen (`optionsof.txt`, gehört zu „Grafik“)
    pub optifine: BTreeMap<String, String>,
    pub legacy_keybinds: BTreeMap<String, String>,
    keybinds_separate: bool,
}

impl SyncConfig {
    pub fn load(path: &Path) -> SyncConfig {
        let mut cfg: SyncConfig = std::fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        if !cfg.keybinds_separate {
            for inst in cfg.instances.values_mut() {
                if inst.categories.iter().any(|cat| cat == "controls") && !inst.categories.iter().any(|cat| cat == "keybinds") {
                    inst.categories.push("keybinds".into());
                }
            }
            cfg.master.retain(|k, v| {
                if k.starts_with("key_") && !modern_binding(v) {
                    cfg.legacy_keybinds.insert(k.clone(), v.clone());
                    false
                } else {
                    true
                }
            });
            cfg.keybinds_separate = true;
        }
        cfg
    }
    pub fn save(&self, path: &Path) -> AppResult<()> {
        crate::util::write_json_atomic(path, self)
    }
    pub fn for_instance(&self, id: &str) -> InstanceSync {
        self.instances.get(id).cloned().unwrap_or_default()
    }
}

pub fn config_path(root: &Path) -> PathBuf {
    root.join("options-sync.json")
}

// ------------------------------------------------------------------ Ablage und Abgleichstand

pub fn sync_root(root: &Path) -> PathBuf {
    root.join("sync")
}

/// Gemeinsamer Ordner eines Bereichs (resourcepacks | shaderpacks | screenshots).
pub fn shared_dir(root: &Path, area: &str) -> PathBuf {
    sync_root(root).join(area)
}

pub fn shared_servers(root: &Path) -> PathBuf {
    sync_root(root).join("servers.dat")
}

fn trash_dir(root: &Path, area: &str) -> PathBuf {
    sync_root(root).join("trash").join(area)
}

fn state_path(root: &Path, id: &str) -> PathBuf {
    sync_root(root).join("state").join(format!("{id}.json"))
}

/// Gemeldeter Konflikt (bleibt sichtbar, bis er quittiert wird).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConflictNote {
    pub at: i64,
    pub area: String,
    pub name: String,
    pub renamed: String,
}

/// Abgleichstand einer Instanz.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct InstanceState {
    /// Bereich -> Stand nach dem letzten Abgleich
    pub dirs: BTreeMap<String, syncdir::Base>,
    /// Bereits gesammelte Screenshots
    pub screenshots: BTreeSet<String>,
    pub servers: Option<syncservers::ServerBase>,
    /// Pack-Liste, die vor dem letzten Start geschrieben wurde
    pub packs_applied: Option<Vec<String>>,
    personal: BTreeMap<String, String>,
    command_history_base: Vec<String>,
    options_applied: Option<BTreeMap<String, String>>,
    pub last_sync: Option<i64>,
    pub conflicts: Vec<ConflictNote>,
    /// Fehler des letzten Abgleichs (z. B. gesperrte Datei)
    pub errors: Vec<String>,
}

impl InstanceState {
    pub fn load(root: &Path, id: &str) -> InstanceState {
        std::fs::read(state_path(root, id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }
    pub fn save(&self, root: &Path, id: &str) -> AppResult<()> {
        crate::util::write_json_atomic(&state_path(root, id), self)
    }
}

/// Ein Abgleich zur Zeit (Start, Ende, „Jetzt abgleichen“, Einstellungen).
static LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

/// Abgleichstand vergessen (z. B. nach einer Snapshot-Wiederherstellung): der nächste Abgleich vereinigt nur und
/// löscht nichts – ein zurückgeholter alter Stand gilt nicht als „in der Instanz gelöscht“.
pub fn forget_state(root: &Path, id: &str) {
    let _g = LOCK.lock();
    forget_areas(root, id, None);
}

/// Abgleichstand einzelner Bereiche (None = alle) vergessen; Konfliktmeldungen bleiben.
fn forget_areas(root: &Path, id: &str, areas: Option<&[String]>) {
    if !state_path(root, id).exists() {
        return;
    }
    let mut st = InstanceState::load(root, id);
    let hit = |a: &str| areas.map_or(true, |v| v.iter().any(|x| x == a));
    for a in DIR_AREAS {
        if hit(a) {
            st.dirs.remove(a);
        }
    }
    if hit("resourcepacks") {
        st.packs_applied = None;
    }
    if hit("servers") {
        st.servers = None;
    }
    if hit("screenshots") {
        st.screenshots.clear();
    }
    for area in personal::AREAS {
        if hit(area) {
            st.personal.remove(area);
        }
    }
    if hit("command_history") {
        st.command_history_base.clear();
    }
    if hit("keybinds") {
        st.options_applied = None;
    }
    if let Err(e) = st.save(root, id) {
        tracing::warn!("Sync-Stand von {id} nicht gespeichert: {e}");
    }
}

/// Einstellungen einer Instanz speichern. Abgewählte Bereiche (bzw. alles beim Abschalten) verlieren ihren
/// Abgleichstand – die Dateien bleiben in der Instanz. Gibt die Bereiche zurück, die neu dazukamen.
pub fn set_instance(root: &Path, id: &str, enabled: bool, categories: Vec<String>) -> AppResult<Vec<String>> {
    let _g = LOCK.lock();
    let p = config_path(root);
    let mut cfg = SyncConfig::load(&p);
    let old = cfg.for_instance(id);
    let now = InstanceSync { enabled, categories };
    let removed: Vec<String> = AREAS.iter().chain(&["keybinds"]).filter(|a| old.has(a) && !now.has(a)).map(|s| s.to_string()).collect();
    let added: Vec<String> = AREAS.iter().filter(|a| !old.has(a) && now.has(a)).map(|s| s.to_string()).collect();
    cfg.instances.insert(id.to_string(), now);
    cfg.save(&p)?;
    if !removed.is_empty() {
        forget_areas(root, id, Some(&removed));
    }
    Ok(added)
}

// ------------------------------------------------------------------ Listen zusammenführen

/// 3-Wege-Zusammenführung einer geordneten Liste eindeutiger Schlüssel.
/// `master` = gemeinsamer Stand, `base` = Stand der Instanz nach dem letzten Abgleich, `local` = Instanz jetzt.
/// Hat die Instanz nichts geändert, gilt `master`. Sonst gilt die Instanz (inkl. Reihenfolge) – ohne das, was
/// anderswo inzwischen gelöscht wurde, plus das, was anderswo neu dazukam (hinter seinem Vorgänger).
pub fn merge_list<T: PartialEq + Clone>(master: &[T], base: &[T], local: &[T]) -> Vec<T> {
    if local == base {
        return master.to_vec();
    }
    if base.is_empty() {
        // Erster Abgleich: eigene Einträge zuerst, dann was es sonst noch gibt
        let mut out = local.to_vec();
        out.extend(master.iter().filter(|x| !local.contains(x)).cloned());
        return out;
    }
    let mut out: Vec<T> = local.iter().filter(|x| !base.contains(x) || master.contains(x)).cloned().collect();
    for (i, x) in master.iter().enumerate() {
        if local.contains(x) || base.contains(x) || out.contains(x) {
            continue;
        }
        let pos = master[..i].iter().rev().find_map(|p| out.iter().position(|o| o == p)).map(|p| p + 1).unwrap_or(0);
        out.insert(pos, x.clone());
    }
    out
}

/// Fehlende Einträge aus `reference` wieder einsetzen (hinter ihrem Vorgänger), wenn `keep` zutrifft.
fn reinsert<T: PartialEq + Clone>(list: &mut Vec<T>, reference: &[T], keep: impl Fn(&T) -> bool) {
    for (i, x) in reference.iter().enumerate() {
        if list.contains(x) || !keep(x) {
            continue;
        }
        let pos = reference[..i].iter().rev().find_map(|p| list.iter().position(|o| o == p)).map(|p| p + 1).unwrap_or(0);
        list.insert(pos, x.clone());
    }
}

// ------------------------------------------------------------------ options.txt

/// options.txt -> Liste (Reihenfolge bleibt erhalten).
pub fn parse_options(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|l| {
            l.split_once(':')
                .map(|(k, v)| (k.to_string(), v.to_string()))
        })
        .filter(|(k, _)| !k.is_empty())
        .collect()
}

fn render_options(opts: &[(String, String)]) -> String {
    let mut s = String::new();
    for (k, v) in opts {
        s.push_str(k);
        s.push(':');
        s.push_str(v);
        s.push('\n');
    }
    s
}

fn set_opt(opts: &mut Vec<(String, String)>, k: &str, v: String) {
    match opts.iter_mut().find(|(ok, _)| ok == k) {
        Some(e) => e.1 = v,
        None => opts.push((k.to_string(), v)),
    }
}

/// Neues Format der Tastenbelegung (ab 1.13: „key.keyboard.w“) vs. alt (Zahlencodes)?
fn modern_binding(value: &str) -> bool {
    value.starts_with("key.") || value == "unknown"
}

fn modern_keys(opts: &[(String, String)]) -> Option<bool> {
    opts.iter()
        .find(|(k, _)| k.starts_with("key_"))
        .map(|(_, v)| modern_binding(v))
}

/// Master-Werte der gewählten Kategorien in eine options.txt einmischen.
pub fn merge_into(
    existing: &str,
    master: &BTreeMap<String, String>,
    categories: &[String],
    target_modern_keys: bool,
) -> String {
    let mut opts = parse_options(existing);
    for (k, v) in master {
        let Some(cat) = category_of(k) else { continue };
        if !categories.iter().any(|c| c == cat) {
            continue;
        }
        if k.starts_with("key_") && modern_binding(v) != target_modern_keys
        {
            continue;
        }
        set_opt(&mut opts, k, v.clone());
    }
    render_options(&opts)
}

/// Bekannte Schlüssel der gewählten Kategorien aus einer options.txt ins Master-Profil übernehmen.
pub fn capture(text: &str, master: &mut BTreeMap<String, String>, categories: &[String]) -> usize {
    let mut n = 0;
    for (k, v) in parse_options(text) {
        if let Some(cat) = category_of(&k) {
            if categories.iter().any(|c| c == cat) {
                master.insert(k, v);
                n += 1;
            }
        }
    }
    n
}

fn applied_options(opts: &[(String, String)], cats: &[String], modern: bool) -> BTreeMap<String, String> {
    opts.iter()
        .filter(|(k, v)| {
            category_of(k).is_some_and(|cat| cats.iter().any(|c| c == cat) && (cat != "keybinds" || modern_binding(v) == modern))
        })
        .cloned()
        .collect()
}

fn capture_options(
    cfg: &mut SyncConfig,
    text: &str,
    cats: &[String],
    mc: &str,
    baseline: Option<&BTreeMap<String, String>>,
    replace: bool,
) -> usize {
    let opts = parse_options(text);
    let modern = modern_keys(&opts).unwrap_or_else(|| !is_pre_113(mc));
    let mut n = 0;
    for cat in cats {
        let master = if cat == "keybinds" && !modern { &mut cfg.legacy_keybinds } else { &mut cfg.master };
        if replace {
            master.retain(|k, _| category_of(k) != Some(cat.as_str()));
        }
        for (k, v) in &opts {
            if category_of(k) != Some(cat.as_str()) || (cat == "keybinds" && modern_binding(v) != modern) {
                continue;
            }
            let current = master.get(k);
            let untouched = current.is_some() && baseline.and_then(|base| base.get(k)) == Some(v);
            if current != Some(v) && !untouched {
                master.insert(k.clone(), v.clone());
                n += 1;
            }
        }
    }
    n
}

fn is_pre_113(mc: &str) -> bool {
    let mut it = mc.split('.');
    match (it.next(), it.next()) {
        (Some("1"), Some(m)) => m.parse::<u32>().map(|m| m < 13).unwrap_or(false),
        _ => false,
    }
}

// ------------------------------------------------------------------ Resourcepacks-Auswahl

fn parse_pack_list(v: &str) -> Option<Vec<String>> {
    serde_json::from_str::<Vec<String>>(v.trim()).ok()
}

/// Pack-Auswahl in eine options.txt schreiben. Gewählte Datei-Packs kommen auch in `incompatibleResourcePacks`,
/// damit Minecraft sie in Versionen, für die sie nicht gemacht sind, trotzdem lädt (und nur markiert) statt sie
/// still abzuwählen. Minecraft räumt kompatible Packs dort selbst wieder aus.
fn write_packs(opts: &mut Vec<(String, String)>, packs: &[String]) {
    let mut incompat = opts.iter().find(|(k, _)| k == "incompatibleResourcePacks").and_then(|(_, v)| parse_pack_list(v)).unwrap_or_default();
    for p in packs.iter().filter(|p| p.starts_with("file/")) {
        if !incompat.contains(p) {
            incompat.push(p.clone());
        }
    }
    set_opt(opts, "resourcePacks", serde_json::to_string(packs).unwrap_or_else(|_| "[]".into()));
    set_opt(opts, "incompatibleResourcePacks", serde_json::to_string(&incompat).unwrap_or_else(|_| "[]".into()));
}

/// Packs, die Minecraft beim letzten Start selbst aus der Auswahl entfernt hat (laut `logs/latest.log`:
/// „Removed resource pack X from options because …“). Nur ein Log aus dieser Sitzung zählt.
fn dropped_by_game(game_dir: &Path, since: Option<i64>) -> HashSet<String> {
    let p = game_dir.join("logs").join("latest.log");
    let Ok(m) = std::fs::metadata(&p) else { return HashSet::new() };
    let mtime = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
    let min = since.map(|s| s - 60_000).unwrap_or_else(|| crate::util::now_ms() - 12 * 3_600_000);
    if mtime < min || m.len() > 64 * 1024 * 1024 {
        return HashSet::new();
    }
    let Ok(b) = std::fs::read(&p) else { return HashSet::new() };
    parse_dropped(&String::from_utf8_lossy(&b))
}

fn parse_dropped(log: &str) -> HashSet<String> {
    const A: &str = "Removed resource pack ";
    const B: &str = " from options because";
    log.lines()
        .filter_map(|l| {
            let s = l.find(A)? + A.len();
            let e = l[s..].find(B)? + s;
            Some(l[s..e].to_string())
        })
        .collect()
}

/// Pack-Auswahl nach dem Spielen ins Master-Profil übernehmen.
fn pull_packs(master: Option<&[String]>, applied: Option<&[String]>, after: &[String], protected: impl Fn(&String) -> bool) -> Vec<String> {
    let mut after = after.to_vec();
    if let Some(ap) = applied {
        // Was das Spiel selbst entfernt hat (fehlt hier), bleibt für die anderen Instanzen gewählt
        reinsert(&mut after, ap, |x| protected(x));
    }
    merge_list(master.unwrap_or(&[]), applied.unwrap_or(&[]), &after)
}

// ------------------------------------------------------------------ Shader-Auswahl

/// (Datei, Iris-Format mit `enableShaders`)
const SHADER_FILES: [(&str, bool); 3] = [("optionsshaders.txt", false), ("config/iris.properties", true), ("config/oculus.properties", true)];

fn prop_key(line: &str) -> Option<&str> {
    let l = line.trim_start();
    if l.is_empty() || l.starts_with('#') || l.starts_with('!') {
        return None;
    }
    let i = l.find(['=', ':'])?;
    Some(l[..i].trim())
}

fn prop_get(text: &str, key: &str) -> Option<String> {
    text.lines().find(|l| prop_key(l) == Some(key)).map(|l| {
        let l = l.trim_start();
        let i = l.find(['=', ':']).unwrap_or(l.len());
        l[(i + 1).min(l.len())..].trim_start().to_string()
    })
}

fn prop_set(text: &str, key: &str, value: &str) -> String {
    let mut found = false;
    let mut out: Vec<String> = text
        .lines()
        .map(|l| {
            if prop_key(l) == Some(key) {
                found = true;
                format!("{key}={value}")
            } else {
                l.to_string()
            }
        })
        .collect();
    if !found {
        out.push(format!("{key}={value}"));
    }
    out.join("\n") + "\n"
}

fn read_shader_file(text: &str, iris: bool) -> ShaderSel {
    let pack = prop_get(text, "shaderPack").unwrap_or_default();
    if iris {
        let enabled = prop_get(text, "enableShaders").map(|v| v.trim() == "true").unwrap_or(!pack.is_empty());
        ShaderSel { pack, enabled }
    } else if pack == "OFF" || pack == "(internal)" || pack.is_empty() {
        ShaderSel { pack: String::new(), enabled: false }
    } else {
        ShaderSel { pack, enabled: true }
    }
}

/// Aktuelle Shader-Wahl einer Instanz (aus der zuletzt geänderten Datei).
fn read_shader(game_dir: &Path) -> Option<ShaderSel> {
    SHADER_FILES
        .iter()
        .filter_map(|(f, iris)| {
            let p = game_dir.join(f);
            let m = std::fs::metadata(&p).ok()?.modified().ok()?;
            Some((m, std::fs::read_to_string(&p).ok()?, *iris))
        })
        .max_by_key(|(m, ..)| *m)
        .map(|(_, t, iris)| read_shader_file(&t, iris))
}

/// Shader-Wahl in alle vorhandenen Shader-Dateien schreiben. Gibt die Anzahl geänderter Dateien zurück.
fn write_shader(game_dir: &Path, sel: &ShaderSel) -> AppResult<usize> {
    let mut n = 0;
    for (f, iris) in SHADER_FILES {
        let p = game_dir.join(f);
        let Ok(text) = std::fs::read_to_string(&p) else { continue };
        let new = if iris {
            let t = if sel.pack.is_empty() { text.clone() } else { prop_set(&text, "shaderPack", &sel.pack) };
            prop_set(&t, "enableShaders", if sel.enabled { "true" } else { "false" })
        } else {
            prop_set(&text, "shaderPack", if sel.enabled && !sel.pack.is_empty() { &sel.pack } else { "OFF" })
        };
        if new != text {
            std::fs::write(&p, new)?;
            n += 1;
        }
    }
    Ok(n)
}

// ------------------------------------------------------------------ Optionen anwenden/übernehmen

/// Vor dem Start: Master-Profil in die Instanz schreiben (falls aktiviert). Gibt die Zahl der Einstellungen zurück.
/// Muss unter [`LOCK`] laufen (siehe [`before_launch`], [`apply_all`]).
pub fn apply(
    root: &Path,
    game_dir: &Path,
    instance_id: &str,
    mc_version: &str,
) -> AppResult<usize> {
    let cfg = SyncConfig::load(&config_path(root));
    let inst = cfg.for_instance(instance_id);
    if !inst.enabled {
        return Ok(0);
    }
    let cats = inst.option_categories();
    let packs = cfg.resource_packs.clone().filter(|_| inst.has("resourcepacks") && !is_pre_113(mc_version));
    let mut n = 0;
    if !cats.is_empty() || packs.is_some() {
        let path = game_dir.join("options.txt");
        let existing = match std::fs::read_to_string(&path) {
            Ok(existing) => existing,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(error) => return Err(error.into()),
        };
        let modern = modern_keys(&parse_options(&existing)).unwrap_or_else(|| !is_pre_113(mc_version));
        let mut master = cfg.master.clone();
        if !modern {
            master.extend(cfg.legacy_keybinds);
        }
        let mut opts = parse_options(&merge_into(&existing, &master, &cats, modern));
        n += master.iter()
            .filter(|(k, v)| {
                category_of(k).is_some_and(|c| cats.iter().any(|x| x == c)
                    && (c != "keybinds" || modern_binding(v) == modern))
            })
            .count();
        if let Some(p) = &packs {
            write_packs(&mut opts, p);
            n += 1;
        }
        if n > 0 {
            std::fs::create_dir_all(game_dir)?;
            std::fs::write(&path, render_options(&opts))?;
        }
        if packs.is_some() || !cats.is_empty() {
            let mut st = InstanceState::load(root, instance_id);
            if packs.is_some() {
                st.packs_applied = packs;
            }
            if !cats.is_empty() {
                st.options_applied = Some(applied_options(&opts, &cats, modern));
            }
            st.save(root, instance_id)?;
        }
    }
    // OptiFine (nur wenn es in der Instanz schon eine optionsof.txt gibt)
    if inst.has("video") && !cfg.optifine.is_empty() {
        let p = game_dir.join("optionsof.txt");
        if let Ok(text) = std::fs::read_to_string(&p) {
            let mut opts = parse_options(&text);
            for (k, v) in &cfg.optifine {
                set_opt(&mut opts, k, v.clone());
            }
            std::fs::write(&p, render_options(&opts))?;
            n += 1;
        }
    }
    if inst.has("shaderpacks") {
        if let Some(sel) = &cfg.shader {
            n += write_shader(game_dir, sel)?;
        }
    }
    Ok(n)
}

/// Nach dem Beenden: Änderungen aus dem Spiel zurück ins Master-Profil holen. `since` = Start der Sitzung (ms).
pub fn pull(root: &Path, game_dir: &Path, instance_id: &str, mc_version: &str, since: Option<i64>) -> AppResult<usize> {
    let p = config_path(root);
    let mut cfg = SyncConfig::load(&p);
    let inst = cfg.for_instance(instance_id);
    if !inst.enabled {
        return Ok(0);
    }
    let cats = inst.option_categories();
    let mut n = 0;
    let mut changed = false;
    if let Ok(text) = std::fs::read_to_string(game_dir.join("options.txt")) {
        if !cats.is_empty() {
            let st = InstanceState::load(root, instance_id);
            let captured = capture_options(&mut cfg, &text, &cats, mc_version, st.options_applied.as_ref(), false);
            n += captured;
            changed |= captured > 0;
        }
        if inst.has("resourcepacks") && !is_pre_113(mc_version) {
            let after = parse_options(&text).into_iter().find(|(k, _)| k == "resourcePacks").and_then(|(_, v)| parse_pack_list(&v));
            if let Some(after) = after {
                let st = InstanceState::load(root, instance_id);
                let dropped = dropped_by_game(game_dir, since);
                let rp = game_dir.join("resourcepacks");
                let protected = |x: &String| dropped.contains(x) || x.strip_prefix("file/").is_some_and(|f| !rp.join(f).exists());
                cfg.resource_packs = Some(pull_packs(cfg.resource_packs.as_deref(), st.packs_applied.as_deref(), &after, protected));
                n += 1;
                changed = true;
            }
        }
    }
    if inst.has("video") {
        if let Ok(text) = std::fs::read_to_string(game_dir.join("optionsof.txt")) {
            for (k, v) in parse_options(&text) {
                if k.starts_with("of") && !OPTIFINE_SKIP.contains(&k.as_str()) {
                    cfg.optifine.insert(k, v);
                }
            }
            changed = true;
        }
    }
    if inst.has("shaderpacks") {
        if let Some(mut sel) = read_shader(game_dir) {
            if sel.pack.is_empty() {
                sel.pack = cfg.shader.as_ref().map(|s| s.pack.clone()).unwrap_or_default();
            }
            cfg.shader = Some(sel);
            changed = true;
        }
    }
    if changed {
        cfg.source = Some(instance_id.to_string());
        cfg.updated_at = Some(chrono::Utc::now().timestamp_millis());
        cfg.save(&p)?;
    }
    Ok(n)
}

/// Master-Profil der gewählten Bereiche aus einer Instanz übernehmen (ersetzt deren Werte). Gibt die Anzahl zurück.
pub fn capture_from(root: &Path, game_dir: &Path, instance_id: &str, mc_version: &str, areas: &[String]) -> AppResult<usize> {
    let _g = LOCK.lock();
    let p = config_path(root);
    let mut cfg = SyncConfig::load(&p);
    let cats: Vec<String> = areas.iter().filter(|c| CATEGORIES.contains(&c.as_str())).cloned().collect();
    let text = std::fs::read_to_string(game_dir.join("options.txt"));
    let mut n = 0;
    if !cats.is_empty() {
        let text = text.as_deref().map_err(|_| crate::error::AppError::NotFound("Diese Instanz hat noch keine options.txt – einmal starten und Einstellungen vornehmen".into()))?;
        n += capture_options(&mut cfg, text, &cats, mc_version, None, true);
    }
    let has = |a: &str| areas.iter().any(|x| x == a);
    if has("resourcepacks") && !is_pre_113(mc_version) {
        if let Some(list) = text.as_deref().ok().and_then(|t| parse_options(t).into_iter().find(|(k, _)| k == "resourcePacks")).and_then(|(_, v)| parse_pack_list(&v)) {
            cfg.resource_packs = Some(list);
            n += 1;
        }
    }
    if has("video") {
        if let Ok(t) = std::fs::read_to_string(game_dir.join("optionsof.txt")) {
            cfg.optifine = parse_options(&t).into_iter().filter(|(k, _)| k.starts_with("of") && !OPTIFINE_SKIP.contains(&k.as_str())).collect();
        }
    }
    if has("shaderpacks") {
        if let Some(sel) = read_shader(game_dir) {
            cfg.shader = Some(sel);
            n += 1;
        }
    }
    for area in personal::AREAS {
        if has(area) {
            n += personal::capture(root, game_dir, area, mc_version)?;
        }
    }
    cfg.source = Some(instance_id.to_string());
    cfg.updated_at = Some(chrono::Utc::now().timestamp_millis());
    cfg.save(&p)?;
    Ok(n)
}

// ------------------------------------------------------------------ Abläufe

/// Ergebnis eines Abgleichs (für Log und Oberfläche).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SyncSummary {
    /// Übertragene/entfernte Einträge (Ordner, Server)
    pub changes: usize,
    pub conflicts: Vec<ConflictNote>,
    pub errors: Vec<String>,
    /// Neu gesammelte Screenshots
    pub screenshots: usize,
    /// Angewendete Einstellungen
    pub options: usize,
}

/// Ordner + Server-Liste (+ Screenshots) einer Instanz abgleichen. Läuft unter [`LOCK`].
fn sync_files(root: &Path, game_dir: &Path, id: &str, name: &str, mc_version: &str, collect_shots: bool) -> SyncSummary {
    let cfg = SyncConfig::load(&config_path(root));
    let inst = cfg.for_instance(id);
    let mut sum = SyncSummary::default();
    if !inst.enabled || !AREAS.iter().any(|a| inst.has(a)) {
        return sum;
    }
    let mut st = InstanceState::load(root, id);
    let now = crate::util::now_ms();
    for area in DIR_AREAS {
        if !inst.has(area) {
            continue;
        }
        let base = st.dirs.entry(area.to_string()).or_default();
        match syncdir::sync(&game_dir.join(area), &shared_dir(root, area), &trash_dir(root, area), base, name) {
            Ok(r) => {
                sum.changes += r.changes();
                sum.errors.extend(r.errors.iter().map(|e| format!("{area}: {e}")));
                sum.conflicts.extend(r.conflicts.into_iter().map(|c| ConflictNote { at: now, area: area.to_string(), name: c.name, renamed: c.renamed }));
            }
            Err(e) => sum.errors.push(format!("{area}: {e}")),
        }
    }
    if inst.has("servers") {
        match syncservers::sync(&game_dir.join("servers.dat"), &shared_servers(root), &mut st.servers) {
            Ok(r) => sum.changes += (r.to_instance + r.to_shared) as usize,
            Err(e) => sum.errors.push(format!("servers.dat: {e}")),
        }
    }
    for area in personal::AREAS {
        if !inst.has(area) {
            continue;
        }
        match personal::sync(root, game_dir, area, mc_version, &mut st) {
            Ok((changes, conflict)) => {
                sum.changes += changes;
                sum.conflicts.extend(conflict);
            }
            Err(error) => sum.errors.push(format!("{area}: {error}")),
        }
    }
    if collect_shots && inst.has("screenshots") {
        match syncdir::collect(&game_dir.join("screenshots"), &shared_dir(root, "screenshots"), &mut st.screenshots, name) {
            Ok(n) => sum.screenshots = n,
            Err(e) => sum.errors.push(format!("screenshots: {e}")),
        }
    }
    st.last_sync = Some(now);
    st.errors = sum.errors.clone();
    st.conflicts.extend(sum.conflicts.iter().cloned());
    let len = st.conflicts.len();
    if len > 30 {
        st.conflicts.drain(..len - 30);
    }
    if let Err(e) = st.save(root, id) {
        sum.errors.push(format!("Abgleichstand: {e}"));
    }
    sum
}

fn log_summary(what: &str, id: &str, s: &SyncSummary) {
    if s.changes + s.screenshots + s.options > 0 || !s.conflicts.is_empty() {
        tracing::info!("Sync {what} {id}: {} Änderungen, {} Einstellungen, {} Screenshots, {} Konflikte", s.changes, s.options, s.screenshots, s.conflicts.len());
    }
    for e in &s.errors {
        tracing::warn!("Sync {what} {id}: {e}");
    }
}

/// Vor dem Start: gemeinsame Ordner und Server-Liste in die Instanz holen, dann Optionen/Pack-/Shader-Auswahl schreiben.
pub fn before_launch(root: &Path, game_dir: &Path, id: &str, name: &str, mc_version: &str) -> SyncSummary {
    let _g = LOCK.lock();
    let mut s = sync_files(root, game_dir, id, name, mc_version, false);
    match apply(root, game_dir, id, mc_version) {
        Ok(n) => s.options = n,
        Err(e) => s.errors.push(format!("Optionen: {e}")),
    }
    log_summary("vor dem Start", id, &s);
    s
}

/// Nach dem Beenden: Optionen/Auswahl übernehmen, Ordner und Server-Liste abgleichen, Screenshots sammeln.
pub fn after_exit(root: &Path, game_dir: &Path, id: &str, name: &str, mc_version: &str, since: Option<i64>) -> SyncSummary {
    let _g = LOCK.lock();
    let mut errors = vec![];
    let options = match pull(root, game_dir, id, mc_version, since) {
        Ok(n) => n,
        Err(e) => {
            errors.push(format!("Optionen: {e}"));
            0
        }
    };
    let mut s = sync_files(root, game_dir, id, name, mc_version, true);
    s.options = options;
    s.errors.extend(errors);
    log_summary("nach dem Spielen", id, &s);
    s
}

/// „Jetzt abgleichen“ (Einstellungen, neu eingeschaltete Bereiche): nur Dateien und Server-Liste, keine Optionen.
/// Die Instanz darf nicht laufen (prüft der Aufrufer).
pub fn sync_now(root: &Path, game_dir: &Path, id: &str, name: &str, mc_version: &str) -> SyncSummary {
    let _g = LOCK.lock();
    let s = sync_files(root, game_dir, id, name, mc_version, true);
    log_summary("manuell", id, &s);
    s
}

/// Master-Profil sofort in die Instanzen schreiben (`(id, game_dir, mc)`). Gibt die Anzahl betroffener Instanzen zurück.
pub fn apply_all(root: &Path, targets: &[(String, PathBuf, String)]) -> AppResult<usize> {
    let _g = LOCK.lock();
    let mut n = 0;
    for (id, game, mc) in targets {
        if apply(root, game, id, mc)? > 0 {
            n += 1;
        }
    }
    Ok(n)
}

/// Konfliktmeldungen einer Instanz quittieren.
pub fn clear_conflicts(root: &Path, id: &str) -> AppResult<()> {
    let _g = LOCK.lock();
    let mut st = InstanceState::load(root, id);
    st.conflicts.clear();
    st.errors.clear();
    st.save(root, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(tag: &str) -> PathBuf {
        let r = std::env::temp_dir().join(format!("vl-optsync-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&r).unwrap();
        r
    }

    fn enable(root: &Path, id: &str, cats: &[&str]) {
        set_instance(root, id, true, cats.iter().map(|s| s.to_string()).collect()).unwrap();
    }

    #[test]
    fn categories() {
        assert_eq!(category_of("key_key.forward"), Some("keybinds"));
        assert_eq!(category_of("soundCategory_music"), Some("sound"));
        assert_eq!(category_of("renderDistance"), Some("video"));
        assert_eq!(category_of("lang"), Some("language"));
        assert_eq!(category_of("version"), None);
        assert_eq!(category_of("resourcePacks"), None);
        assert_eq!(category_of("lastServer"), None);
        assert!(known_area("servers") && known_area("video") && !known_area("saves"));
    }

    #[test]
    fn merge_keeps_other_keys_and_order() {
        let existing = "version:3955\nlang:en_us\nrenderDistance:12\nresourcePacks:[\"vanilla\"]\nkey_key.forward:key.keyboard.w\n";
        let mut master = BTreeMap::new();
        master.insert("lang".into(), "de_de".into());
        master.insert("renderDistance".into(), "8".into());
        master.insert("key_key.forward".into(), "key.keyboard.up".into());
        master.insert("soundCategory_music".into(), "0.2".into());
        let out = merge_into(
            existing,
            &master,
            &["language".into(), "keybinds".into(), "sound".into()],
            true,
        );
        assert_eq!(
            out,
            "version:3955\nlang:de_de\nrenderDistance:12\nresourcePacks:[\"vanilla\"]\nkey_key.forward:key.keyboard.up\nsoundCategory_music:0.2\n"
        );
    }

    #[test]
    fn old_key_format_is_not_mixed() {
        let mut master = BTreeMap::new();
        master.insert("key_key.forward".into(), "key.keyboard.up".into());
        let out = merge_into(
            "version:1343\nkey_key.forward:17\n",
            &master,
            &["keybinds".into()],
            false,
        );
        assert_eq!(out, "version:1343\nkey_key.forward:17\n");
        assert!(is_pre_113("1.12.2"));
        assert!(!is_pre_113("1.21.4"));
    }

    #[test]
    fn capture_only_selected() {
        let mut m = BTreeMap::new();
        let n = capture(
            "version:1\nfov:0.5\nlang:de_de\nlastServer:x\n",
            &mut m,
            &["video".into()],
        );
        assert_eq!(n, 1);
        assert_eq!(m.get("fov").map(String::as_str), Some("0.5"));
        assert!(!m.contains_key("lang"));
    }

    #[test]
    fn keybinds_migrate_and_keep_independent_formats_and_newer_values() {
        let root = tmp_root("keybinds");
        std::fs::write(config_path(&root), r#"{
            "master":{"key_key.forward":"17"},
            "instances":{"a":{"enabled":true,"categories":["controls"]}}
        }"#).unwrap();
        let old = root.join("old");
        let a = root.join("a");
        let b = root.join("b");
        let cfg = SyncConfig::load(&config_path(&root));
        assert!(cfg.for_instance("a").has("keybinds"));
        assert_eq!(cfg.legacy_keybinds["key_key.forward"], "17");
        enable(&root, "old", &["keybinds"]);
        enable(&root, "b", &["keybinds"]);
        apply(&root, &old, "old", "1.12.2").unwrap();
        assert_eq!(std::fs::read_to_string(old.join("options.txt")).unwrap(), "key_key.forward:17\n");

        std::fs::create_dir_all(&a).unwrap();
        std::fs::write(a.join("options.txt"), "key_key.forward:key.keyboard.w\n").unwrap();
        apply(&root, &a, "a", "1.21.4").unwrap();
        pull(&root, &a, "a", "1.21.4", None).unwrap();
        apply(&root, &a, "a", "1.21.4").unwrap();
        apply(&root, &b, "b", "1.21.4").unwrap();
        std::fs::write(b.join("options.txt"), "key_key.forward:key.keyboard.up\n").unwrap();
        pull(&root, &b, "b", "1.21.4", None).unwrap();
        pull(&root, &a, "a", "1.21.4", None).unwrap();

        let cfg = SyncConfig::load(&config_path(&root));
        assert_eq!(cfg.master["key_key.forward"], "key.keyboard.up");
        assert_eq!(cfg.legacy_keybinds["key_key.forward"], "17");
        enable(&root, "a", &["controls"]);
        assert!(!SyncConfig::load(&config_path(&root)).for_instance("a").has("keybinds"));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn hotbars_sync_by_version_and_keep_the_conflicting_copy() {
        let root = tmp_root("hotbars");
        let a = root.join("a");
        let b = root.join("b");
        std::fs::create_dir_all(&a).unwrap();
        enable(&root, "a", &["hotbars"]);
        enable(&root, "b", &["hotbars"]);
        std::fs::write(a.join("hotbar.nbt"), b"first").unwrap();
        assert_eq!(sync_now(&root, &a, "a", "A", "1.21.4").changes, 1);
        assert_eq!(before_launch(&root, &b, "b", "B", "1.20.1").changes, 0);
        assert!(!b.join("hotbar.nbt").exists());
        assert_eq!(before_launch(&root, &b, "b", "B", "1.21.4").changes, 1);
        std::fs::write(a.join("hotbar.nbt"), b"shared edit").unwrap();
        std::fs::write(b.join("hotbar.nbt"), b"local edit").unwrap();
        after_exit(&root, &a, "a", "A", "1.21.4", None);
        let summary = after_exit(&root, &b, "b", "B", "1.21.4", None);
        assert!(summary.errors.is_empty(), "{:?}", summary.errors);
        assert_eq!(std::fs::read(b.join("hotbar.nbt")).unwrap(), b"shared edit");
        assert_eq!(std::fs::read(b.join(&summary.conflicts[0].renamed)).unwrap(), b"local edit");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn histories_merge_new_commands_without_reviving_old_entries() {
        let root = tmp_root("history");
        let a = root.join("a");
        let b = root.join("b");
        std::fs::create_dir_all(&a).unwrap();
        enable(&root, "a", &["command_history"]);
        enable(&root, "b", &["command_history"]);
        let history = (0..50).map(|n| format!("/step{n}\n")).collect::<String>();
        std::fs::write(a.join("command_history.txt"), &history).unwrap();
        before_launch(&root, &a, "a", "A", "1.21.4");
        before_launch(&root, &b, "b", "B", "1.20.2");
        let first = history.find('\n').unwrap() + 1;
        std::fs::write(a.join("command_history.txt"), format!("{}\n/remote\n", &history[first..])).unwrap();
        std::fs::write(b.join("command_history.txt"), format!("{}\n/local\nchat line\n", &history[first..])).unwrap();
        after_exit(&root, &a, "a", "A", "1.21.4", None);
        after_exit(&root, &b, "b", "B", "1.20.2", None);
        let result = std::fs::read_to_string(b.join("command_history.txt")).unwrap();
        assert_eq!(result.lines().count(), 50);
        assert!(result.starts_with("/step2\n"));
        assert!(result.ends_with("/remote\n/local\n"));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn parallel_sessions_do_not_write_back_stale_options() {
        let root = tmp_root("parallel");
        let a = root.join("a");
        let b = root.join("b");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(a.join("options.txt"), "key_key.zoom:key.keyboard.c\nsoundCategory_music:1.0\n").unwrap();
        std::fs::write(b.join("options.txt"), "key_key.zoom:key.keyboard.c\nsoundCategory_music:1.0\nkey_key.map:key.keyboard.m\n").unwrap();
        enable(&root, "a", &["keybinds", "sound"]);
        enable(&root, "b", &["keybinds", "sound"]);
        before_launch(&root, &a, "a", "A", "1.21.4");
        before_launch(&root, &b, "b", "B", "1.21.4");
        std::fs::write(a.join("options.txt"), "key_key.zoom:key.keyboard.z\nsoundCategory_music:0.2\n").unwrap();
        after_exit(&root, &a, "a", "A", "1.21.4", None);
        after_exit(&root, &b, "b", "B", "1.21.4", None);
        let cfg = SyncConfig::load(&config_path(&root));
        assert_eq!(cfg.master["key_key.zoom"], "key.keyboard.z");
        assert_eq!(cfg.master["soundCategory_music"], "0.2");
        assert_eq!(cfg.master["key_key.map"], "key.keyboard.m");
        before_launch(&root, &b, "b", "B", "1.21.4");
        let text = std::fs::read_to_string(b.join("options.txt")).unwrap();
        assert!(text.contains("key_key.zoom:key.keyboard.z\n") && text.contains("soundCategory_music:0.2\n"), "{text}");
        before_launch(&root, &a, "a", "A", "1.21.4");
        std::fs::write(a.join("options.txt"), "key_key.zoom:key.keyboard.z\nsoundCategory_music:0.2\nkey_key.map:key.keyboard.m\n").unwrap();
        assert_eq!(pull(&root, &a, "a", "1.21.4", None).unwrap(), 0);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn apply_and_pull_roundtrip() {
        let root = tmp_root("rt");
        let game = root.join("game");
        std::fs::create_dir_all(&game).unwrap();
        let mut cfg = SyncConfig::default();
        cfg.master.insert("fov".into(), "0.8".into());
        cfg.instances.insert(
            "a".into(),
            InstanceSync {
                enabled: true,
                categories: vec!["video".into()],
            },
        );
        cfg.save(&config_path(&root)).unwrap();
        assert_eq!(apply(&root, &game, "a", "1.21.4").unwrap(), 1);
        assert_eq!(
            std::fs::read_to_string(game.join("options.txt")).unwrap(),
            "fov:0.8\n"
        );
        std::fs::write(game.join("options.txt"), "fov:0.3\nlang:fr_fr\n").unwrap();
        assert_eq!(pull(&root, &game, "a", "1.21.4", None).unwrap(), 1);
        let back = SyncConfig::load(&config_path(&root));
        assert_eq!(back.master.get("fov").map(String::as_str), Some("0.3"));
        assert!(!back.master.contains_key("lang"));
        assert_eq!(apply(&root, &game, "b", "1.21.4").unwrap(), 0);
        std::fs::remove_dir_all(&root).ok();
    }

    /// Bestehende `options-sync.json` (vor dem Ausbau) bleiben gültig: gleiche Bedeutung, neue Felder leer.
    #[test]
    fn old_config_still_works() {
        let root = tmp_root("old");
        let game = root.join("game");
        std::fs::create_dir_all(&game).unwrap();
        std::fs::write(
            config_path(&root),
            r#"{"master":{"lang":"de_de","renderDistance":"10"},"source":"a","updated_at":1700000000000,"instances":{"a":{"enabled":true,"categories":["language","video"]},"b":{"enabled":false,"categories":["controls"]}}}"#,
        )
        .unwrap();
        let cfg = SyncConfig::load(&config_path(&root));
        assert_eq!(cfg.master.len(), 2);
        assert!(cfg.resource_packs.is_none() && cfg.shader.is_none() && cfg.optifine.is_empty());
        assert!(cfg.for_instance("a").has("language") && !cfg.for_instance("a").has("resourcepacks"));
        std::fs::write(game.join("options.txt"), "version:3955\nlang:en_us\nresourcePacks:[\"vanilla\",\"file/x.zip\"]\n").unwrap();
        assert_eq!(apply(&root, &game, "a", "1.21.4").unwrap(), 2);
        let t = std::fs::read_to_string(game.join("options.txt")).unwrap();
        // Pack-Auswahl bleibt unberührt, solange „Resourcepacks“ nicht gewählt ist
        assert_eq!(t, "version:3955\nlang:de_de\nresourcePacks:[\"vanilla\",\"file/x.zip\"]\nrenderDistance:10\n");
        // Ohne Ordner-Bereiche gibt es keinen Abgleichstand und keine gemeinsamen Ordner
        let s = before_launch(&root, &game, "a", "A", "1.21.4");
        assert_eq!(s.changes, 0);
        assert!(!sync_root(&root).join("resourcepacks").exists());
        // Speichern behält alte Felder
        set_instance(&root, "a", true, vec!["language".into(), "video".into(), "servers".into()]).unwrap();
        let cfg = SyncConfig::load(&config_path(&root));
        assert_eq!(cfg.source.as_deref(), Some("a"));
        assert_eq!(cfg.master.get("lang").map(String::as_str), Some("de_de"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn merge_list_three_way() {
        let v = |s: &str| s.split(',').filter(|x| !x.is_empty()).map(String::from).collect::<Vec<_>>();
        // Nichts in der Instanz geändert -> gemeinsamer Stand
        assert_eq!(merge_list(&v("a,b,c"), &v("a,b"), &v("a,b")), v("a,b,c"));
        // Instanz hat sortiert + d hinzugefügt; anderswo kam x dazu, b wurde anderswo gelöscht
        assert_eq!(merge_list(&v("a,x,c"), &v("a,b,c"), &v("c,a,b,d")), v("c,a,x,d"));
        // Instanz hat b gelöscht
        assert_eq!(merge_list(&v("a,b,c"), &v("a,b,c"), &v("a,c")), v("a,c"));
        // Erster Abgleich (kein Stand) vereinigt
        assert_eq!(merge_list(&v("a,b"), &v(""), &v("c,a")), v("c,a,b"));
        assert_eq!(merge_list(&v("a,b"), &v(""), &v("")), v("a,b"));
    }

    #[test]
    fn pack_selection_survives_incompatible_and_missing() {
        // Log-Erkennung
        let log = "[12:00:01] [Render thread/WARN]: Removed resource pack fabric from options because it doesn't seem to exist anymore\n[12:00:01] [Render thread/WARN]: Removed resource pack file/Alt 1.8.zip from options because it is no longer compatible\nanderes";
        let d = parse_dropped(log);
        assert!(d.contains("fabric") && d.contains("file/Alt 1.8.zip") && d.len() == 2);

        let v = |s: &str| s.split(',').filter(|x| !x.is_empty()).map(String::from).collect::<Vec<_>>();
        let master = v("vanilla,fabric,file/A.zip,file/B.zip");
        // Spiel hat fabric (fehlt) entfernt, Nutzer hat B abgewählt
        let after = v("vanilla,file/A.zip");
        let out = pull_packs(Some(&master), Some(&master), &after, |x| x == "fabric");
        assert_eq!(out, v("vanilla,fabric,file/A.zip"));
        // Nichts geändert außer dem Spiel-Entfernen -> unverändert
        let out = pull_packs(Some(&master), Some(&master), &v("vanilla,file/A.zip,file/B.zip"), |x| x == "fabric");
        assert_eq!(out, master);

        // Schreiben: gewählte Datei-Packs gelten als „trotzdem laden“
        let mut opts = parse_options("resourcePacks:[\"vanilla\"]\nincompatibleResourcePacks:[\"file/Eigen.zip\"]\n");
        write_packs(&mut opts, &v("vanilla,file/A.zip"));
        assert_eq!(
            render_options(&opts),
            "resourcePacks:[\"vanilla\",\"file/A.zip\"]\nincompatibleResourcePacks:[\"file/Eigen.zip\",\"file/A.zip\"]\n"
        );
    }

    #[test]
    fn shader_selection_between_optifine_and_iris() {
        let root = tmp_root("shader");
        let (a, b) = (root.join("a"), root.join("b"));
        std::fs::create_dir_all(a.join("config")).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        // A: Iris, B: OptiFine
        std::fs::write(a.join("config/iris.properties"), "#Iris\nshaderPack=Complementary_r5.zip\nenableShaders=true\nmaxShadowRenderDistance=32\n").unwrap();
        std::fs::write(b.join("optionsshaders.txt"), "shaderPack=OFF\nantialiasingLevel=0\n").unwrap();
        enable(&root, "a", &["shaderpacks"]);
        enable(&root, "b", &["shaderpacks"]);
        pull(&root, &a, "a", "1.21.4", None).unwrap();
        assert_eq!(SyncConfig::load(&config_path(&root)).shader, Some(ShaderSel { pack: "Complementary_r5.zip".into(), enabled: true }));
        apply(&root, &b, "b", "1.21.4").unwrap();
        assert_eq!(std::fs::read_to_string(b.join("optionsshaders.txt")).unwrap(), "shaderPack=Complementary_r5.zip\nantialiasingLevel=0\n");
        // In B (OptiFine) ausgeschaltet -> A: enableShaders=false, Pack bleibt gemerkt
        std::thread::sleep(std::time::Duration::from_millis(15));
        std::fs::write(b.join("optionsshaders.txt"), "shaderPack=OFF\nantialiasingLevel=0\n").unwrap();
        pull(&root, &b, "b", "1.21.4", None).unwrap();
        apply(&root, &a, "a", "1.21.4").unwrap();
        let t = std::fs::read_to_string(a.join("config/iris.properties")).unwrap();
        assert!(t.contains("shaderPack=Complementary_r5.zip\nenableShaders=false\nmaxShadowRenderDistance=32"), "{t}");
        // Ohne Shader-Mod (keine Datei) wird nichts angelegt
        let c = root.join("c");
        std::fs::create_dir_all(&c).unwrap();
        enable(&root, "c", &["shaderpacks"]);
        apply(&root, &c, "c", "1.21.4").unwrap();
        assert!(!c.join("optionsshaders.txt").exists() && !c.join("config").exists());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn optifine_options_follow_video() {
        let root = tmp_root("of");
        let (a, b) = (root.join("a"), root.join("b"));
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(a.join("optionsof.txt"), "ofFogType:3\nofFullscreenMode:1920x1080\nofDynamicLights:2\n").unwrap();
        std::fs::write(b.join("optionsof.txt"), "ofFogType:1\nofFullscreenMode:2560x1440\n").unwrap();
        enable(&root, "a", &["video"]);
        enable(&root, "b", &["video"]);
        pull(&root, &a, "a", "1.20.1", None).unwrap();
        apply(&root, &b, "b", "1.20.1").unwrap();
        assert_eq!(std::fs::read_to_string(b.join("optionsof.txt")).unwrap(), "ofFogType:3\nofFullscreenMode:2560x1440\nofDynamicLights:2\n");
        std::fs::remove_dir_all(&root).ok();
    }

    /// Zwei Instanzen mit Resourcepacks + Server-Liste: Start/Ende, Abschalten ohne Datenverlust.
    #[test]
    fn instances_share_packs_and_servers() {
        use crate::platform::servers::{read_servers, write_servers, ServerEntry};
        let root = tmp_root("e2e");
        let (a, b) = (root.join("instances/a/minecraft"), root.join("instances/b/minecraft"));
        for g in [&a, &b] {
            std::fs::create_dir_all(g.join("resourcepacks")).unwrap();
        }
        std::fs::write(a.join("resourcepacks/Faithful.zip"), b"faithful").unwrap();
        std::fs::write(a.join("options.txt"), "version:3955\nresourcePacks:[\"vanilla\",\"file/Faithful.zip\"]\n").unwrap();
        let srv = |name: &str, ip: &str| ServerEntry { name: name.into(), ip: ip.into(), icon: None, accept_textures: None, hidden: false };
        write_servers(&a.join("servers.dat"), &[srv("Hypixel", "mc.hypixel.net")]).unwrap();
        write_servers(&b.join("servers.dat"), &[srv("Zuhause", "home.example")]).unwrap();
        enable(&root, "a", &["resourcepacks", "servers"]);
        enable(&root, "b", &["resourcepacks", "servers"]);

        // A spielt: danach liegen Pack, Auswahl und Server gemeinsam bereit
        before_launch(&root, &a, "a", "A", "1.21.4");
        let s = after_exit(&root, &a, "a", "A", "1.21.4", None);
        assert!(s.errors.is_empty(), "{:?}", s.errors);
        assert_eq!(SyncConfig::load(&config_path(&root)).resource_packs, Some(vec!["vanilla".to_string(), "file/Faithful.zip".to_string()]));

        // B startet: bekommt Pack, Auswahl und Server; eigener Server bleibt
        before_launch(&root, &b, "b", "B", "1.20.1");
        assert_eq!(std::fs::read(b.join("resourcepacks/Faithful.zip")).unwrap(), b"faithful");
        let t = std::fs::read_to_string(b.join("options.txt")).unwrap();
        assert!(t.contains("resourcePacks:[\"vanilla\",\"file/Faithful.zip\"]"), "{t}");
        assert!(t.contains("incompatibleResourcePacks:[\"file/Faithful.zip\"]"), "{t}");
        let names: Vec<String> = read_servers(&b.join("servers.dat")).unwrap().into_iter().map(|s| s.name).collect();
        assert_eq!(names, vec!["Zuhause", "Hypixel"]);
        after_exit(&root, &b, "b", "B", "1.20.1", None);
        before_launch(&root, &a, "a", "A", "1.21.4");
        let names: Vec<String> = read_servers(&a.join("servers.dat")).unwrap().into_iter().map(|s| s.name).collect();
        assert_eq!(names, vec!["Zuhause", "Hypixel"]);

        // Laufende Instanz wird nicht angefasst: A „läuft“, B fügt ein Pack hinzu -> A bleibt, bis A wieder startet
        std::fs::write(b.join("resourcepacks/Neu.zip"), b"neu").unwrap();
        after_exit(&root, &b, "b", "B", "1.20.1", None);
        assert!(!a.join("resourcepacks/Neu.zip").exists());
        assert!(shared_dir(&root, "resourcepacks").join("Neu.zip").exists());

        // B schaltet Resourcepacks ab: nichts verschwindet aus B, gemeinsamer Ordner bleibt
        set_instance(&root, "b", true, vec!["servers".into()]).unwrap();
        assert!(!InstanceState::load(&root, "b").dirs.contains_key("resourcepacks"));
        std::fs::remove_file(b.join("resourcepacks/Faithful.zip")).unwrap();
        before_launch(&root, &b, "b", "B", "1.20.1");
        after_exit(&root, &b, "b", "B", "1.20.1", None);
        assert!(b.join("resourcepacks/Neu.zip").exists());
        assert!(shared_dir(&root, "resourcepacks").join("Faithful.zip").exists(), "Löschen ohne Sync wirkt nicht auf den gemeinsamen Ordner");
        // A bekommt beim nächsten Start das neue Pack
        before_launch(&root, &a, "a", "A", "1.21.4");
        assert!(a.join("resourcepacks/Neu.zip").exists() && a.join("resourcepacks/Faithful.zip").exists());

        // Snapshot-Wiederherstellung in A (alter Stand ohne Neu.zip) darf Neu.zip nicht überall löschen
        std::fs::remove_file(a.join("resourcepacks/Neu.zip")).unwrap();
        forget_state(&root, "a");
        before_launch(&root, &a, "a", "A", "1.21.4");
        assert!(a.join("resourcepacks/Neu.zip").exists());
        assert!(shared_dir(&root, "resourcepacks").join("Neu.zip").exists());
        std::fs::remove_dir_all(&root).ok();
    }
}
