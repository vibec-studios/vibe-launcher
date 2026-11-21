#[cfg(windows)]
mod win;

use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct SchemeStatus {
    pub supported: bool,
    pub enabled: bool,
    pub other: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Backup {
    pub default: Option<String>,
    pub icon: Option<String>,
    pub command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct Saved {
    previous: Option<Backup>,
    enabled_at: i64,
}

fn saved_path(root: &Path) -> PathBuf {
    root.join("modrinth-links.json")
}

fn load_saved(root: &Path) -> Option<Saved> {
    std::fs::read(saved_path(root)).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

pub fn test_mode() -> bool {
    cfg!(debug_assertions) || std::env::var_os("VIBE_LAUNCHER_HOME").is_some()
}

pub fn command_for(exe: &str) -> String {
    format!("\"{exe}\" \"%1\"")
}

pub fn exe_of(command: &str) -> Option<String> {
    let c = command.trim();
    let exe = match c.strip_prefix('"') {
        Some(rest) => rest.split('"').next()?.to_string(),
        None => c.split_whitespace().next()?.to_string(),
    };
    (!exe.is_empty()).then_some(exe)
}

pub fn handler_name(command: &str) -> Option<String> {
    let exe = exe_of(command)?;
    let name = exe.rsplit(['\\', '/']).next().unwrap_or(&exe);
    let stem = name.rsplit_once('.').map(|(s, _)| s).unwrap_or(name);
    (!stem.is_empty()).then(|| stem.to_string())
}

fn same_exe(a: &str, b: &str) -> bool {
    a.trim_start_matches(r"\\?\").eq_ignore_ascii_case(b.trim_start_matches(r"\\?\"))
}

fn file_name(p: &str) -> String {
    p.rsplit(['\\', '/']).next().unwrap_or(p).to_ascii_lowercase()
}

pub fn evaluate(current: Option<&str>, me: Option<&str>) -> SchemeStatus {
    let enabled = match (current.and_then(exe_of), me) {
        (Some(c), Some(m)) => same_exe(&c, m),
        _ => false,
    };
    SchemeStatus { supported: true, enabled, other: if enabled { None } else { current.and_then(handler_name) } }
}

#[cfg(windows)]
fn me() -> Option<String> {
    let p = std::env::current_exe().ok()?;
    let s = p.display().to_string();
    Some(s.strip_prefix(r"\\?\").unwrap_or(&s).to_string())
}

#[cfg(windows)]
pub fn status() -> SchemeStatus {
    evaluate(win::current_command().as_deref(), me().as_deref())
}

#[cfg(not(windows))]
pub fn status() -> SchemeStatus {
    SchemeStatus { supported: false, enabled: false, other: None }
}

#[cfg(windows)]
pub fn set(root: &Path, enabled: bool) -> AppResult<SchemeStatus> {
    let exe = me().ok_or_else(|| crate::error::AppError::msg("Programmpfad nicht ermittelbar"))?;
    let now = status();
    if enabled && !now.enabled {
        let saved = Saved { previous: win::read_user(), enabled_at: crate::util::now_ms() };
        crate::util::write_json_atomic(&saved_path(root), &saved)?;
        win::write(&exe)?;
    }
    if !enabled {
        if now.enabled {
            match load_saved(root).and_then(|s| s.previous).filter(|b| b.command.as_deref().and_then(exe_of).is_none_or(|e| !same_exe(&e, &exe))) {
                Some(b) => win::restore(&b)?,
                None => win::delete_tree()?,
            }
        }
        let _ = std::fs::remove_file(saved_path(root));
    }
    Ok(status())
}

#[cfg(not(windows))]
pub fn set(_root: &Path, _enabled: bool) -> AppResult<SchemeStatus> {
    Err(crate::error::AppError::Invalid("Auf diesem System nicht verfügbar".into()))
}

#[cfg(windows)]
pub fn on_startup(root: &Path) {
    if test_mode() || load_saved(root).is_none() {
        return;
    }
    let (Some(cur), Some(exe)) = (win::current_command().as_deref().and_then(exe_of), me()) else { return };
    if !same_exe(&cur, &exe) && file_name(&cur) == file_name(&exe) {
        if let Err(e) = win::write(&exe) {
            tracing::warn!("modrinth://-Registrierung nicht erneuert: {e}");
        }
    }
}

#[cfg(not(windows))]
pub fn on_startup(_root: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands() {
        assert_eq!(exe_of(r#""C:\Program Files\Modrinth App\Modrinth App.exe" "%1""#).as_deref(), Some(r"C:\Program Files\Modrinth App\Modrinth App.exe"));
        assert_eq!(exe_of(r"C:\x\app.exe %1").as_deref(), Some(r"C:\x\app.exe"));
        assert_eq!(handler_name(r#""C:\Program Files\Modrinth App\Modrinth App.exe" "%1""#).as_deref(), Some("Modrinth App"));
        assert_eq!(command_for(r"C:\v\vibe.exe"), r#""C:\v\vibe.exe" "%1""#);
    }

    #[test]
    fn evaluate_status() {
        let me = r"C:\Users\a\AppData\Local\Vibe Launcher\vibe-launcher.exe";
        let ours = command_for(me);
        assert!(evaluate(Some(&ours), Some(me)).enabled);
        let other = evaluate(Some(r#""C:\M\Modrinth App.exe" "%1""#), Some(me));
        assert!(!other.enabled);
        assert_eq!(other.other.as_deref(), Some("Modrinth App"));
        let none = evaluate(None, Some(me));
        assert!(!none.enabled && none.other.is_none());
        assert_eq!(file_name(r"D:\Old\vibe-launcher.exe"), file_name(me));
    }
}
