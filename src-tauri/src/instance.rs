//! Instanzen: Modell + Speicher (`instances/<id>/instance.json`).
use crate::error::{AppError, AppResult};
use crate::events;
use crate::paths::Paths;
use crate::util::{now_ms, write_json_atomic};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::AppHandle;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum LoaderKind {
    Vanilla,
    Fabric,
    Quilt,
    Forge,
    Neoforge,
}

impl LoaderKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            LoaderKind::Vanilla => "vanilla",
            LoaderKind::Fabric => "fabric",
            LoaderKind::Quilt => "quilt",
            LoaderKind::Forge => "forge",
            LoaderKind::Neoforge => "neoforge",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s.to_ascii_lowercase().as_str() {
            "vanilla" | "minecraft" => LoaderKind::Vanilla,
            "fabric" | "fabric-loader" => LoaderKind::Fabric,
            "quilt" | "quilt-loader" => LoaderKind::Quilt,
            "forge" => LoaderKind::Forge,
            "neoforge" | "neo-forge" | "neoforged" => LoaderKind::Neoforge,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Loader {
    pub kind: LoaderKind,
    /// Loader-Version (z. B. "0.16.9" für Fabric, "21.1.77" für NeoForge). `None` bei Vanilla.
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct JavaOptions {
    /// Fester Java-Pfad für diese Instanz
    pub path: Option<String>,
    pub min_memory_mb: Option<u32>,
    pub max_memory_mb: Option<u32>,
    /// Zusätzliche JVM-Argumente (an die globalen angehängt)
    pub jvm_args: Option<String>,
    /// Umgebungsvariablen für den Spielprozess
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default)]
pub struct WindowOptions {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fullscreen: Option<bool>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PackSourceKind {
    Modrinth,
    Curseforge,
    Vlpack,
    Prism,
    Local,
}

/// Herkunft einer Modpack-Instanz (für Updates/Anzeige).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PackSource {
    pub kind: PackSourceKind,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub name: Option<String>,
    pub version_name: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum InstallState {
    /// Noch nie installiert / Version geändert
    #[default]
    NotInstalled,
    Installing,
    Installed,
    /// Letzte Installation fehlgeschlagen
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Instance {
    pub id: String,
    pub name: String,
    /// Pfad zu einer Bilddatei (absolut) oder eingebautes Icon "builtin:<name>"
    pub icon: Option<String>,
    /// Akzentfarbe als Hex (#rrggbb), optional
    pub accent: Option<String>,
    pub group: Option<String>,
    pub mc_version: String,
    pub loader: Loader,
    #[serde(default)]
    pub java: JavaOptions,
    #[serde(default)]
    pub window: WindowOptions,
    #[serde(default)]
    pub source: Option<PackSource>,
    #[serde(default)]
    pub install_state: InstallState,
    /// ID der Versions-JSON, mit der zuletzt erfolgreich installiert wurde (z. B. "fabric-loader-0.16.9-1.21.1")
    #[serde(default)]
    pub version_id: Option<String>,
    pub created_at: i64,
    #[serde(default)]
    pub last_played: Option<i64>,
    #[serde(default)]
    pub play_time_secs: u64,
    #[serde(default)]
    pub notes: Option<String>,
    /// Inhalte vor dem Start automatisch aktualisieren: `None` = globale Einstellung
    /// (bei Modpack-Instanzen dann aus), `Some(..)` = explizit für diese Instanz
    #[serde(default)]
    pub auto_update_content: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateInstance {
    pub name: String,
    pub mc_version: String,
    pub loader: Loader,
    pub icon: Option<String>,
    pub accent: Option<String>,
    pub group: Option<String>,
}

/// Teil-Update aus dem Frontend. Nur gesetzte Felder werden übernommen.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct InstancePatch {
    pub name: Option<String>,
    #[serde(deserialize_with = "double_option")]
    pub icon: Option<Option<String>>,
    #[serde(deserialize_with = "double_option")]
    pub accent: Option<Option<String>>,
    #[serde(deserialize_with = "double_option")]
    pub group: Option<Option<String>>,
    pub mc_version: Option<String>,
    pub loader: Option<Loader>,
    pub java: Option<JavaOptions>,
    pub window: Option<WindowOptions>,
    #[serde(deserialize_with = "double_option")]
    pub notes: Option<Option<String>>,
    #[serde(deserialize_with = "double_option")]
    pub auto_update_content: Option<Option<bool>>,
}

/// `null` -> `Some(None)` (Feld leeren), fehlendes Feld -> `None` (unverändert).
fn double_option<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::deserialize(d)?))
}

pub struct InstanceStore {
    paths: Paths,
    app: AppHandle,
    map: RwLock<HashMap<String, Instance>>,
}

fn slugify(name: &str) -> String {
    let mut s = String::new();
    let mut dash = false;
    for c in name.chars() {
        let c = match c {
            'ä' | 'Ä' => Some("ae"),
            'ö' | 'Ö' => Some("oe"),
            'ü' | 'Ü' => Some("ue"),
            'ß' => Some("ss"),
            _ => None,
        }
        .map(|r| r.to_string())
        .unwrap_or_else(|| c.to_ascii_lowercase().to_string());
        for ch in c.chars() {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' {
                s.push(ch);
                dash = false;
            } else if !dash && !s.is_empty() {
                s.push('-');
                dash = true;
            }
        }
    }
    let s = s.trim_matches(|c| c == '-' || c == '.').to_string();
    if s.is_empty() { "instance".into() } else { s.chars().take(48).collect() }
}

impl InstanceStore {
    pub fn load(paths: Paths, app: AppHandle) -> Arc<Self> {
        let mut map = HashMap::new();
        if let Ok(rd) = std::fs::read_dir(paths.instances()) {
            for e in rd.flatten() {
                let p = e.path().join("instance.json");
                match std::fs::read(&p).map(|b| serde_json::from_slice::<Instance>(&b)) {
                    Ok(Ok(mut inst)) => {
                        // Ordnername ist die Wahrheit
                        inst.id = e.file_name().to_string_lossy().to_string();
                        if inst.install_state == InstallState::Installing {
                            inst.install_state = InstallState::NotInstalled;
                        }
                        map.insert(inst.id.clone(), inst);
                    }
                    Ok(Err(err)) => tracing::warn!("Instanz {:?} unlesbar: {err}", p),
                    Err(_) => {}
                }
            }
        }
        Arc::new(InstanceStore { paths, app, map: RwLock::new(map) })
    }

    pub fn list(&self) -> Vec<Instance> {
        let mut v: Vec<Instance> = self.map.read().values().cloned().collect();
        v.sort_by(|a, b| b.last_played.unwrap_or(0).cmp(&a.last_played.unwrap_or(0)).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        v
    }

    pub fn get(&self, id: &str) -> AppResult<Instance> {
        self.map.read().get(id).cloned().ok_or_else(|| AppError::NotFound(format!("Instanz {id}")))
    }

    fn unique_id(&self, name: &str) -> String {
        let base = slugify(name);
        let map = self.map.read();
        let mut id = base.clone();
        let mut n = 2;
        while map.contains_key(&id) || self.paths.instance_dir(&id).exists() {
            id = format!("{base}-{n}");
            n += 1;
        }
        id
    }

    fn persist(&self, inst: &Instance) -> AppResult<()> {
        write_json_atomic(&self.paths.instance_json(&inst.id), inst)
    }

    pub fn create(&self, req: CreateInstance) -> AppResult<Instance> {
        let name = req.name.trim();
        if name.is_empty() {
            return Err(AppError::Invalid("Name darf nicht leer sein".into()));
        }
        if req.mc_version.trim().is_empty() {
            return Err(AppError::Invalid("Minecraft-Version fehlt".into()));
        }
        let id = self.unique_id(name);
        let inst = Instance {
            id: id.clone(),
            name: name.to_string(),
            icon: req.icon,
            accent: req.accent,
            group: req.group.filter(|g| !g.trim().is_empty()),
            mc_version: req.mc_version,
            loader: req.loader,
            java: Default::default(),
            window: Default::default(),
            source: None,
            install_state: InstallState::NotInstalled,
            version_id: None,
            created_at: now_ms(),
            last_played: None,
            play_time_secs: 0,
            notes: None,
            auto_update_content: None,
        };
        std::fs::create_dir_all(self.paths.game_dir(&id))?;
        self.persist(&inst)?;
        self.map.write().insert(id, inst.clone());
        events::emit(&self.app, events::INSTANCE_CHANGED, &inst);
        Ok(inst)
    }

    /// Beliebige Änderung an einer Instanz (persistiert + Event).
    pub fn modify<F: FnOnce(&mut Instance)>(&self, id: &str, f: F) -> AppResult<Instance> {
        let inst = {
            let mut map = self.map.write();
            let inst = map.get_mut(id).ok_or_else(|| AppError::NotFound(format!("Instanz {id}")))?;
            let before_version = (inst.mc_version.clone(), inst.loader.clone());
            f(inst);
            if (inst.mc_version.clone(), inst.loader.clone()) != before_version {
                inst.install_state = InstallState::NotInstalled;
                inst.version_id = None;
            }
            inst.clone()
        };
        self.persist(&inst)?;
        events::emit(&self.app, events::INSTANCE_CHANGED, &inst);
        Ok(inst)
    }

    pub fn patch(&self, id: &str, p: InstancePatch) -> AppResult<Instance> {
        if let Some(n) = &p.name {
            if n.trim().is_empty() {
                return Err(AppError::Invalid("Name darf nicht leer sein".into()));
            }
        }
        self.modify(id, |i| {
            if let Some(v) = p.name { i.name = v.trim().to_string(); }
            if let Some(v) = p.icon { i.icon = v; }
            if let Some(v) = p.accent { i.accent = v; }
            if let Some(v) = p.group { i.group = v.filter(|g| !g.trim().is_empty()); }
            if let Some(v) = p.mc_version { i.mc_version = v; }
            if let Some(v) = p.loader { i.loader = v; }
            if let Some(v) = p.java { i.java = v; }
            if let Some(v) = p.window { i.window = v; }
            if let Some(v) = p.notes { i.notes = v; }
            if let Some(v) = p.auto_update_content { i.auto_update_content = v; }
        })
    }

    /// Instanz mit vorgegebenem Inhalt registrieren (Import). Legt Ordner an.
    pub fn insert_new(&self, mut inst: Instance) -> AppResult<Instance> {
        inst.id = self.unique_id(&inst.name);
        std::fs::create_dir_all(self.paths.game_dir(&inst.id))?;
        self.persist(&inst)?;
        self.map.write().insert(inst.id.clone(), inst.clone());
        events::emit(&self.app, events::INSTANCE_CHANGED, &inst);
        Ok(inst)
    }

    /// Nur den Eintrag aus dem Speicher entfernen (z. B. wenn ein Import fehlschlägt).
    pub fn delete(&self, id: &str) -> AppResult<()> {
        self.map.write().remove(id);
        let dir = self.paths.instance_dir(id);
        if dir.exists() {
            std::fs::remove_dir_all(&dir)?;
        }
        events::emit(&self.app, events::INSTANCE_REMOVED, &serde_json::json!({ "id": id }));
        Ok(())
    }

    pub fn duplicate(&self, id: &str, name: Option<String>) -> AppResult<Instance> {
        let src = self.get(id)?;
        let name = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| format!("{} (Kopie)", src.name));
        let new_id = self.unique_id(&name);
        crate::util::copy_dir_all(&self.paths.instance_dir(id), &self.paths.instance_dir(&new_id))?;
        let mut inst = src.clone();
        inst.id = new_id.clone();
        inst.name = name;
        inst.created_at = now_ms();
        inst.last_played = None;
        inst.play_time_secs = 0;
        // Icon mitkopiert? Pfad auf neue Instanz umbiegen
        if let Some(icon) = &src.icon {
            let old_dir = self.paths.instance_dir(id);
            if let Ok(rel) = std::path::Path::new(icon).strip_prefix(&old_dir) {
                inst.icon = Some(self.paths.instance_dir(&new_id).join(rel).to_string_lossy().to_string());
            }
        }
        self.persist(&inst)?;
        self.map.write().insert(new_id, inst.clone());
        events::emit(&self.app, events::INSTANCE_CHANGED, &inst);
        Ok(inst)
    }

    /// Icon-Datei in den Instanzordner kopieren und setzen.
    pub fn set_icon_from_file(&self, id: &str, src: &std::path::Path) -> AppResult<Instance> {
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("png").to_ascii_lowercase();
        if !["png", "jpg", "jpeg", "webp", "gif"].contains(&ext.as_str()) {
            return Err(AppError::Invalid("Nur PNG, JPG, WEBP oder GIF".into()));
        }
        let dest = self.paths.instance_dir(id).join(format!("icon.{ext}"));
        std::fs::copy(src, &dest)?;
        let dest_s = dest.to_string_lossy().to_string();
        self.modify(id, |i| i.icon = Some(dest_s))
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn patch_null_clears() {
        let p: super::InstancePatch = serde_json::from_str(r#"{"accent":null,"auto_update_content":true}"#).unwrap();
        assert_eq!(p.accent, Some(None));
        assert_eq!(p.auto_update_content, Some(Some(true)));
        assert_eq!(p.group, None);
    }

    #[test]
    fn slug() {
        assert_eq!(super::slugify("Mein Tolles Pack!"), "mein-tolles-pack");
        assert_eq!(super::slugify("Größe 1.21"), "groesse-1.21");
        assert_eq!(super::slugify("///"), "instance");
    }
}
