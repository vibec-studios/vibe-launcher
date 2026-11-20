//! Verzeichnisstruktur des Launchers.
//!
//! ```text
//! <data>/VibeLauncher/
//!   settings.json, accounts.json, launcher.log
//!   instances/<id>/instance.json        Instanz-Metadaten
//!   instances/<id>/minecraft/           Spielordner (mods, config, saves, logs, ...)
//!   meta/versions/<id>/<id>.json|.jar   Versions-JSONs (Vanilla + Loader-Profile)
//!   meta/libraries/                     Maven-Layout
//!   meta/assets/{indexes,objects,virtual}
//!   meta/natives/<version-id>/          entpackte Natives
//!   java/<component>/                   heruntergeladene Java-Runtimes
//!   cache/                              Icons, API-Antworten, temporäre Downloads
//! ```
pub mod location;

use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Paths {
    pub root: PathBuf,
}

impl Default for Paths {
    fn default() -> Self {
        Self::new()
    }
}

impl Paths {
    pub fn new() -> Self {
        Paths { root: location::resolve(location::env_override(), &location::default_root()) }
    }

    pub fn ensure(&self) -> std::io::Result<()> {
        for d in [
            self.instances(),
            self.versions(),
            self.libraries(),
            self.assets(),
            self.natives_root(),
            self.java_root(),
            self.cache(),
            self.tmp(),
        ] {
            std::fs::create_dir_all(d)?;
        }
        Ok(())
    }

    pub fn settings_file(&self) -> PathBuf { self.root.join("settings.json") }
    pub fn accounts_file(&self) -> PathBuf { self.root.join("accounts.json") }
    pub fn launcher_logs(&self) -> PathBuf { self.root.join("logs") }

    pub fn instances(&self) -> PathBuf { self.root.join("instances") }
    pub fn instance_dir(&self, id: &str) -> PathBuf { self.instances().join(id) }
    pub fn instance_json(&self, id: &str) -> PathBuf { self.instance_dir(id).join("instance.json") }
    /// Der eigentliche `.minecraft`-Ordner der Instanz (`--gameDir`).
    pub fn game_dir(&self, id: &str) -> PathBuf { self.instance_dir(id).join("minecraft") }

    pub fn meta(&self) -> PathBuf { self.root.join("meta") }
    pub fn versions(&self) -> PathBuf { self.meta().join("versions") }
    pub fn version_dir(&self, id: &str) -> PathBuf { self.versions().join(id) }
    pub fn version_json(&self, id: &str) -> PathBuf { self.version_dir(id).join(format!("{id}.json")) }
    pub fn version_jar(&self, id: &str) -> PathBuf { self.version_dir(id).join(format!("{id}.jar")) }
    pub fn libraries(&self) -> PathBuf { self.meta().join("libraries") }
    pub fn assets(&self) -> PathBuf { self.meta().join("assets") }
    pub fn natives_root(&self) -> PathBuf { self.meta().join("natives") }
    pub fn natives_dir(&self, version_id: &str) -> PathBuf { self.natives_root().join(version_id) }

    pub fn java_root(&self) -> PathBuf { self.root.join("java") }
    pub fn cache(&self) -> PathBuf { self.root.join("cache") }
    pub fn tmp(&self) -> PathBuf { self.cache().join("tmp") }
}

/// Maven-Koordinate `group:artifact:version[:classifier][@ext]` -> relativer Pfad.
pub fn maven_path(coord: &str) -> Option<PathBuf> {
    let (coord, ext) = match coord.split_once('@') {
        Some((c, e)) => (c, e),
        None => (coord, "jar"),
    };
    let parts: Vec<&str> = coord.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let file = if parts.len() >= 4 {
        format!("{artifact}-{version}-{}.{ext}", parts[3])
    } else {
        format!("{artifact}-{version}.{ext}")
    };
    Some(Path::new(&group).join(artifact).join(version).join(file))
}

/// Datei-/Ordnernamen bereinigen (für Instanznamen -> Ordner, Exporte usw.).
pub fn sanitize_file_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let s = s.trim().trim_end_matches('.').to_string();
    if s.is_empty() { "unnamed".into() } else { s }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maven() {
        assert_eq!(
            maven_path("net.fabricmc:fabric-loader:0.16.9").unwrap(),
            Path::new("net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar")
        );
        assert_eq!(
            maven_path("org.lwjgl:lwjgl:3.3.3:natives-windows").unwrap(),
            Path::new("org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar")
        );
        assert_eq!(
            maven_path("de.oceanlabs.mcp:mcp_config:1.20.1@zip").unwrap(),
            Path::new("de/oceanlabs/mcp/mcp_config/1.20.1/mcp_config-1.20.1.zip")
        );
    }
}
