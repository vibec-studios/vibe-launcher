//! Versions-JSON-Modell (Mojang-Format inkl. Loader-Profile), Regeln (`rules`), Mojang-Manifest.
use crate::error::{AppError, AppResult, Ctx};
use crate::net::DownloadItem;
use crate::paths::{maven_path, Paths};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;

pub const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
pub const LIBRARIES_URL: &str = "https://libraries.minecraft.net/";
pub const RESOURCES_URL: &str = "https://resources.download.minecraft.net/";

// ------------------------------------------------------------------ Manifest

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    #[serde(default)]
    pub versions: Vec<ManifestEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub release_time: String,
}

fn manifest_cache_path(paths: &Paths) -> PathBuf {
    paths.meta().join("version_manifest_v2.json")
}

/// Manifest laden: Speicher-Cache (10 min) > Netz > Datei-Cache (offline).
pub async fn manifest(state: &AppState, refresh: bool) -> AppResult<Manifest> {
    static MEM: OnceLock<parking_lot::Mutex<Option<(std::time::Instant, Manifest)>>> = OnceLock::new();
    let mem = MEM.get_or_init(Default::default);
    if !refresh {
        if let Some((at, m)) = mem.lock().as_ref() {
            if at.elapsed() < std::time::Duration::from_secs(600) {
                return Ok(m.clone());
            }
        }
    }
    let cache = manifest_cache_path(&state.paths);
    match state.net.get_bytes(MANIFEST_URL).await {
        Ok(bytes) => {
            let m: Manifest = serde_json::from_slice(&bytes).ctx("Versionsliste von Mojang ist ungültig")?;
            if let Some(p) = cache.parent() {
                let _ = tokio::fs::create_dir_all(p).await;
            }
            let _ = tokio::fs::write(&cache, &bytes).await;
            *mem.lock() = Some((std::time::Instant::now(), m.clone()));
            Ok(m)
        }
        Err(e) => {
            tracing::warn!("Manifest nicht ladbar, nutze Cache: {e}");
            let bytes = tokio::fs::read(&cache)
                .await
                .map_err(|_| AppError::msg(format!("Versionsliste konnte nicht geladen werden (keine Internetverbindung?): {e}")))?;
            let m: Manifest = serde_json::from_slice(&bytes)?;
            *mem.lock() = Some((std::time::Instant::now(), m.clone()));
            Ok(m)
        }
    }
}

/// Lädt die Vanilla-Versions-JSON (falls noch nicht vorhanden) und gibt sie zurück.
pub async fn ensure_vanilla_json(state: &AppState, id: &str, force: bool) -> AppResult<VersionJson> {
    let path = state.paths.version_json(id);
    if !force && path.exists() {
        if let Ok(v) = read_version_file(&path) {
            return Ok(v);
        }
    }
    let m = manifest(state, false).await?;
    let entry = match m.versions.iter().find(|v| v.id == id) {
        Some(e) => e.clone(),
        None => {
            let m = manifest(state, true).await?;
            m.versions
                .iter()
                .find(|v| v.id == id)
                .cloned()
                .ok_or_else(|| AppError::msg(format!("Minecraft-Version {id} gibt es nicht.")))?
        }
    };
    if force {
        let _ = tokio::fs::remove_file(&path).await;
    }
    state
        .net
        .download_all(vec![DownloadItem::new(&entry.url, &path).sha1(entry.sha1.clone())], None)
        .await
        .map_err(|e| AppError::msg(format!("Versionsdaten für {id} konnten nicht geladen werden: {e}")))?;
    read_version_file(&path)
}

pub fn read_version_file(path: &std::path::Path) -> AppResult<VersionJson> {
    let bytes = std::fs::read(path)?;
    serde_json::from_slice(&bytes).map_err(|e| AppError::msg(format!("Versionsdatei {} ist beschädigt: {e}", path.display())))
}

// ------------------------------------------------------------------ Versions-JSON

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct VersionJson {
    pub id: String,
    pub inherits_from: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub main_class: Option<String>,
    pub minecraft_arguments: Option<String>,
    pub arguments: Option<Arguments>,
    pub libraries: Vec<Library>,
    pub asset_index: Option<AssetIndexRef>,
    pub assets: Option<String>,
    pub downloads: HashMap<String, Artifact>,
    pub java_version: Option<JavaVersionRef>,
    pub logging: Option<Logging>,
    pub jar: Option<String>,
    pub release_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Arguments {
    pub game: Vec<Argument>,
    pub jvm: Vec<Argument>,
    #[serde(rename = "default-user-jvm")]
    pub default_user_jvm: Vec<Argument>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Argument {
    Plain(String),
    Ruled {
        #[serde(default)]
        rules: Vec<Rule>,
        value: StringOrVec,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StringOrVec {
    One(String),
    Many(Vec<String>),
}

impl StringOrVec {
    pub fn to_vec(&self) -> Vec<String> {
        match self {
            StringOrVec::One(s) => vec![s.clone()],
            StringOrVec::Many(v) => v.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Artifact {
    pub path: Option<String>,
    pub url: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct LibDownloads {
    pub artifact: Option<Artifact>,
    pub classifiers: Option<HashMap<String, Artifact>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Extract {
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Library {
    pub name: String,
    pub downloads: Option<LibDownloads>,
    /// Maven-Basis-URL (Fabric/Forge-Legacy)
    pub url: Option<String>,
    pub rules: Option<Vec<Rule>>,
    pub natives: Option<HashMap<String, String>>,
    pub extract: Option<Extract>,
    pub sha1: Option<String>,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AssetIndexRef {
    pub id: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
    pub total_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct JavaVersionRef {
    pub component: Option<String>,
    pub major_version: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Logging {
    pub client: Option<LoggingClient>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct LoggingClient {
    pub argument: String,
    pub file: LoggingFile,
    #[serde(rename = "type")]
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct LoggingFile {
    pub id: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
}

// ------------------------------------------------------------------ Regeln

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Rule {
    pub action: String,
    pub os: Option<OsRule>,
    pub features: Option<HashMap<String, bool>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct OsRule {
    pub name: Option<String>,
    pub version: Option<String>,
    pub arch: Option<String>,
    pub version_range: Option<VersionRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct VersionRange {
    pub min: Option<String>,
    pub max: Option<String>,
}

/// Umgebung, gegen die Regeln ausgewertet werden.
#[derive(Debug, Clone)]
pub struct Env {
    /// "windows" | "osx" | "linux"
    pub os: &'static str,
    /// "x86_64" | "x86" | "aarch64"
    pub arch: &'static str,
    /// z. B. "10.0.26200"
    pub os_version: String,
    pub features: HashMap<String, bool>,
}

impl Env {
    pub fn current() -> Env {
        static VER: OnceLock<String> = OnceLock::new();
        let os_version = VER.get_or_init(os_version).clone();
        Env { os: os_name(), arch: arch_name(), os_version, features: HashMap::new() }
    }

    pub fn with_feature(mut self, name: &str, on: bool) -> Self {
        self.features.insert(name.to_string(), on);
        self
    }

    /// `${arch}` in Natives-Klassifizierern
    pub fn arch_bits(&self) -> &'static str {
        if self.arch == "x86" { "32" } else { "64" }
    }
}

pub fn os_name() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

pub fn arch_name() -> &'static str {
    if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else {
        "x86_64"
    }
}

fn os_version() -> String {
    if cfg!(windows) {
        // Windows 10/11 melden beide "10.0"; Build-Nummer aus dem Kernel.
        let build = sysinfo::System::kernel_version().unwrap_or_default();
        let build: String = build.chars().take_while(|c| c.is_ascii_digit()).collect();
        if build.is_empty() { "10.0".into() } else { format!("10.0.{build}") }
    } else {
        sysinfo::System::os_version().unwrap_or_default()
    }
}

fn cmp_dotted(a: &str, b: &str) -> std::cmp::Ordering {
    let pa: Vec<u64> = a.split(['.', '_', '-']).map(|x| x.parse().unwrap_or(0)).collect();
    let pb: Vec<u64> = b.split(['.', '_', '-']).map(|x| x.parse().unwrap_or(0)).collect();
    for i in 0..pa.len().max(pb.len()) {
        let x = pa.get(i).copied().unwrap_or(0);
        let y = pb.get(i).copied().unwrap_or(0);
        if x != y {
            return x.cmp(&y);
        }
    }
    std::cmp::Ordering::Equal
}

fn rule_matches(rule: &Rule, env: &Env) -> bool {
    if let Some(os) = &rule.os {
        if let Some(name) = &os.name {
            if name != env.os {
                return false;
            }
        }
        if let Some(arch) = &os.arch {
            let ok = match arch.as_str() {
                "x86" => env.arch == "x86",
                "x86_64" | "x64" | "amd64" => env.arch == "x86_64",
                "arm64" | "aarch64" => env.arch == "aarch64",
                other => other == env.arch,
            };
            if !ok {
                return false;
            }
        }
        if let Some(v) = &os.version {
            match regex::Regex::new(v) {
                Ok(re) => {
                    if !re.is_match(&env.os_version) {
                        return false;
                    }
                }
                Err(_) => return false,
            }
        }
        if let Some(r) = &os.version_range {
            if let Some(min) = &r.min {
                if cmp_dotted(&env.os_version, min) == std::cmp::Ordering::Less {
                    return false;
                }
            }
            if let Some(max) = &r.max {
                if cmp_dotted(&env.os_version, max) != std::cmp::Ordering::Less {
                    return false;
                }
            }
        }
    }
    if let Some(features) = &rule.features {
        for (k, v) in features {
            if env.features.get(k).copied().unwrap_or(false) != *v {
                return false;
            }
        }
    }
    true
}

/// Mojang-Logik: ohne Regeln erlaubt; mit Regeln zählt die letzte passende.
pub fn rules_allow(rules: Option<&[Rule]>, env: &Env) -> bool {
    let Some(rules) = rules else { return true };
    if rules.is_empty() {
        return true;
    }
    let mut allowed = false;
    for r in rules {
        if rule_matches(r, env) {
            allowed = r.action == "allow";
        }
    }
    allowed
}

/// Argumente einer Liste auswerten (Regeln anwenden, Werte flach machen).
pub fn eval_args(args: &[Argument], env: &Env) -> Vec<String> {
    let mut out = Vec::new();
    for a in args {
        match a {
            Argument::Plain(s) => out.push(s.clone()),
            Argument::Ruled { rules, value } => {
                if rules_allow(Some(rules), env) {
                    out.extend(value.to_vec());
                }
            }
        }
    }
    out
}

// ------------------------------------------------------------------ Libraries

/// Maven-Koordinate zerlegen: (group, artifact, version, classifier, ext)
pub fn parse_maven(coord: &str) -> Option<(String, String, String, Option<String>, String)> {
    let (c, ext) = match coord.split_once('@') {
        Some((c, e)) => (c, e.to_string()),
        None => (coord, "jar".to_string()),
    };
    let p: Vec<&str> = c.split(':').collect();
    if p.len() < 3 || p.iter().take(3).any(|s| s.is_empty()) {
        return None;
    }
    Some((p[0].to_string(), p[1].to_string(), p[2].to_string(), p.get(3).map(|s| s.to_string()), ext))
}

/// Schlüssel zum Entdoppeln: group:artifact[:classifier] (ohne Version).
pub fn library_key(name: &str) -> String {
    match parse_maven(name) {
        Some((g, a, _, c, _)) => match c {
            Some(c) => format!("{g}:{a}:{c}"),
            None => format!("{g}:{a}"),
        },
        None => name.to_string(),
    }
}

fn join_url(base: &str, rel: &str) -> String {
    let base = base.replace("http://files.minecraftforge.net/maven", "https://maven.minecraftforge.net");
    if base.ends_with('/') { format!("{base}{rel}") } else { format!("{base}/{rel}") }
}

/// Ein aufzulösender Library-Eintrag (Datei + Herkunft).
#[derive(Debug, Clone)]
pub struct LibFile {
    pub path: PathBuf,
    /// Leer = muss lokal entstehen (Forge-Installer/Processors)
    pub url: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
}

impl LibFile {
    pub fn download_item(&self) -> Option<DownloadItem> {
        if self.url.is_empty() {
            return None;
        }
        Some(DownloadItem::new(&self.url, &self.path).sha1(self.sha1.clone()).size(self.size))
    }
}

impl Library {
    pub fn allowed(&self, env: &Env) -> bool {
        if !rules_allow(self.rules.as_deref(), env) {
            return false;
        }
        // Neue Natives (ab 1.19): nur die passende Architektur
        if let Some((_, _, _, Some(c), _)) = parse_maven(&self.name) {
            if let Some(rest) = c.strip_prefix("natives-") {
                let has_arm = rest.ends_with("-arm64") || rest.ends_with("-aarch64") || rest.ends_with("-aarch_64");
                let has_x86 = rest.ends_with("-x86");
                if has_arm && env.arch != "aarch64" {
                    return false;
                }
                if has_x86 && env.arch != "x86" {
                    return false;
                }
            }
        }
        true
    }

    /// Hauptartefakt (für den Klassenpfad), falls vorhanden.
    pub fn artifact(&self, libs_dir: &std::path::Path) -> Option<LibFile> {
        if let Some(a) = self.downloads.as_ref().and_then(|d| d.artifact.as_ref()) {
            let rel = match &a.path {
                Some(p) if !p.is_empty() => PathBuf::from(p),
                _ => maven_path(&self.name)?,
            };
            return Some(LibFile { path: libs_dir.join(rel), url: a.url.clone(), sha1: a.sha1.clone(), size: a.size });
        }
        // Natives-only-Einträge (alt) haben kein Hauptartefakt
        if self.natives.is_some() && self.downloads.is_some() {
            return None;
        }
        if self.natives.is_some() && self.url.is_none() {
            return None;
        }
        let rel = maven_path(&self.name)?;
        let url = join_url(self.url.as_deref().unwrap_or(LIBRARIES_URL), &rel.to_string_lossy().replace('\\', "/"));
        Some(LibFile { path: libs_dir.join(rel), url, sha1: self.sha1.clone(), size: self.size })
    }

    /// Natives-Archiv im alten Format (`natives` + Klassifizierer), falls für dieses OS vorhanden.
    pub fn native_artifact(&self, libs_dir: &std::path::Path, env: &Env) -> Option<LibFile> {
        let natives = self.natives.as_ref()?;
        let classifier = natives.get(env.os)?.replace("${arch}", env.arch_bits());
        if let Some(a) = self.downloads.as_ref().and_then(|d| d.classifiers.as_ref()).and_then(|c| c.get(&classifier)) {
            let rel = match &a.path {
                Some(p) if !p.is_empty() => PathBuf::from(p),
                _ => maven_path(&format!("{}:{classifier}", self.name))?,
            };
            return Some(LibFile { path: libs_dir.join(rel), url: a.url.clone(), sha1: a.sha1.clone(), size: a.size });
        }
        let rel = maven_path(&format!("{}:{classifier}", self.name))?;
        let url = join_url(self.url.as_deref().unwrap_or(LIBRARIES_URL), &rel.to_string_lossy().replace('\\', "/"));
        Some(LibFile { path: libs_dir.join(rel), url, sha1: None, size: None })
    }
}

// ------------------------------------------------------------------ Mergen

/// Ergebnis von `inheritsFrom`-Auflösung.
#[derive(Debug, Clone, Default)]
pub struct Resolved {
    /// ID der obersten (Kind-)Version
    pub id: String,
    /// ID der Vanilla-Basis
    pub base_id: String,
    pub kind: String,
    pub main_class: String,
    pub minecraft_arguments: Option<String>,
    pub game_args: Vec<Argument>,
    pub jvm_args: Vec<Argument>,
    pub default_user_jvm: Vec<Argument>,
    pub has_jvm_args: bool,
    /// Nach Regeln gefiltert, entdoppelt (Kind gewinnt)
    pub libraries: Vec<Library>,
    pub asset_index: Option<AssetIndexRef>,
    pub assets: Option<String>,
    pub client: Option<Artifact>,
    pub java: Option<JavaVersionRef>,
    pub logging: Option<LoggingClient>,
    /// Versions-ID, deren JAR genutzt wird (`jar`-Feld) – sonst `id`
    pub jar: Option<String>,
}

/// Kette laden: [Kind, Eltern, ..., Vanilla]
pub fn load_chain(paths: &Paths, id: &str) -> AppResult<Vec<VersionJson>> {
    let mut chain = Vec::new();
    let mut cur = id.to_string();
    loop {
        if chain.len() > 8 {
            return Err(AppError::msg("Versionskette zu tief (inheritsFrom-Schleife?)"));
        }
        let path = paths.version_json(&cur);
        if !path.exists() {
            return Err(AppError::msg(format!("Versionsdatei {cur} fehlt – bitte Instanz reparieren.")));
        }
        let v = read_version_file(&path)?;
        let parent = v.inherits_from.clone();
        chain.push(v);
        match parent {
            Some(p) if !p.is_empty() => cur = p,
            _ => break,
        }
    }
    Ok(chain)
}

pub fn merge(chain: &[VersionJson], env: &Env) -> Resolved {
    let mut r = Resolved::default();
    let Some(child) = chain.first() else { return r };
    r.id = child.id.clone();
    r.base_id = chain.last().map(|v| v.id.clone()).unwrap_or_default();
    // Von der Basis zum Kind
    for v in chain.iter().rev() {
        if let Some(k) = &v.kind {
            r.kind = k.clone();
        }
        if let Some(m) = &v.main_class {
            if !m.is_empty() {
                r.main_class = m.clone();
            }
        }
        if let Some(a) = &v.minecraft_arguments {
            if !a.trim().is_empty() {
                r.minecraft_arguments = Some(a.clone());
            }
        }
        if let Some(a) = &v.arguments {
            r.game_args.extend(a.game.iter().cloned());
            if !a.jvm.is_empty() {
                r.has_jvm_args = true;
            }
            r.jvm_args.extend(a.jvm.iter().cloned());
            r.default_user_jvm.extend(a.default_user_jvm.iter().cloned());
        }
        if v.asset_index.is_some() {
            r.asset_index = v.asset_index.clone();
        }
        if v.assets.is_some() {
            r.assets = v.assets.clone();
        }
        if let Some(c) = v.downloads.get("client") {
            r.client = Some(c.clone());
        }
        if let Some(j) = &v.java_version {
            if j.major_version.is_some() || j.component.is_some() {
                r.java = Some(j.clone());
            }
        }
        if let Some(l) = v.logging.as_ref().and_then(|l| l.client.as_ref()) {
            if !l.file.url.is_empty() {
                r.logging = Some(l.clone());
            }
        }
        if let Some(j) = &v.jar {
            if !j.is_empty() {
                r.jar = Some(j.clone());
            }
        }
    }
    // Libraries: Kind zuerst, Eltern dahinter; gleiche group:artifact[:classifier] -> Kind gewinnt
    let mut seen = std::collections::HashSet::new();
    for v in chain {
        for lib in &v.libraries {
            if !lib.allowed(env) {
                continue;
            }
            let key = if lib.natives.is_some() { format!("{}#natives", library_key(&lib.name)) } else { library_key(&lib.name) };
            if seen.insert(key) {
                r.libraries.push(lib.clone());
            }
        }
    }
    r
}

/// Java-Hauptversion, die eine Version verlangt (Standard 8 für alte Versionen).
pub fn required_java(r: &Resolved) -> u32 {
    r.java.as_ref().and_then(|j| j.major_version).unwrap_or(8)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_win() -> Env {
        Env { os: "windows", arch: "x86_64", os_version: "10.0.26200".into(), features: HashMap::new() }
    }

    #[test]
    fn rules_basic() {
        let e = env_win();
        let r: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow"},{"action":"disallow","os":{"name":"osx"}}]"#).unwrap();
        assert!(rules_allow(Some(&r), &e));
        let r: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow","os":{"name":"osx"}}]"#).unwrap();
        assert!(!rules_allow(Some(&r), &e));
        let r: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow","os":{"name":"windows","version":"^10\\."}}]"#).unwrap();
        assert!(rules_allow(Some(&r), &e));
        let r: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow","os":{"arch":"x86"}}]"#).unwrap();
        assert!(!rules_allow(Some(&r), &e));
        let r: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow","features":{"is_demo_user":true}}]"#).unwrap();
        assert!(!rules_allow(Some(&r), &e));
        assert!(rules_allow(Some(&r), &e.clone().with_feature("is_demo_user", true)));
        let r: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow","os":{"name":"windows","versionRange":{"min":"10.0.17134"}}}]"#).unwrap();
        assert!(rules_allow(Some(&r), &e));
        let r: Vec<Rule> = serde_json::from_str(r#"[{"action":"allow","os":{"name":"windows","versionRange":{"max":"10.0.17134"}}}]"#).unwrap();
        assert!(!rules_allow(Some(&r), &e));
        assert!(rules_allow(None, &e));
    }

    #[test]
    fn args_eval() {
        let a: Vec<Argument> = serde_json::from_str(
            r#"["--a", {"rules":[{"action":"allow","features":{"has_custom_resolution":true}}],"value":["--width","${w}"]},
                {"rules":[{"action":"allow","os":{"name":"windows"}}],"value":"-Xwin"}]"#,
        )
        .unwrap();
        assert_eq!(eval_args(&a, &env_win()), vec!["--a", "-Xwin"]);
        assert_eq!(eval_args(&a, &env_win().with_feature("has_custom_resolution", true)), vec!["--a", "--width", "${w}", "-Xwin"]);
    }

    #[test]
    fn maven_parse() {
        assert_eq!(library_key("org.lwjgl:lwjgl:3.3.3:natives-windows"), "org.lwjgl:lwjgl:natives-windows");
        assert_eq!(library_key("org.ow2.asm:asm:9.7"), "org.ow2.asm:asm");
        assert_eq!(library_key("de.oceanlabs.mcp:mcp_config:1.20.1@zip"), "de.oceanlabs.mcp:mcp_config");
        assert!(parse_maven("broken").is_none());
    }

    #[test]
    fn library_paths_and_natives() {
        let e = env_win();
        let libs = std::path::Path::new("L");
        let l: Library = serde_json::from_str(r#"{"name":"net.fabricmc:fabric-loader:0.16.9","url":"https://maven.fabricmc.net/"}"#).unwrap();
        let a = l.artifact(libs).unwrap();
        assert_eq!(a.url, "https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar");
        let l: Library = serde_json::from_str(
            r#"{"name":"org.lwjgl.lwjgl:lwjgl-platform:2.9.4","natives":{"windows":"natives-windows-${arch}"},
                "downloads":{"classifiers":{"natives-windows-64":{"path":"x/y.jar","url":"https://u/y.jar","sha1":"ab","size":3}}}}"#,
        )
        .unwrap();
        assert!(l.artifact(libs).is_none());
        let n = l.native_artifact(libs, &e).unwrap();
        assert_eq!(n.url, "https://u/y.jar");
        let arm: Library = serde_json::from_str(r#"{"name":"org.lwjgl:lwjgl:3.3.3:natives-windows-arm64","rules":[{"action":"allow","os":{"name":"windows"}}]}"#).unwrap();
        assert!(!arm.allowed(&e));
        let x64: Library = serde_json::from_str(r#"{"name":"org.lwjgl:lwjgl:3.3.3:natives-windows","rules":[{"action":"allow","os":{"name":"windows"}}]}"#).unwrap();
        assert!(x64.allowed(&e));
    }

    #[test]
    fn merge_chain() {
        let parent: VersionJson = serde_json::from_str(
            r#"{"id":"1.20.1","type":"release","mainClass":"net.minecraft.client.main.Main",
                "arguments":{"game":["--username","${auth_player_name}"],"jvm":["-cp","${classpath}"]},
                "libraries":[{"name":"org.ow2.asm:asm:9.3"},{"name":"com.mojang:brigadier:1.0"}],
                "logging":{"client":{"argument":"-Dlog4j.configurationFile=${path}","file":{"id":"c.xml","url":"https://x/c.xml"}}},
                "javaVersion":{"component":"java-runtime-gamma","majorVersion":17}}"#,
        )
        .unwrap();
        let child: VersionJson = serde_json::from_str(
            r#"{"id":"forge","inheritsFrom":"1.20.1","mainClass":"cpw.Bootstrap","logging":{},
                "arguments":{"game":["--launchTarget","forgeclient"],"jvm":["-DlibraryDirectory=${library_directory}"]},
                "libraries":[{"name":"org.ow2.asm:asm:9.5"}]}"#,
        )
        .unwrap();
        let r = merge(&[child, parent], &env_win());
        assert_eq!(r.id, "forge");
        assert_eq!(r.base_id, "1.20.1");
        assert_eq!(r.main_class, "cpw.Bootstrap");
        assert_eq!(r.libraries.len(), 2);
        assert_eq!(r.libraries[0].name, "org.ow2.asm:asm:9.5");
        assert_eq!(eval_args(&r.game_args, &env_win()), vec!["--username", "${auth_player_name}", "--launchTarget", "forgeclient"]);
        assert_eq!(eval_args(&r.jvm_args, &env_win()).len(), 3);
        assert!(r.logging.is_some());
        assert_eq!(required_java(&r), 17);
    }
}
