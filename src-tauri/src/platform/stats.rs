//! Spielzeit-Statistik: jede Sitzung (Start/Ende, Welt/Server) als Zeile in `sessions.jsonl`.
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Session {
    pub instance_id: String,
    /// ms seit 1970
    pub start: i64,
    pub end: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub world: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server: Option<String>,
}

pub fn path(root: &Path) -> PathBuf {
    root.join("sessions.jsonl")
}

pub fn append(root: &Path, s: &Session) -> AppResult<()> {
    if s.end <= s.start {
        return Ok(());
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path(root))?;
    writeln!(f, "{}", serde_json::to_string(s)?)?;
    Ok(())
}

/// Alle Sitzungen ab `since` (ms). Kaputte Zeilen werden übersprungen.
pub fn read(root: &Path, since: Option<i64>) -> Vec<Session> {
    let Ok(text) = std::fs::read_to_string(path(root)) else {
        return vec![];
    };
    text.lines()
        .filter_map(|l| serde_json::from_str::<Session>(l).ok())
        .filter(|s| since.map_or(true, |t| s.end >= t))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_and_read() {
        let root = std::env::temp_dir().join(format!("vl-stats-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let _ = std::fs::remove_file(path(&root));
        append(
            &root,
            &Session {
                instance_id: "a".into(),
                start: 1000,
                end: 5000,
                world: Some("Welt".into()),
                server: None,
            },
        )
        .unwrap();
        append(
            &root,
            &Session {
                instance_id: "b".into(),
                start: 9000,
                end: 9000,
                world: None,
                server: None,
            },
        )
        .unwrap(); // leer -> ignoriert
        std::fs::OpenOptions::new()
            .append(true)
            .open(path(&root))
            .unwrap()
            .write_all(b"kaputt\n")
            .unwrap();
        append(
            &root,
            &Session {
                instance_id: "b".into(),
                start: 10_000,
                end: 20_000,
                world: None,
                server: Some("mc.example.net".into()),
            },
        )
        .unwrap();
        let all = read(&root, None);
        assert_eq!(all.len(), 2);
        assert_eq!(all[1].server.as_deref(), Some("mc.example.net"));
        assert_eq!(read(&root, Some(6000)).len(), 1);
        std::fs::remove_dir_all(&root).ok();
    }
}
