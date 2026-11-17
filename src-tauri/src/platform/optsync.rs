//! Optionen synchronisieren: ausgewählte Bereiche aus `options.txt` (Steuerung, Sound, Grafik, Sprache,
//! Zugänglichkeit) zwischen Instanzen gleich halten. Ein globales „Master-Profil“ (`options-sync.json`) wird
//! vor jedem Start in die Instanz geschrieben und nach dem Beenden aus ihr übernommen.
//! Es werden nur bekannte Schlüssel angefasst; Tastenbelegungen nur bei passendem Format (ab 1.13 „key.…“).
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const CATEGORIES: [&str; 5] = ["controls", "sound", "video", "language", "accessibility"];

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

/// Kategorie eines Schlüssels (None = wird nie synchronisiert).
pub fn category_of(key: &str) -> Option<&'static str> {
    if key.starts_with("key_") {
        return Some("controls");
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
    pub categories: Vec<String>,
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
}

impl SyncConfig {
    pub fn load(path: &Path) -> SyncConfig {
        std::fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
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

/// Neues Format der Tastenbelegung (ab 1.13: „key.keyboard.w“) vs. alt (Zahlencodes)?
fn modern_keys(opts: &[(String, String)]) -> Option<bool> {
    opts.iter()
        .find(|(k, _)| k.starts_with("key_"))
        .map(|(_, v)| v.starts_with("key.") || v == "unknown")
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
        if k.starts_with("key_") && (v.starts_with("key.") || v == "unknown") != target_modern_keys
        {
            continue;
        }
        match opts.iter_mut().find(|(ok, _)| ok == k) {
            Some(e) => e.1 = v.clone(),
            None => opts.push((k.clone(), v.clone())),
        }
    }
    let mut s = String::new();
    for (k, v) in opts {
        s.push_str(&k);
        s.push(':');
        s.push_str(&v);
        s.push('\n');
    }
    s
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

/// Vor dem Start: Master-Profil in die Instanz schreiben (falls aktiviert). Gibt die Zahl der Schlüssel zurück.
pub fn apply(
    root: &Path,
    game_dir: &Path,
    instance_id: &str,
    mc_version: &str,
) -> AppResult<usize> {
    let cfg = SyncConfig::load(&config_path(root));
    let inst = cfg.for_instance(instance_id);
    if !inst.enabled || cfg.master.is_empty() || inst.categories.is_empty() {
        return Ok(0);
    }
    let path = game_dir.join("options.txt");
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let modern = modern_keys(&parse_options(&existing)).unwrap_or_else(|| !is_pre_113(mc_version));
    let merged = merge_into(&existing, &cfg.master, &inst.categories, modern);
    std::fs::create_dir_all(game_dir)?;
    std::fs::write(&path, merged)?;
    Ok(cfg
        .master
        .keys()
        .filter(|k| category_of(k).is_some_and(|c| inst.categories.iter().any(|x| x == c)))
        .count())
}

/// Nach dem Beenden: Änderungen aus dem Spiel zurück ins Master-Profil holen.
pub fn pull(root: &Path, game_dir: &Path, instance_id: &str) -> AppResult<usize> {
    let p = config_path(root);
    let mut cfg = SyncConfig::load(&p);
    let inst = cfg.for_instance(instance_id);
    if !inst.enabled || inst.categories.is_empty() {
        return Ok(0);
    }
    let Ok(text) = std::fs::read_to_string(game_dir.join("options.txt")) else {
        return Ok(0);
    };
    let n = capture(&text, &mut cfg.master, &inst.categories);
    cfg.source = Some(instance_id.to_string());
    cfg.updated_at = Some(chrono::Utc::now().timestamp_millis());
    cfg.save(&p)?;
    Ok(n)
}

fn is_pre_113(mc: &str) -> bool {
    let mut it = mc.split('.');
    match (it.next(), it.next()) {
        (Some("1"), Some(m)) => m.parse::<u32>().map(|m| m < 13).unwrap_or(false),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categories() {
        assert_eq!(category_of("key_key.forward"), Some("controls"));
        assert_eq!(category_of("soundCategory_music"), Some("sound"));
        assert_eq!(category_of("renderDistance"), Some("video"));
        assert_eq!(category_of("lang"), Some("language"));
        assert_eq!(category_of("version"), None);
        assert_eq!(category_of("resourcePacks"), None);
        assert_eq!(category_of("lastServer"), None);
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
            &["language".into(), "controls".into(), "sound".into()],
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
            &["controls".into()],
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
    fn apply_and_pull_roundtrip() {
        let root = std::env::temp_dir().join(format!("vl-optsync-{}", std::process::id()));
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
        assert_eq!(pull(&root, &game, "a").unwrap(), 1);
        let back = SyncConfig::load(&config_path(&root));
        assert_eq!(back.master.get("fov").map(String::as_str), Some("0.3"));
        assert!(!back.master.contains_key("lang"));
        assert_eq!(apply(&root, &game, "b", "1.21.4").unwrap(), 0);
        std::fs::remove_dir_all(&root).ok();
    }
}
