use super::*;

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
    pub(super) fn id_of_file(&self, file: &str) -> Option<&str> {
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
pub(super) struct JarInfo {
    pub(super) ids: Vec<(String, Option<String>, Option<String>)>,
    pub(super) mixins: Vec<String>,
    pub(super) packages: Vec<String>,
}

pub(super) fn read_entry(z: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Option<String> {
    let mut e = z.by_name(name).ok()?;
    if e.size() > 4 << 20 {
        return None;
    }
    let mut s = String::new();
    std::io::Read::read_to_string(&mut e, &mut s).ok()?;
    Some(s)
}

pub(super) fn read_jar(jar: &Path) -> JarInfo {
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
