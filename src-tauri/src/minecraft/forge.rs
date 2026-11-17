//! Forge-/NeoForge-Installer selbst ausführen: install_profile.json + version.json lesen,
//! Libraries laden, Processors (Client-Seite) ausführen. Unterstützt auch Legacy-Installer (≤1.12.2).
use super::meta::{Library, VersionJson};
use crate::error::{AppError, AppResult, Ctx};
use crate::net::DownloadItem;
use crate::paths::maven_path;
use crate::state::AppState;
use crate::tasks::SubProgress;
use serde::Deserialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};


#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct InstallProfile {
    // modern
    spec: Option<i64>,
    version: Option<String>,
    json: Option<String>,
    path: Option<String>,
    minecraft: Option<String>,
    data: HashMap<String, SidedValue>,
    processors: Vec<Processor>,
    libraries: Vec<Library>,
    // legacy
    install: Option<LegacyInstall>,
    #[serde(rename = "versionInfo")]
    version_info: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct SidedValue {
    client: Option<String>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default)]
struct Processor {
    sides: Option<Vec<String>>,
    jar: String,
    classpath: Vec<String>,
    args: Vec<String>,
    outputs: HashMap<String, String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct LegacyInstall {
    path: Option<String>,
    #[serde(rename = "filePath")]
    file_path: Option<String>,
}

pub struct ForgeSpec<'a> {
    pub neoforge: bool,
    pub mc: &'a str,
    /// Loader-Version wie in der Instanz ("47.3.0", "21.1.77")
    pub version: &'a str,
}

fn installer_url(spec: &ForgeSpec<'_>, full: &str) -> (String, String) {
    if spec.neoforge {
        if spec.mc == "1.20.1" {
            let coord = format!("net.neoforged:forge:{full}:installer");
            (format!("{}net/neoforged/forge/{full}/forge-{full}-installer.jar", super::loaders::NEO_MAVEN), coord)
        } else {
            let coord = format!("net.neoforged:neoforge:{full}:installer");
            (format!("{}net/neoforged/neoforge/{full}/neoforge-{full}-installer.jar", super::loaders::NEO_MAVEN), coord)
        }
    } else {
        let coord = format!("net.minecraftforge:forge:{full}:installer");
        (format!("{}net/minecraftforge/forge/{full}/forge-{full}-installer.jar", super::loaders::FORGE_MAVEN), coord)
    }
}

/// Maven-Version des Installers bestimmen.
async fn full_version(state: &AppState, spec: &ForgeSpec<'_>) -> String {
    if spec.neoforge {
        if spec.mc == "1.20.1" {
            let v = spec.version.strip_prefix("1.20.1-").unwrap_or(spec.version);
            return format!("1.20.1-{v}");
        }
        return spec.version.to_string();
    }
    let idx = super::loaders::forge_index(state).await.ok();
    super::loaders::forge_full_version(idx.as_ref(), spec.mc, spec.version)
}

/// Erwartete Versions-ID (ohne Installer zu öffnen) – für den schnellen Pfad.
fn marker_path(state: &AppState, spec: &ForgeSpec<'_>) -> PathBuf {
    let name = if spec.neoforge { "neoforge" } else { "forge" };
    state.paths.meta().join("loader-installs").join(format!("{name}-{}-{}.json", spec.mc, spec.version))
}

fn read_zip_entry(z: &mut zip::ZipArchive<std::fs::File>, name: &str) -> AppResult<Vec<u8>> {
    let name = name.trim_start_matches('/');
    let mut e = z.by_name(name).map_err(|_| AppError::msg(format!("Installer unvollständig: {name} fehlt")))?;
    let mut buf = Vec::new();
    e.read_to_end(&mut buf)?;
    Ok(buf)
}

/// Einträge unter `maven/` in den Libraries-Ordner entpacken (fehlende/geänderte Dateien).
fn extract_maven_dir(z: &mut zip::ZipArchive<std::fs::File>, libs: &Path, force: bool) -> AppResult<()> {
    for i in 0..z.len() {
        let mut e = z.by_index(i)?;
        if e.is_dir() {
            continue;
        }
        let name = e.name().to_string();
        let Some(rel) = name.strip_prefix("maven/") else { continue };
        let Some(out) = crate::util::safe_join(libs, rel) else { continue };
        if !force && out.metadata().map(|m| m.len() == e.size()).unwrap_or(false) {
            continue;
        }
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p)?;
        }
        let tmp = out.with_extension("vibe-tmp");
        let mut w = std::fs::File::create(&tmp)?;
        std::io::copy(&mut e, &mut w)?;
        drop(w);
        std::fs::rename(&tmp, &out)?;
    }
    Ok(())
}

fn lib_download_items(libs: &[Library], libs_dir: &Path, env: &super::meta::Env) -> (Vec<DownloadItem>, Vec<PathBuf>) {
    let mut items = Vec::new();
    let mut local = Vec::new();
    for l in libs {
        if !l.allowed(env) {
            continue;
        }
        if let Some(a) = l.artifact(libs_dir) {
            match a.download_item() {
                Some(d) => items.push(d),
                None => local.push(a.path),
            }
        }
    }
    (items, local)
}

/// Installer-JAR laden (Cache unter libraries/). Gibt (Pfad, volle Maven-Version) zurück.
pub async fn download_installer(state: &AppState, spec: &ForgeSpec<'_>, force: bool, sp: &SubProgress) -> AppResult<(PathBuf, String)> {
    let name = if spec.neoforge { "NeoForge" } else { "Forge" };
    let full = full_version(state, spec).await;
    let (url, coord) = installer_url(spec, &full);
    let installer = state.paths.libraries().join(maven_path(&coord).ctx("Installer-Pfad")?);
    sp.message(format!("{name}-Installer wird geladen …"));
    if force {
        let _ = tokio::fs::remove_file(&installer).await;
    }
    state.net.download_all(vec![DownloadItem::new(&url, &installer)], None).await.map_err(|e| {
        AppError::msg(format!("{name} {} für Minecraft {} konnte nicht geladen werden: {e}", spec.version, spec.mc))
    })?;
    sp.check()?;
    Ok((installer, full))
}

/// Forge/NeoForge installieren. Gibt die Versions-ID des Profils zurück.
/// Voraussetzung: Vanilla-JSON + Client-JAR sind vorhanden, `java` ist eine passende Java-Installation.
pub async fn install(state: &AppState, spec: ForgeSpec<'_>, java: &Path, force: bool, sp: &SubProgress) -> AppResult<String> {
    let marker = marker_path(state, &spec);
    if !force {
        if let Ok(b) = std::fs::read(&marker) {
            if let Ok(m) = serde_json::from_slice::<serde_json::Value>(&b) {
                if let Some(id) = m["id"].as_str() {
                    let id = id.to_string();
                    let outputs_ok = m["files"]
                        .as_array()
                        .map(|a| a.iter().filter_map(|v| v.as_str()).all(|p| Path::new(p).is_file()))
                        .unwrap_or(true);
                    if state.paths.version_json(&id).is_file() && outputs_ok {
                        return Ok(id);
                    }
                }
            }
        }
    }
    let (installer, full) = download_installer(state, &spec, force, sp).await?;
    let libs_dir = state.paths.libraries();

    // Installer öffnen, Profil lesen, maven/ entpacken
    let inst2 = installer.clone();
    let libs2 = libs_dir.clone();
    let tmp_root = state.paths.tmp().join(format!("installer-{}", uuid::Uuid::new_v4()));
    let tmp2 = tmp_root.clone();
    let (profile, version_bytes) = tokio::task::spawn_blocking(move || -> AppResult<(InstallProfile, Vec<u8>)> {
        let f = std::fs::File::open(&inst2)?;
        let mut z = zip::ZipArchive::new(f).map_err(|e| AppError::msg(format!("Installer ist beschädigt: {e}")))?;
        let profile_bytes = read_zip_entry(&mut z, "install_profile.json")?;
        let profile: InstallProfile = serde_json::from_slice(&profile_bytes).ctx("install_profile.json ungültig")?;
        extract_maven_dir(&mut z, &libs2, force)?;
        let version_bytes = if let Some(vi) = &profile.version_info {
            // Legacy: Universal-JAR an seinen Maven-Pfad entpacken
            if let Some(inst) = &profile.install {
                if let (Some(path), Some(file)) = (&inst.path, &inst.file_path) {
                    if let Some(rel) = maven_path(path) {
                        let out = libs2.join(rel);
                        if force || !out.is_file() {
                            let data = read_zip_entry(&mut z, file)?;
                            if let Some(p) = out.parent() {
                                std::fs::create_dir_all(p)?;
                            }
                            std::fs::write(&out, data)?;
                        }
                    }
                }
            }
            serde_json::to_vec(vi)?
        } else {
            let json_name = profile.json.clone().unwrap_or_else(|| "/version.json".into());
            // Daten-Dateien (/data/client.lzma …) für Processors entpacken
            for v in profile.data.values() {
                if let Some(c) = &v.client {
                    if c.starts_with('/') {
                        let data = read_zip_entry(&mut z, c)?;
                        let out = crate::util::safe_join(&tmp2, c).ctx("Pfad im Installer")?;
                        if let Some(p) = out.parent() {
                            std::fs::create_dir_all(p)?;
                        }
                        std::fs::write(&out, data)?;
                    }
                }
            }
            read_zip_entry(&mut z, &json_name)?
        };
        Ok((profile, version_bytes))
    })
    .await??;

    let result = run_install(state, &spec, &profile, &version_bytes, &installer, &tmp_root, java, sp).await;
    let _ = tokio::fs::remove_dir_all(&tmp_root).await;
    let (id, files) = result?;
    crate::util::write_json_atomic(&marker, &serde_json::json!({ "id": id, "full": full, "files": files }))?;
    Ok(id)
}

#[allow(clippy::too_many_arguments)]
async fn run_install(
    state: &AppState,
    spec: &ForgeSpec<'_>,
    profile: &InstallProfile,
    version_bytes: &[u8],
    installer: &Path,
    tmp_root: &Path,
    java: &Path,
    sp: &SubProgress,
) -> AppResult<(String, Vec<String>)> {
    let env = super::meta::Env::current();
    let libs_dir = state.paths.libraries();
    let mut version: serde_json::Value = serde_json::from_slice(version_bytes).ctx("version.json im Installer ungültig")?;
    let parsed: VersionJson = serde_json::from_value(version.clone()).ctx("version.json im Installer ungültig")?;
    let id = if parsed.id.is_empty() { profile.version.clone().unwrap_or_default() } else { parsed.id.clone() };
    if id.is_empty() {
        return Err(AppError::msg("Installer enthält keine Versions-ID"));
    }
    if parsed.inherits_from.is_none() {
        version["inheritsFrom"] = serde_json::Value::String(spec.mc.to_string());
    }
    // Legacy-Forge: alte Maven-URLs korrigieren, die eigentliche Forge-Library als lokal markieren
    if profile.version_info.is_some() {
        if let Some(libs) = version["libraries"].as_array_mut() {
            for l in libs.iter_mut() {
                let name = l["name"].as_str().unwrap_or_default().to_string();
                let is_forge = profile.install.as_ref().and_then(|i| i.path.as_deref()) == Some(name.as_str());
                if is_forge {
                    // Lokal vorhanden (aus dem Installer)
                    if let Some(rel) = maven_path(&name) {
                        l["downloads"] = serde_json::json!({ "artifact": { "path": rel.to_string_lossy().replace('\\', "/"), "url": "" } });
                    }
                } else if let Some(u) = l["url"].as_str() {
                    let fixed = u.replace("http://files.minecraftforge.net/maven", "https://maven.minecraftforge.net");
                    l["url"] = serde_json::Value::String(fixed);
                }
            }
        }
    }
    let path = state.paths.version_json(&id);
    crate::util::write_json_atomic(&path, &version)?;
    let parsed: VersionJson = super::meta::read_version_file(&path)?;

    // Libraries (Profil + Version) laden
    sp.message("Loader-Bibliotheken werden geladen …");
    let mut all_libs = profile.libraries.clone();
    all_libs.extend(parsed.libraries.iter().cloned());
    let (items, _local) = lib_download_items(&all_libs, &libs_dir, &env);
    state.net.download_all(items, Some(&sp.sub(0.0, 0.4))).await?;
    sp.check()?;

    // Processors
    let procs: Vec<&Processor> = profile
        .processors
        .iter()
        .filter(|p| p.sides.as_ref().map_or(true, |s| s.iter().any(|x| x == "client")))
        .collect();
    let mut produced = Vec::new();
    if !procs.is_empty() {
        let mc = profile.minecraft.clone().unwrap_or_else(|| spec.mc.to_string());
        let mc_jar = state.paths.version_jar(&mc);
        if !mc_jar.is_file() {
            return Err(AppError::msg("Minecraft-JAR fehlt für den Forge-Installer"));
        }
        let mut data: HashMap<String, String> = HashMap::new();
        for (k, v) in &profile.data {
            let Some(c) = &v.client else { continue };
            let val = if c.starts_with('[') && c.ends_with(']') {
                libs_dir.join(maven_path(&c[1..c.len() - 1]).ctx("Maven-Pfad")?).to_string_lossy().to_string()
            } else if c.starts_with('\'') && c.ends_with('\'') && c.len() >= 2 {
                c[1..c.len() - 1].to_string()
            } else if c.starts_with('/') {
                crate::util::safe_join(tmp_root, c).ctx("Pfad")?.to_string_lossy().to_string()
            } else {
                c.clone()
            };
            data.insert(k.clone(), val);
        }
        data.insert("SIDE".into(), "client".into());
        data.insert("MINECRAFT_JAR".into(), mc_jar.to_string_lossy().to_string());
        data.insert("MINECRAFT_VERSION".into(), mc.clone());
        data.insert("ROOT".into(), state.paths.meta().to_string_lossy().to_string());
        data.insert("INSTALLER".into(), installer.to_string_lossy().to_string());
        data.insert("LIBRARY_DIR".into(), libs_dir.to_string_lossy().to_string());

        let n = procs.len();
        for (i, p) in procs.into_iter().enumerate() {
            sp.check()?;
            sp.sub(0.4, 1.0).progress(i as f64 / n as f64);
            let task_name = p.args.iter().position(|a| a == "--task").and_then(|i| p.args.get(i + 1)).cloned().unwrap_or_else(|| {
                p.jar.split(':').nth(1).unwrap_or("processor").to_string()
            });
            sp.message(format!("Loader wird eingerichtet ({}/{n}: {task_name}) …", i + 1));
            // Outputs schon korrekt? Dann überspringen
            let outputs: Vec<(PathBuf, String)> = p
                .outputs
                .iter()
                .map(|(k, v)| (PathBuf::from(replace_tokens(k, &data, &libs_dir)), replace_tokens(v, &data, &libs_dir)))
                .collect();
            if !outputs.is_empty() && outputs_valid(&outputs).await {
                produced.extend(outputs.iter().map(|(p, _)| p.to_string_lossy().to_string()));
                continue;
            }
            run_processor(p, &data, &libs_dir, java).await?;
            if !outputs.is_empty() && !outputs_valid(&outputs).await {
                return Err(AppError::msg(format!("Forge-Installer: Ergebnis von {task_name} ist fehlerhaft (Prüfsumme). Bitte erneut versuchen.")));
            }
            produced.extend(outputs.iter().map(|(p, _)| p.to_string_lossy().to_string()));
        }
    }
    // Lokale Libraries (ohne URL) müssen jetzt existieren
    let (_, local) = lib_download_items(&parsed.libraries, &libs_dir, &env);
    for l in &local {
        if !l.is_file() {
            return Err(AppError::msg(format!("Loader-Datei fehlt nach der Installation: {}", l.display())));
        }
    }
    produced.extend(local.iter().map(|p| p.to_string_lossy().to_string()));
    sp.progress(1.0);
    Ok((id, produced))
}

async fn outputs_valid(outputs: &[(PathBuf, String)]) -> bool {
    for (path, sha) in outputs {
        let p = path.clone();
        let ok = tokio::task::spawn_blocking(move || crate::net::sha1_file(&p)).await.ok().and_then(|r| r.ok());
        match ok {
            Some(h) if h.eq_ignore_ascii_case(sha.trim()) => {}
            _ => return false,
        }
    }
    true
}

/// `{KEY}` durch Daten ersetzen, `[maven]` zu Library-Pfad, `'literal'` zu literal.
pub fn replace_tokens(s: &str, data: &HashMap<String, String>, libs: &Path) -> String {
    if s.starts_with('[') && s.ends_with(']') && s.len() > 2 {
        if let Some(rel) = maven_path(&s[1..s.len() - 1]) {
            return libs.join(rel).to_string_lossy().to_string();
        }
    }
    if s.starts_with('\'') && s.ends_with('\'') && s.len() >= 2 {
        return s[1..s.len() - 1].to_string();
    }
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(n) = chars.next() {
                out.push(n);
            }
        } else if c == '{' {
            let mut key = String::new();
            let mut closed = false;
            for n in chars.by_ref() {
                if n == '}' {
                    closed = true;
                    break;
                }
                key.push(n);
            }
            match (closed, data.get(&key)) {
                (true, Some(v)) => out.push_str(v),
                _ => {
                    out.push('{');
                    out.push_str(&key);
                    if closed {
                        out.push('}');
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn jar_main_class(jar: &Path) -> AppResult<String> {
    let f = std::fs::File::open(jar).map_err(|_| AppError::msg(format!("Processor fehlt: {}", jar.display())))?;
    let mut z = zip::ZipArchive::new(f)?;
    let mut e = z.by_name("META-INF/MANIFEST.MF")?;
    let mut s = String::new();
    e.read_to_string(&mut s)?;
    for line in s.lines() {
        if let Some(v) = line.strip_prefix("Main-Class:") {
            return Ok(v.trim().to_string());
        }
    }
    Err(AppError::msg(format!("Processor ohne Main-Class: {}", jar.display())))
}

async fn run_processor(p: &Processor, data: &HashMap<String, String>, libs: &Path, java: &Path) -> AppResult<()> {
    let jar = libs.join(maven_path(&p.jar).ctx("Processor-Pfad")?);
    let jar2 = jar.clone();
    let main = tokio::task::spawn_blocking(move || jar_main_class(&jar2)).await??;
    let sep = if cfg!(windows) { ";" } else { ":" };
    let mut cp = vec![jar.to_string_lossy().to_string()];
    for c in &p.classpath {
        cp.push(libs.join(maven_path(c).ctx("Classpath")?).to_string_lossy().to_string());
    }
    let args: Vec<String> = p.args.iter().map(|a| replace_tokens(a, data, libs)).collect();
    let java = super::java::console_java(java);
    let mut cmd = tokio::process::Command::new(&java);
    cmd.arg("-cp").arg(cp.join(sep)).arg(&main).args(&args);
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    cmd.current_dir(libs);
    #[cfg(windows)]
    cmd.creation_flags(super::java::CREATE_NO_WINDOW);
    tracing::info!("Forge-Processor: {main} {}", args.join(" "));
    let out = cmd.output().await.map_err(|e| AppError::msg(format!("Java für den Forge-Installer nicht startbar: {e}")))?;
    if !out.status.success() {
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        let tail: Vec<&str> = text.lines().rev().take(12).collect::<Vec<_>>().into_iter().rev().collect();
        tracing::error!("Processor {main} fehlgeschlagen:\n{text}");
        return Err(AppError::msg(format!("Forge-Installer-Schritt fehlgeschlagen ({main}):\n{}", tail.join("\n"))));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tokens() {
        let mut d = HashMap::new();
        d.insert("SIDE".to_string(), "client".to_string());
        d.insert("MAPPINGS".to_string(), "/x/m.txt".to_string());
        let libs = Path::new("L");
        assert_eq!(replace_tokens("{SIDE}", &d, libs), "client");
        assert_eq!(replace_tokens("--side={SIDE}", &d, libs), "--side=client");
        assert_eq!(replace_tokens("'abc'", &d, libs), "abc");
        assert_eq!(replace_tokens("{UNKNOWN}", &d, libs), "{UNKNOWN}");
        let p = replace_tokens("[net.minecraft:client:1.20.1-2023:srg]", &d, libs);
        assert!(p.replace('\\', "/").ends_with("net/minecraft/client/1.20.1-2023/client-1.20.1-2023-srg.jar"));
    }
}
