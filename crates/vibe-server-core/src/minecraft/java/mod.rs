//! Java: Erkennung (System + verwaltet), Prüfung, Download (Mojang-Runtimes, Fallback Adoptium), Auswahl.
use super::JavaInstall;
use crate::error::{AppError, AppResult, Ctx};
use crate::net::DownloadItem;
use crate::Core;
use crate::tasks::SubProgress;
use parking_lot::Mutex;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

mod discover;
pub use discover::*;
mod mojang;
pub use mojang::*;
mod adoptium;
pub use adoptium::*;
mod probe;
pub use probe::*;

const RUNTIMES_URL: &str = "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
const MARKER: &str = ".vibe-runtime.json";

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn exe(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

/// Zu einem `bin`-Ordner das Startprogramm fürs Spiel (Windows: javaw.exe).
fn launcher_exe(bin: &Path) -> Option<PathBuf> {
    if cfg!(windows) {
        let w = bin.join("javaw.exe");
        if w.is_file() {
            return Some(w);
        }
    }
    let j = bin.join(exe("java"));
    j.is_file().then_some(j)
}

/// Konsolen-java (für Versionsprüfung und Forge-Processors).
pub fn console_java(path: &Path) -> PathBuf {
    if cfg!(windows) {
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.eq_ignore_ascii_case("javaw.exe") {
                let j = path.with_file_name("java.exe");
                if j.is_file() {
                    return j;
                }
            }
        }
    }
    path.to_path_buf()
}

/// Pfadangabe des Nutzers (Datei oder Ordner/JAVA_HOME) zu java(w) auflösen.
pub fn normalize_java_path(p: &Path) -> Option<PathBuf> {
    if p.is_file() {
        return Some(p.to_path_buf());
    }
    if p.is_dir() {
        if let Some(e) = launcher_exe(&p.join("bin")) {
            return Some(e);
        }
        if let Some(e) = launcher_exe(p) {
            return Some(e);
        }
        // macOS-Bundles
        if let Some(e) = launcher_exe(&p.join("Contents/Home/bin")) {
            return Some(e);
        }
    }
    None
}

pub fn parse_major(version: &str) -> u32 {
    let v = version.trim();
    if let Some(rest) = v.strip_prefix("1.") {
        return rest.split(|c: char| !c.is_ascii_digit()).next().and_then(|s| s.parse().ok()).unwrap_or(0);
    }
    v.split(|c: char| !c.is_ascii_digit()).next().and_then(|s| s.parse().ok()).unwrap_or(0)
}

fn norm_arch(a: &str) -> String {
    match a.trim() {
        "amd64" | "x86_64" | "x64" => "x64".into(),
        "x86" | "i386" | "i486" | "i586" | "i686" => "x86".into(),
        "aarch64" | "arm64" => "aarch64".into(),
        o => o.to_string(),
    }
}

/// Ausgabe von `java -XshowSettings:properties -version` auswerten.
pub fn parse_properties(out: &str) -> Option<(String, Option<String>, String)> {
    let mut version = None;
    let mut vendor = None;
    let mut arch = None;
    for line in out.lines() {
        let l = line.trim();
        if let Some((k, v)) = l.split_once(" = ") {
            match k.trim() {
                "java.version" => version = Some(v.trim().to_string()),
                "java.vendor" => vendor = Some(v.trim().to_string()),
                "os.arch" => arch = Some(norm_arch(v)),
                _ => {}
            }
        }
    }
    if version.is_none() {
        // Fallback: `openjdk version "21.0.5" 2024-10-15`
        let re = regex::Regex::new(r#"version "([^"]+)""#).ok()?;
        version = re.captures(out).map(|c| c[1].to_string());
    }
    Some((version?, vendor, arch.unwrap_or_else(|| "x64".into())))
}

// ------------------------------------------------------------------ Auswahl

/// Java mit optionalem festem Pfad bestimmen (Instanz-Override bzw. Server) (z. B. für lokale Server).
pub async fn resolve_with(
    state: &Core,
    fixed_path: Option<&str>,
    major: u32,
    component: Option<&str>,
    force: bool,
    sp: &SubProgress,
) -> AppResult<JavaInstall> {
    if let Some(p) = fixed_path.filter(|p| !p.trim().is_empty()) {
        let path = normalize_java_path(Path::new(p.trim()))
            .ok_or_else(|| AppError::msg(format!("Der eingestellte Java-Pfad existiert nicht: {p}")))?;
        return probe(&path, false).await;
    }
    let settings = state.host.java_prefs();
    if let Some(p) = settings.overrides.get(&major.to_string()).filter(|p| !p.trim().is_empty()) {
        let path = normalize_java_path(Path::new(p.trim()))
            .ok_or_else(|| AppError::msg(format!("Der eingestellte Pfad für Java {major} existiert nicht: {p}")))?;
        return probe(&path, false).await;
    }
    let java_root = state.paths.java_root();
    let managed = managed_runtimes(&java_root);
    // genau passende Mojang-Komponente
    if let Some(c) = component {
        if let Some((_, p)) = managed.iter().find(|(n, _)| n == c) {
            if force && settings.auto_java {
                let p = install_mojang_component(state, c, true, Some(sp)).await?;
                return probe(&p, true).await;
            }
            if let Ok(j) = probe(p, true).await {
                return Ok(j);
            }
        }
    }
    for (_, p) in &managed {
        if let Ok(j) = probe(p, true).await {
            if j.major == major {
                return Ok(j);
            }
        }
    }
    if settings.auto_java {
        let path = match component {
            Some(c) => match install_mojang_component(state, c, false, Some(sp)).await {
                Ok(p) => p,
                Err(AppError::Cancelled) => return Err(AppError::Cancelled),
                Err(e) => {
                    tracing::warn!("Java-Komponente {c} nicht installierbar: {e}");
                    install_major(state, major, Some(sp)).await?
                }
            },
            None => install_major(state, major, Some(sp)).await?,
        };
        return probe(&path, true).await;
    }
    let all = list(state).await;
    if let Some(j) = all.into_iter().find(|j| j.major == major) {
        return Ok(j);
    }
    Err(AppError::msg(format!(
        "Java {major} wird für diese Minecraft-Version benötigt, wurde aber nicht gefunden. \
         Installiere Java {major} in den Einstellungen oder aktiviere den automatischen Java-Download."
    )))
}

#[cfg(test)]
mod tests;
