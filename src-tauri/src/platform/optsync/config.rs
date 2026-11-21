use super::*;

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
    pub(super) fn option_categories(&self) -> Vec<String> {
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
    pub(super) keybinds_separate: bool,
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
