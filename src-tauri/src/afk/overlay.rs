use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const BACKUP_FILE: &str = "afk-options-backup.json";

pub const NO_PAUSE: &[(&str, &str)] = &[("pauseOnLostFocus", "false")];

pub const OVERLAY: &[(&str, &str)] = &[
    ("maxFps", "10"),
    ("enableVsync", "false"),
    ("renderDistance", "2"),
    ("simulationDistance", "5"),
    ("soundCategory_master", "0.0"),
    ("particles", "2"),
    ("pauseOnLostFocus", "false"),
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Backup {
    pub schema: u32,
    pub created_at: i64,
    pub run_id: String,
    pub original: BTreeMap<String, Option<String>>,
    pub applied: BTreeMap<String, String>,
}

struct Lines {
    lines: Vec<String>,
    crlf: bool,
    trailing: bool,
}

impl Lines {
    fn parse(text: &str) -> Self {
        let crlf = text.contains("\r\n");
        let trailing = text.is_empty() || text.ends_with('\n');
        let lines = text.lines().map(str::to_string).collect();
        Lines { lines, crlf, trailing }
    }
    fn render(&self) -> String {
        let nl = if self.crlf { "\r\n" } else { "\n" };
        let mut s = self.lines.join(nl);
        if self.trailing && !self.lines.is_empty() {
            s.push_str(nl);
        }
        s
    }
    fn get(&self, key: &str) -> Option<String> {
        self.lines.iter().find_map(|l| l.split_once(':').filter(|(k, _)| *k == key).map(|(_, v)| v.to_string()))
    }
    fn set(&mut self, key: &str, value: Option<&str>) {
        let pos = self.lines.iter().position(|l| l.split_once(':').is_some_and(|(k, _)| k == key));
        match (pos, value) {
            (Some(i), Some(v)) => self.lines[i] = format!("{key}:{v}"),
            (Some(i), None) => {
                self.lines.remove(i);
            }
            (None, Some(v)) => self.lines.push(format!("{key}:{v}")),
            (None, None) => {}
        }
    }
}

pub fn apply_text(text: &str, run_id: &str, now: i64, keys: &[(&str, &str)]) -> (String, Backup) {
    let mut doc = Lines::parse(text);
    let mut original = BTreeMap::new();
    let mut applied = BTreeMap::new();
    for (k, v) in keys {
        original.insert(k.to_string(), doc.get(k));
        applied.insert(k.to_string(), v.to_string());
        doc.set(k, Some(v));
    }
    doc.trailing = true;
    (doc.render(), Backup { schema: 1, created_at: now, run_id: run_id.to_string(), original, applied })
}

pub fn restore_text(text: &str, backup: &Backup) -> String {
    let mut doc = Lines::parse(text);
    for (k, applied) in &backup.applied {
        let current = doc.get(k);
        if current.as_deref().is_some_and(|c| c != applied) {
            continue;
        }
        let original = backup.original.get(k).cloned().flatten();
        doc.set(k, original.as_deref());
    }
    doc.render()
}

fn options(game_dir: &Path) -> PathBuf {
    game_dir.join("options.txt")
}

pub fn backup_path(game_dir: &Path) -> PathBuf {
    game_dir.join(".vibe").join(BACKUP_FILE)
}

pub fn pending(game_dir: &Path) -> bool {
    backup_path(game_dir).exists()
}

fn write_atomic(path: &Path, text: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("txt.vibe-tmp");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)
}

pub fn apply(game_dir: &Path, run_id: &str, keys: &[(&str, &str)]) -> std::io::Result<bool> {
    if pending(game_dir) {
        return Ok(false);
    }
    let file = options(game_dir);
    let text = match std::fs::read_to_string(&file) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e),
    };
    let (next, backup) = apply_text(&text, run_id, crate::util::now_ms(), keys);
    crate::util::write_json_atomic(&backup_path(game_dir), &backup).map_err(std::io::Error::other)?;
    std::fs::create_dir_all(game_dir)?;
    if let Err(e) = write_atomic(&file, &next) {
        let _ = std::fs::remove_file(backup_path(game_dir));
        return Err(e);
    }
    Ok(true)
}

pub fn restore(game_dir: &Path) -> std::io::Result<bool> {
    let bp = backup_path(game_dir);
    let raw = match std::fs::read_to_string(&bp) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e),
    };
    let Ok(backup) = serde_json::from_str::<Backup>(&raw) else {
        std::fs::remove_file(&bp)?;
        return Ok(false);
    };
    let file = options(game_dir);
    let text = std::fs::read_to_string(&file).unwrap_or_default();
    write_atomic(&file, &restore_text(&text, &backup))?;
    std::fs::remove_file(&bp)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::testdir::TestDir;

    const SAMPLE: &str = "version:3953\nmaxFps:144\nrenderDistance:16\nsoundCategory_master:0.75\nlang:de_de\nresourcePacks:[\"vanilla\"]\n";

    #[test]
    fn apply_then_restore_is_exact() {
        let (over, backup) = apply_text(SAMPLE, "run-1", 1, OVERLAY);
        assert!(over.contains("maxFps:10\n"));
        assert!(over.contains("renderDistance:2\n"));
        assert!(over.contains("pauseOnLostFocus:false\n"));
        assert!(over.contains("lang:de_de\n"));
        assert_eq!(backup.original["maxFps"].as_deref(), Some("144"));
        assert_eq!(backup.original["pauseOnLostFocus"], None);
        assert_eq!(restore_text(&over, &backup), SAMPLE);
    }

    #[test]
    fn restore_keeps_values_changed_in_game() {
        let (over, backup) = apply_text(SAMPLE, "run-1", 1, OVERLAY);
        let changed = over.replace("renderDistance:2", "renderDistance:8").replace("lang:de_de", "lang:en_us");
        let back = restore_text(&changed, &backup);
        assert!(back.contains("renderDistance:8"));
        assert!(back.contains("maxFps:144"));
        assert!(back.contains("lang:en_us"));
        assert!(!back.contains("pauseOnLostFocus"));
    }

    #[test]
    fn restore_after_game_rewrote_file_in_other_order() {
        let (_, backup) = apply_text(SAMPLE, "run-1", 1, OVERLAY);
        let rewritten = "version:3953\npauseOnLostFocus:false\nparticles:2\nsimulationDistance:5\nenableVsync:false\nmaxFps:10\nrenderDistance:2\nsoundCategory_master:0.0\nlang:de_de\nresourcePacks:[\"vanilla\"]\n";
        let back = restore_text(rewritten, &backup);
        assert_eq!(back, "version:3953\nmaxFps:144\nrenderDistance:16\nsoundCategory_master:0.75\nlang:de_de\nresourcePacks:[\"vanilla\"]\n");
    }

    #[test]
    fn crlf_and_missing_file() {
        let crlf = SAMPLE.replace('\n', "\r\n");
        let (over, backup) = apply_text(&crlf, "r", 1, OVERLAY);
        assert!(over.contains("maxFps:10\r\n"));
        assert_eq!(restore_text(&over, &backup), crlf);
        let (fresh, b2) = apply_text("", "r", 1, OVERLAY);
        assert!(fresh.starts_with("maxFps:10\n"));
        assert_eq!(restore_text(&fresh, &b2), "");
    }

    #[test]
    fn files_survive_crash_and_apply_once() {
        let dir = TestDir::new("afk-ov");
        let game = dir.path();
        std::fs::write(game.join("options.txt"), SAMPLE).unwrap();
        assert!(apply(game, "run-1", OVERLAY).unwrap());
        assert!(pending(game));
        assert!(!apply(game, "run-2", NO_PAUSE).unwrap());
        let mid = std::fs::read_to_string(game.join("options.txt")).unwrap();
        assert!(mid.contains("maxFps:10"));
        assert!(restore(game).unwrap());
        assert!(!pending(game));
        assert_eq!(std::fs::read_to_string(game.join("options.txt")).unwrap(), SAMPLE);
        assert!(!restore(game).unwrap());
    }

    #[test]
    fn pause_only_touches_one_key() {
        let (over, backup) = apply_text("pauseOnLostFocus:true
maxFps:144
", "r", 1, NO_PAUSE);
        assert_eq!(over, "pauseOnLostFocus:false
maxFps:144
");
        assert_eq!(backup.applied.len(), 1);
        assert_eq!(restore_text(&over, &backup), "pauseOnLostFocus:true
maxFps:144
");
    }

    #[test]
    fn broken_backup_is_dropped() {
        let dir = TestDir::new("afk-ov2");
        let game = dir.path();
        std::fs::create_dir_all(game.join(".vibe")).unwrap();
        std::fs::write(backup_path(game), "{nope").unwrap();
        std::fs::write(game.join("options.txt"), SAMPLE).unwrap();
        assert!(!restore(game).unwrap());
        assert!(!pending(game));
        assert_eq!(std::fs::read_to_string(game.join("options.txt")).unwrap(), SAMPLE);
    }
}
