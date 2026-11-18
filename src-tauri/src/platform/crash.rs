//! Crash-Analyse: regelbasiertes Auswerten von Crash-Reports und Logs.
//! Ergebnis sind „Diagnosen“ mit Schuldigem (Mod), Klartext-Erklärung und vorgeschlagenen Aktionen.
use regex::Regex;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Culprit {
    pub mod_id: Option<String>,
    pub name: Option<String>,
    /// Dateiname im mods-Ordner, falls zugeordnet
    pub file: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Action {
    /// Mod-Datei deaktivieren
    DisableMod { file: String },
    /// Deaktivierte Abhängigkeit (`.jar.disabled`) wieder aktivieren
    EnableMod { file: String, name: Option<String> },
    /// Abhängigkeit installieren (Modrinth-Slug/ID bzw. Mod-ID)
    InstallDependency {
        mod_id: String,
        name: Option<String>,
    },
    /// Java-Hauptversion verwenden
    SetJava { major: u32 },
    /// Arbeitsspeicher erhöhen (Vorschlag in MB)
    IncreaseRam { suggest_mb: u32 },
    /// Grafiktreiber aktualisieren (nur Hinweis + Link)
    UpdateDrivers,
    /// Log/Report zu mclo.gs hochladen
    Upload,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Diagnosis {
    /// Stabile Kennung der Regel: missing_dependency, wrong_minecraft, mixin, java_version, out_of_memory,
    /// heap_reserve, duplicate_mod, graphics, suspected_mod, exit_code, unknown
    pub id: String,
    /// 0–100: wie sicher die Regel ist (zum Sortieren)
    pub confidence: u8,
    pub culprit: Option<Culprit>,
    /// Kurze Parameter für die Klartext-Texte im Frontend (z. B. benötigte Version)
    pub params: BTreeMap<String, String>,
    pub actions: Vec<Action>,
    /// Gefundene Fundstelle (eine Zeile) zum Anzeigen
    pub evidence: Option<String>,
}

impl Diagnosis {
    fn new(id: &str, confidence: u8) -> Self {
        Diagnosis {
            id: id.into(),
            confidence,
            culprit: None,
            params: BTreeMap::new(),
            actions: vec![],
            evidence: None,
        }
    }
    fn param(mut self, k: &str, v: impl Into<String>) -> Self {
        self.params.insert(k.into(), v.into());
        self
    }
    fn culprit(mut self, mod_id: Option<&str>, name: Option<&str>) -> Self {
        self.culprit = Some(Culprit {
            mod_id: mod_id.map(Into::into),
            name: name.map(Into::into),
            file: None,
        });
        self
    }
    fn action(mut self, a: Action) -> Self {
        self.actions.push(a);
        self
    }
    fn evidence(mut self, line: &str) -> Self {
        self.evidence = Some(line.trim().chars().take(300).collect());
        self
    }
}

/// Mods im mods-Ordner: Mod-ID -> (Dateiname, Anzeigename). Wird zum Zuordnen von Schuldigen benutzt.
#[derive(Debug, Default, Clone)]
pub struct ModIndex {
    pub by_id: HashMap<String, Vec<(String, Option<String>)>>,
    /// Deaktivierte Jars (`.jar.disabled`): Mod-ID -> (Datei, Name)
    pub disabled: HashMap<String, (String, Option<String>)>,
}

impl ModIndex {
    pub fn file_of(&self, id: &str) -> Option<&(String, Option<String>)> {
        self.by_id
            .get(&id.to_ascii_lowercase())
            .and_then(|v| v.first())
    }

    /// Liest Mod-IDs aus fabric.mod.json / quilt.mod.json / (neoforge.)mods.toml aller aktiven Jars
    /// (und getrennt die der deaktivierten `.jar.disabled`).
    pub fn scan(mods_dir: &Path) -> ModIndex {
        let mut idx = ModIndex::default();
        let Ok(rd) = std::fs::read_dir(mods_dir) else {
            return idx;
        };
        for e in rd.flatten() {
            let p = e.path();
            let file = e.file_name().to_string_lossy().to_string();
            if file.ends_with(".jar.disabled") {
                for (id, name) in read_mod_ids(&p) {
                    idx.disabled
                        .entry(id.to_ascii_lowercase())
                        .or_insert((file.clone(), name));
                }
                continue;
            }
            if p.extension().and_then(|x| x.to_str()) != Some("jar") {
                continue;
            }
            for (id, name) in read_mod_ids(&p) {
                idx.by_id
                    .entry(id.to_ascii_lowercase())
                    .or_default()
                    .push((file.clone(), name));
            }
        }
        idx
    }
}

fn read_mod_ids(jar: &Path) -> Vec<(String, Option<String>)> {
    let Ok(f) = std::fs::File::open(jar) else {
        return vec![];
    };
    let Ok(mut z) = zip::ZipArchive::new(f) else {
        return vec![];
    };
    let mut out = vec![];
    for name in ["fabric.mod.json", "quilt.mod.json"] {
        if let Ok(mut e) = z.by_name(name) {
            let mut s = String::new();
            if std::io::Read::read_to_string(&mut e, &mut s).is_ok() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                    let v = v.get("quilt_loader").unwrap_or(&v);
                    if let Some(id) = v.get("id").and_then(|x| x.as_str()) {
                        let n = v
                            .get("name")
                            .or_else(|| v.pointer("/metadata/name"))
                            .and_then(|x| x.as_str())
                            .map(String::from);
                        out.push((id.to_string(), n));
                    }
                }
            }
        }
    }
    for name in ["META-INF/neoforge.mods.toml", "META-INF/mods.toml"] {
        if let Ok(mut e) = z.by_name(name) {
            let mut s = String::new();
            if std::io::Read::read_to_string(&mut e, &mut s).is_ok() {
                static RE: OnceLock<Regex> = OnceLock::new();
                let re = RE.get_or_init(|| Regex::new(r#"(?m)^\s*modId\s*=\s*"([^"]+)""#).unwrap());
                for c in re.captures_iter(&s) {
                    out.push((c[1].to_string(), None));
                }
            }
            break;
        }
    }
    out
}

fn re(s: &str) -> Regex {
    Regex::new(s).expect("Regex")
}

struct Rules {
    fabric_missing: Regex,
    fabric_wrong_mc: Regex,
    fabric_java: Regex,
    forge_missing: Regex,
    forge_wrong_mc: Regex,
    forge_duplicate: Regex,
    fabric_duplicate: Regex,
    mixin_from_mod: Regex,
    mixin_apply: Regex,
    mixin_config: Regex,
    class_version: Regex,
    oom: Regex,
    heap_reserve: Regex,
    gl: Regex,
    driver_dll: Regex,
    suspected: Regex,
    forge_failed: Regex,
    transformer: Regex,
}

fn rules() -> &'static Rules {
    static R: OnceLock<Rules> = OnceLock::new();
    R.get_or_init(|| Rules {
        // Mod 'Sodium Extra' (sodium-extra) 0.5.1 requires any version of fabric-api, which is missing!
        // Mod 'X' (x) 1.0 requires version 10.0 or later of mod 'Cloth Config v10' (cloth-config), which is missing!
        fabric_missing: re(
            r"Mod '([^\n]+?)' \(([^)\s]+)\) \S+ requires [^\n]+? of (?:mod '([^\n]+?)' \(([^)\s]+)\)|([\w\-.]+)), which is missing",
        ),
        // Mod 'X' (x) 1.0 requires version 1.20.1 of minecraft, but only the wrong version is present: 1.21.4!
        // (Namen dürfen Apostrophe enthalten: „Xaero's Minimap“)
        fabric_wrong_mc: re(r"Mod '([^\n]+?)' \(([^)\s]+)\) \S+ requires (?:version|any version)? ?(.*?) of (?:mod '?Minecraft'? \(minecraft\)|minecraft), but only the wrong version is present: ([^!\s]+)"),
        // Mod 'X' (x) 1.0 requires version 21 or later of java, but only the wrong version is present: 17!
        fabric_java: re(r"requires (?:version )?([0-9]+)(?:\.[0-9.]*)? or later of (?:mod '?Java'? \(java\)|java)"),
        // Mod ID: 'architectury', Requested by: 'rei', Expected range: '[9.1.12,)', Actual version: '[MISSING]'
        forge_missing: re(r"Mod ID: '([^']+)', Requested by: '([^']+)', Expected range: '([^']*)', Actual version: '\[MISSING\]'"),
        forge_wrong_mc: re(r"Mod ID: 'minecraft', Requested by: '([^']+)', Expected range: '([^']*)', Actual version: '([^']*)'"),
        // Mod ID: 'jei' from mod files: jei-1.20.1-forge-15.2.0.27.jar, jei-1.20.1-forge-15.3.0.4.jar
        forge_duplicate: re(r"Mod ID: '([^']+)' from mod files: ([^\n]+)"),
        fabric_duplicate: re(r"(?i)(?:duplicate mod(?: id)?|mods share id|is present multiple times)[^'\n]*'?([\w\-]+)'?"),
        mixin_from_mod: re(r"\[from mod ([\w\-]+)\]"),
        mixin_apply: re(r"Mixin apply for mod ([\w\-]+) failed"),
        mixin_config: re(r"(?:mixin config|Error loading class|config) ([\w\-]+?)\.mixins\.json"),
        class_version: re(r"class file version (\d+)\.\d+\)?(?:, this version of the Java Runtime only recognizes class file versions up to (\d+))?"),
        oom: re(r"java\.lang\.OutOfMemoryError(?:: ([^\n]+))?"),
        heap_reserve: re(r"Could not reserve enough space for (?:\d+KB )?object heap|Invalid maximum heap size"),
        gl: re(r"(?i)(WGL: The driver does not appear to support OpenGL|Pixel format not accelerated|GLFW error 65543|OpenGL 3\.2|No OpenGL context|Failed to create the GLFW window|GLFW error 65542|Couldn't set pixel format)"),
        driver_dll: re(r"(?i)\b(atio6axx\.dll|atioglxx\.dll|nvoglv64\.dll|nvoglv32\.dll|ig\d+icd(?:32|64)\.dll|igxelpicd64\.dll|amdxc64\.dll)"),
        suspected: re(r"Suspected Mods?: ([^\n]+)"),
        forge_failed: re(r"Mod (\w+) has failed to load correctly"),
        transformer: re(r"TRANSFORMER/([a-z][\w\-]*)@"),
    })
}

fn line_of<'a>(text: &'a str, start: usize) -> &'a str {
    let s = text[..start].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let e = text[start..]
        .find('\n')
        .map(|i| start + i)
        .unwrap_or(text.len());
    &text[s..e]
}

/// Mod-IDs, die in Fehlermeldungen vorkommen, aber nie Schuldige sind.
fn is_builtin(id: &str) -> bool {
    matches!(
        id,
        "minecraft"
            | "java"
            | "fabricloader"
            | "fabric-loader"
            | "forge"
            | "neoforge"
            | "quilt_loader"
            | "mixinextras"
            | "mcp"
    )
}

/// Fehlende Abhängigkeit: liegt sie deaktiviert in `mods/`, heißt die Lösung „aktivieren“ statt „installieren“.
fn missing_dependency(mods: &ModIndex, dep_id: &str, dep_name: Option<&str>) -> Diagnosis {
    let d = Diagnosis::new("missing_dependency", 95).param("dependency", dep_id);
    match mods.disabled.get(&dep_id.to_ascii_lowercase()) {
        Some((file, name)) => {
            let name = name.clone().or_else(|| dep_name.map(Into::into));
            d.param("dependency_name", name.as_deref().unwrap_or(dep_id))
                .param("disabled_file", file)
                .action(Action::EnableMod {
                    file: file.clone(),
                    name,
                })
        }
        None => d
            .param("dependency_name", dep_name.unwrap_or(dep_id))
            .action(Action::InstallDependency {
                mod_id: dep_id.into(),
                name: dep_name.map(Into::into),
            }),
    }
}

/// Hauptfunktion: Text (Crash-Report + Log) und optional Exit-Code auswerten.
pub fn analyze(
    text: &str,
    exit_code: Option<i32>,
    mods: &ModIndex,
    max_memory_mb: u32,
) -> Vec<Diagnosis> {
    let r = rules();
    let mut out: Vec<Diagnosis> = vec![];
    let mut seen = std::collections::HashSet::new();
    let mut push = |d: Diagnosis, out: &mut Vec<Diagnosis>| {
        let key = format!(
            "{}:{:?}:{:?}",
            d.id,
            d.culprit.as_ref().and_then(|c| c.mod_id.clone()),
            d.params.get("dependency")
        );
        if seen.insert(key) {
            out.push(d);
        }
    };

    // Fehlende Abhängigkeiten
    for c in r.fabric_missing.captures_iter(text) {
        let dep_id = c
            .get(4)
            .or(c.get(5))
            .map(|m| m.as_str())
            .unwrap_or_default();
        if dep_id.is_empty() || dep_id == "minecraft" || dep_id == "java" {
            continue;
        }
        let dep_name = c.get(3).map(|m| m.as_str());
        let d = missing_dependency(mods, dep_id, dep_name)
            .culprit(Some(&c[2]), Some(&c[1]))
            .evidence(line_of(text, c.get(0).unwrap().start()));
        push(d, &mut out);
    }
    for c in r.forge_missing.captures_iter(text) {
        let d = missing_dependency(mods, &c[1], None)
            .culprit(Some(&c[2]), None)
            .param("range", &c[3])
            .evidence(line_of(text, c.get(0).unwrap().start()));
        push(d, &mut out);
    }

    // Mod für eine andere Minecraft-Version
    for c in r.fabric_wrong_mc.captures_iter(text) {
        let d = Diagnosis::new("wrong_minecraft", 92)
            .culprit(Some(&c[2]), Some(&c[1]))
            .param("required", c[3].trim())
            .param("present", &c[4])
            .evidence(line_of(text, c.get(0).unwrap().start()));
        push(d, &mut out);
    }
    for c in r.forge_wrong_mc.captures_iter(text) {
        let d = Diagnosis::new("wrong_minecraft", 92)
            .culprit(Some(&c[1]), None)
            .param("required", &c[2])
            .param("present", &c[3])
            .evidence(line_of(text, c.get(0).unwrap().start()));
        push(d, &mut out);
    }

    // Java-Version
    if let Some(c) = r.class_version.captures(text) {
        let class: u32 = c[1].parse().unwrap_or(0);
        if class >= 45 {
            let major = class - 44;
            let d = Diagnosis::new("java_version", 90)
                .param("required", major.to_string())
                .param(
                    "present",
                    c.get(2)
                        .and_then(|m| m.as_str().parse::<u32>().ok())
                        .map(|v| (v - 44).to_string())
                        .unwrap_or_default(),
                )
                .action(Action::SetJava { major })
                .evidence(line_of(text, c.get(0).unwrap().start()));
            push(d, &mut out);
        }
    } else if let Some(c) = r.fabric_java.captures(text) {
        let major: u32 = c[1].parse().unwrap_or(0);
        if major >= 8 {
            let d = Diagnosis::new("java_version", 88)
                .param("required", major.to_string())
                .action(Action::SetJava { major })
                .evidence(line_of(text, c.get(0).unwrap().start()));
            push(d, &mut out);
        }
    }

    // Arbeitsspeicher
    if let Some(c) = r.heap_reserve.find(text) {
        let d = Diagnosis::new("heap_reserve", 90)
            .param("current", max_memory_mb.to_string())
            .evidence(line_of(text, c.start()));
        push(d, &mut out);
    } else if let Some(c) = r.oom.captures(text) {
        let kind = c
            .get(1)
            .map(|m| m.as_str().trim().to_string())
            .unwrap_or_default();
        // Metaspace/Direct-Buffer sind ebenfalls Speicherprobleme; „unable to create native thread“ eher System
        let suggest = suggest_ram(max_memory_mb);
        let d = Diagnosis::new("out_of_memory", 90)
            .param("current", max_memory_mb.to_string())
            .param("suggest", suggest.to_string())
            .param("detail", kind)
            .action(Action::IncreaseRam {
                suggest_mb: suggest,
            })
            .evidence(line_of(text, c.get(0).unwrap().start()));
        push(d, &mut out);
    }

    // Doppelte Mods (Meldung im Log)
    for c in r.forge_duplicate.captures_iter(text) {
        let files: Vec<String> = c[2]
            .split(',')
            .map(|f| f.trim().to_string())
            .filter(|f| !f.is_empty())
            .collect();
        let mut d = Diagnosis::new("duplicate_mod", 93)
            .culprit(Some(&c[1]), None)
            .param("files", files.join(", "));
        if let Some(f) = files.get(1) {
            d = d.action(Action::DisableMod { file: f.clone() });
        }
        push(
            d.evidence(line_of(text, c.get(0).unwrap().start())),
            &mut out,
        );
    }
    if !out.iter().any(|d| d.id == "duplicate_mod") {
        if let Some(c) = r.fabric_duplicate.captures(text) {
            let id = c[1].to_string();
            if !is_builtin(&id) {
                let d = Diagnosis::new("duplicate_mod", 85)
                    .culprit(Some(&id), None)
                    .evidence(line_of(text, c.get(0).unwrap().start()));
                push(d, &mut out);
            }
        }
    }
    // Doppelte Mods (aus dem mods-Ordner selbst – zuverlässig)
    let mut dups: Vec<_> = mods
        .by_id
        .iter()
        .filter(|(id, v)| v.len() > 1 && !is_builtin(id))
        .collect();
    dups.sort_by(|a, b| a.0.cmp(b.0));
    for (id, files) in dups {
        let names: Vec<String> = files.iter().map(|f| f.0.clone()).collect();
        let mut d = Diagnosis::new("duplicate_mod", 80)
            .culprit(Some(id), files[0].1.as_deref())
            .param("files", names.join(", "));
        d = d.action(Action::DisableMod {
            file: names[names.len() - 1].clone(),
        });
        push(d, &mut out);
    }

    // Mixin-Fehler mit Mod-Namen
    if text.contains("Mixin") || text.contains("mixin") {
        let mut mixin_mod: Option<(String, usize)> = None;
        for re in [&r.mixin_from_mod, &r.mixin_apply, &r.mixin_config] {
            if let Some(c) = re.captures(text) {
                let id = c[1].to_string();
                if !is_builtin(&id) {
                    mixin_mod = Some((id, c.get(0).unwrap().start()));
                    break;
                }
            }
        }
        let has_error = text.contains("MixinTransformerError")
            || text.contains("InvalidMixinException")
            || text.contains("MixinApplyError")
            || text.contains("Mixin apply")
            || text.contains("InvalidInjectionException");
        if let (true, Some((id, pos))) = (has_error, mixin_mod) {
            let d = Diagnosis::new("mixin", 85)
                .culprit(Some(&id), None)
                .evidence(line_of(text, pos));
            push(d, &mut out);
        }
    }

    // Grafik / Treiber
    if let Some(c) = r.gl.find(text) {
        push(
            Diagnosis::new("graphics", 85)
                .action(Action::UpdateDrivers)
                .evidence(line_of(text, c.start())),
            &mut out,
        );
    } else if let Some(c) = r.driver_dll.captures(text) {
        if text.contains("EXCEPTION_ACCESS_VIOLATION")
            || text.contains("A fatal error has been detected")
        {
            push(
                Diagnosis::new("graphics", 80)
                    .param("dll", &c[1])
                    .action(Action::UpdateDrivers)
                    .evidence(line_of(text, c.get(0).unwrap().start())),
                &mut out,
            );
        }
    }

    // Verdächtige Mods aus dem Crash-Report (Fabric/Forge ab 1.20) bzw. Forge-Ladefehler
    if out.iter().all(|d| d.confidence < 85) {
        if let Some(c) = r.suspected.captures(text) {
            // „Sodium (sodium), Version: 0.5.8“
            let first = c[1].split(',').next().unwrap_or("").trim();
            let (name, id) = match (first.find('('), first.find(')')) {
                (Some(a), Some(b)) if b > a => (first[..a].trim(), &first[a + 1..b]),
                _ => (first, first),
            };
            if !id.is_empty() && !is_builtin(id) && !c[1].trim().eq_ignore_ascii_case("none") {
                push(
                    Diagnosis::new("suspected_mod", 70)
                        .culprit(Some(id), Some(name))
                        .evidence(line_of(text, c.get(0).unwrap().start())),
                    &mut out,
                );
            }
        } else if let Some(c) = r.forge_failed.captures(text) {
            push(
                Diagnosis::new("suspected_mod", 70)
                    .culprit(Some(&c[1]), None)
                    .evidence(line_of(text, c.get(0).unwrap().start())),
                &mut out,
            );
        } else if let Some(c) = r.transformer.captures(text) {
            if !is_builtin(&c[1]) {
                push(
                    Diagnosis::new("suspected_mod", 55)
                        .culprit(Some(&c[1]), None)
                        .evidence(line_of(text, c.get(0).unwrap().start())),
                    &mut out,
                );
            }
        }
    }

    // Exit-Codes als letzter Hinweis
    if let Some(code) = exit_code {
        if code != 0 && out.is_empty() {
            let id = match code {
                -1073741819 => "exit_access_violation",
                -805306369 => "exit_hang",
                -1073740791 | -1073740940 => "exit_native",
                137 | -9 => "exit_killed",
                _ => "exit_code",
            };
            let mut d = Diagnosis::new("exit_code", 30)
                .param("code", code.to_string())
                .param("hint", id);
            if id == "exit_access_violation" {
                d = d.action(Action::UpdateDrivers);
            }
            push(d, &mut out);
        }
    }

    // Schuldige den Dateien zuordnen, sinnvolle Standard-Aktionen ergänzen
    for d in out.iter_mut() {
        if let Some(c) = d.culprit.as_mut() {
            if let Some(id) = c.mod_id.clone() {
                if let Some((file, name)) = mods.file_of(&id) {
                    c.file = Some(file.clone());
                    if c.name.is_none() {
                        c.name = name.clone();
                    }
                }
            }
            let disable = matches!(d.id.as_str(), "mixin" | "wrong_minecraft" | "suspected_mod");
            if disable {
                if let Some(f) = &c.file {
                    if !d
                        .actions
                        .iter()
                        .any(|a| matches!(a, Action::DisableMod { .. }))
                    {
                        d.actions.insert(0, Action::DisableMod { file: f.clone() });
                    }
                }
            }
        }
        d.actions.push(Action::Upload);
    }
    out.sort_by(|a, b| b.confidence.cmp(&a.confidence));
    out
}

/// Vorschlag für mehr RAM: +50 %, auf 1024 gerundet, mindestens 4 GB, höchstens 16 GB.
pub fn suggest_ram(current: u32) -> u32 {
    let v = ((current as f64 * 1.5) / 1024.0).ceil() as u32 * 1024;
    v.clamp(4096, 16384).max(current + 1024).min(16384)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(d: &[Diagnosis]) -> Vec<&str> {
        d.iter().map(|x| x.id.as_str()).collect()
    }

    const FABRIC_MISSING: &str = r#"[12:01:22] [main/ERROR]: Incompatible mods found!
net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!
A potential solution has been determined, this may resolve your problem:
	 - Install fabric-api, any version.
	 - Install cloth-config, version 15.0.0 or later.
More details:
	 - Mod 'Sodium Extra' (sodium-extra) 0.5.4+mc1.20.4 requires any version of fabric-api, which is missing!
	 - Mod 'Mod Menu' (modmenu) 9.0.0 requires version 13.0.0 or later of mod 'Cloth Config v13' (cloth-config), which is missing!
	at net.fabricmc.loader.impl.FormattedException.ofLocalized(FormattedException.java:51)"#;

    #[test]
    fn fabric_missing_dependency() {
        let mut idx = ModIndex::default();
        idx.by_id.insert(
            "sodium-extra".into(),
            vec![("sodium-extra-0.5.4.jar".into(), Some("Sodium Extra".into()))],
        );
        let d = analyze(FABRIC_MISSING, Some(1), &idx, 4096);
        let missing: Vec<_> = d.iter().filter(|x| x.id == "missing_dependency").collect();
        assert_eq!(missing.len(), 2, "{d:#?}");
        assert_eq!(missing[0].params["dependency"], "fabric-api");
        assert_eq!(
            missing[0].culprit.as_ref().unwrap().file.as_deref(),
            Some("sodium-extra-0.5.4.jar")
        );
        assert_eq!(missing[1].params["dependency"], "cloth-config");
        assert_eq!(missing[1].params["dependency_name"], "Cloth Config v13");
        assert!(
            matches!(&missing[0].actions[0], Action::InstallDependency { mod_id, .. } if mod_id == "fabric-api")
        );

        // Fabric API liegt deaktiviert im mods-Ordner -> aktivieren statt installieren
        idx.disabled.insert(
            "fabric-api".into(),
            ("fabric-api-0.92.jar.disabled".into(), Some("Fabric API".into())),
        );
        let d = analyze(FABRIC_MISSING, Some(1), &idx, 4096);
        let m = d.iter().find(|x| x.params.get("dependency").map(String::as_str) == Some("fabric-api")).unwrap();
        assert_eq!(m.params["disabled_file"], "fabric-api-0.92.jar.disabled");
        assert_eq!(m.params["dependency_name"], "Fabric API");
        assert!(
            matches!(&m.actions[0], Action::EnableMod { file, .. } if file == "fabric-api-0.92.jar.disabled")
        );
    }

    const FABRIC_WRONG_MC: &str = r#"	 - Mod 'Xaero's Minimap' (xaerominimap) 24.0.2 requires version 1.20.1 of minecraft, but only the wrong version is present: 1.21.4!"#;

    #[test]
    fn fabric_wrong_minecraft() {
        let d = analyze(FABRIC_WRONG_MC, None, &ModIndex::default(), 4096);
        assert_eq!(ids(&d)[0], "wrong_minecraft");
        assert_eq!(d[0].params["present"], "1.21.4");
        assert_eq!(
            d[0].culprit.as_ref().unwrap().mod_id.as_deref(),
            Some("xaerominimap")
        );
    }

    const FORGE_MISSING: &str = r#"[main/ERROR] [net.minecraftforge.fml.loading.ModSorter/LOADING]: Missing or unsupported mandatory dependencies:
	Mod ID: 'architectury', Requested by: 'roughlyenoughitems', Expected range: '[9.1.12,)', Actual version: '[MISSING]'
	Mod ID: 'minecraft', Requested by: 'oldmod', Expected range: '[1.19.2,1.19.3)', Actual version: '1.20.1'"#;

    #[test]
    fn forge_missing_and_wrong_mc() {
        let d = analyze(FORGE_MISSING, None, &ModIndex::default(), 4096);
        assert!(ids(&d).contains(&"missing_dependency"));
        assert!(ids(&d).contains(&"wrong_minecraft"));
        let m = d.iter().find(|x| x.id == "missing_dependency").unwrap();
        assert_eq!(m.params["dependency"], "architectury");
        assert_eq!(
            m.culprit.as_ref().unwrap().mod_id.as_deref(),
            Some("roughlyenoughitems")
        );
    }

    const JAVA: &str = "Exception in thread \"main\" java.lang.UnsupportedClassVersionError: net/minecraft/client/main/Main has been compiled by a more recent version of the Java Runtime (class file version 65.0), this version of the Java Runtime only recognizes class file versions up to 61.0";

    #[test]
    fn java_version() {
        let d = analyze(JAVA, Some(1), &ModIndex::default(), 4096);
        assert_eq!(d[0].id, "java_version");
        assert_eq!(d[0].params["required"], "21");
        assert_eq!(d[0].params["present"], "17");
        assert_eq!(d[0].actions[0], Action::SetJava { major: 21 });
    }

    #[test]
    fn fabric_java_requirement() {
        let t = " - Mod 'Sodium' (sodium) 0.6.0 requires version 21 or later of java, but only the wrong version is present: 17!";
        let d = analyze(t, None, &ModIndex::default(), 4096);
        assert_eq!(d[0].id, "java_version");
        assert_eq!(d[0].params["required"], "21");
    }

    const OOM: &str = r#"---- Minecraft Crash Report ----
Description: Unexpected error

java.lang.OutOfMemoryError: Java heap space
	at java.base/java.util.Arrays.copyOf(Arrays.java:3537)"#;

    #[test]
    fn out_of_memory() {
        let d = analyze(OOM, Some(-1), &ModIndex::default(), 2048);
        assert_eq!(d[0].id, "out_of_memory");
        assert_eq!(d[0].actions[0], Action::IncreaseRam { suggest_mb: 4096 });
        assert_eq!(suggest_ram(6144), 9216);
        assert_eq!(suggest_ram(16384), 16384);
    }

    #[test]
    fn heap_reserve() {
        let d = analyze("Error occurred during initialization of VM\nCould not reserve enough space for 8388608KB object heap", Some(1), &ModIndex::default(), 8192);
        assert_eq!(d[0].id, "heap_reserve");
    }

    const MIXIN: &str = r#"Caused by: org.spongepowered.asm.mixin.transformer.throwables.MixinTransformerError: An unexpected critical error was encountered
Caused by: org.spongepowered.asm.mixin.injection.throwables.InvalidInjectionException: Critical injection failure: @Inject annotation on renderSky could not find any targets matching 'Lnet/minecraft/class_761;method_3257' in net.minecraft.class_761. Using refmap betterclouds-refmap.json [PREINJECT Applicator Phase -> betterclouds.mixins.json:MixinWorldRenderer from mod betterclouds -> Prepare Injections -> handler$zza000$betterclouds$renderSky]
	at org.spongepowered.asm.mixin.injection.struct.InjectionInfo.validateTargets [from mod betterclouds]"#;

    #[test]
    fn mixin_culprit() {
        let mut idx = ModIndex::default();
        idx.by_id.insert(
            "betterclouds".into(),
            vec![(
                "betterclouds-v1.3.2.jar".into(),
                Some("Better Clouds".into()),
            )],
        );
        let d = analyze(MIXIN, Some(-1), &idx, 4096);
        assert_eq!(d[0].id, "mixin");
        let c = d[0].culprit.as_ref().unwrap();
        assert_eq!(c.mod_id.as_deref(), Some("betterclouds"));
        assert_eq!(c.name.as_deref(), Some("Better Clouds"));
        assert_eq!(
            d[0].actions[0],
            Action::DisableMod {
                file: "betterclouds-v1.3.2.jar".into()
            }
        );
    }

    const FORGE_DUP: &str = "Found duplicate mods:\n\tMod ID: 'jei' from mod files: jei-1.20.1-forge-15.2.0.27.jar, jei-1.20.1-forge-15.3.0.4.jar\n";

    #[test]
    fn duplicates_from_log_and_folder() {
        let d = analyze(FORGE_DUP, None, &ModIndex::default(), 4096);
        assert_eq!(d[0].id, "duplicate_mod");
        assert_eq!(
            d[0].actions[0],
            Action::DisableMod {
                file: "jei-1.20.1-forge-15.3.0.4.jar".into()
            }
        );

        let mut idx = ModIndex::default();
        idx.by_id.insert(
            "sodium".into(),
            vec![
                ("sodium-0.5.8.jar".into(), None),
                ("sodium-0.6.0.jar".into(), None),
            ],
        );
        let d = analyze("", None, &idx, 4096);
        assert_eq!(d[0].id, "duplicate_mod");
        assert_eq!(d[0].params["files"], "sodium-0.5.8.jar, sodium-0.6.0.jar");
    }

    const GL: &str = "[Render thread/ERROR]: GLFW error 65542: WGL: The driver does not appear to support OpenGL";
    const NATIVE: &str = "# A fatal error has been detected by the Java Runtime Environment:\n#  EXCEPTION_ACCESS_VIOLATION (0xc0000005) at pc=0x00007ffb\n# C  [atio6axx.dll+0x1b2f3c]";

    #[test]
    fn graphics() {
        assert_eq!(
            analyze(GL, None, &ModIndex::default(), 4096)[0].id,
            "graphics"
        );
        let d = analyze(NATIVE, Some(-1073741819), &ModIndex::default(), 4096);
        assert_eq!(d[0].id, "graphics");
        assert_eq!(d[0].params["dll"], "atio6axx.dll");
    }

    const SUSPECTED: &str = "-- System Details --\nDetails:\n\tSuspected Mods: Sodium (sodium), Version: 0.5.8+mc1.20.4\n\t\tat TRANSFORMER/sodium@0.5.8/me.jellysquid.Foo";

    #[test]
    fn suspected_and_exit_code() {
        let d = analyze(SUSPECTED, Some(-1), &ModIndex::default(), 4096);
        assert_eq!(d[0].id, "suspected_mod");
        assert_eq!(
            d[0].culprit.as_ref().unwrap().mod_id.as_deref(),
            Some("sodium")
        );
        let d = analyze(
            "nichts Besonderes",
            Some(-805306369),
            &ModIndex::default(),
            4096,
        );
        assert_eq!(d[0].id, "exit_code");
        assert_eq!(d[0].params["hint"], "exit_hang");
        assert!(analyze("alles gut", Some(0), &ModIndex::default(), 4096).is_empty());
    }
}
