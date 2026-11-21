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

type ProbeCache = Mutex<HashMap<PathBuf, (SystemTime, JavaInstall)>>;
fn probe_cache() -> &'static ProbeCache {
    static C: OnceLock<ProbeCache> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// Java-Programm ausführen und Version/Hersteller/Architektur bestimmen.
pub async fn probe(path: &Path, managed: bool) -> AppResult<JavaInstall> {
    let meta = std::fs::metadata(path).map_err(|_| AppError::Invalid(format!("Java nicht gefunden: {}", path.display())))?;
    let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    if let Some((t, j)) = probe_cache().lock().get(path) {
        if *t == mtime {
            let mut j = j.clone();
            j.managed = managed;
            return Ok(j);
        }
    }
    let java = console_java(path);
    let mut cmd = tokio::process::Command::new(&java);
    cmd.args(["-XshowSettings:properties", "-version"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = tokio::time::timeout(Duration::from_secs(15), cmd.output())
        .await
        .map_err(|_| AppError::msg(format!("Java reagiert nicht: {}", path.display())))?
        .map_err(|e| AppError::msg(format!("Java konnte nicht gestartet werden ({}): {e}", path.display())))?;
    let text = format!("{}\n{}", String::from_utf8_lossy(&out.stderr), String::from_utf8_lossy(&out.stdout));
    let (version, vendor, arch) =
        parse_properties(&text).ok_or_else(|| AppError::msg(format!("{} ist keine gültige Java-Installation.", path.display())))?;
    let j = JavaInstall { path: path.to_string_lossy().to_string(), major: parse_major(&version), version, vendor, arch, managed };
    probe_cache().lock().insert(path.to_path_buf(), (mtime, j.clone()));
    Ok(j)
}

// ------------------------------------------------------------------ Suche

fn push_bin_candidates(dir: &Path, out: &mut Vec<PathBuf>) {
    // dir = Sammelordner (z. B. C:\Program Files\Java) -> Unterordner mit bin/
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        for bin in [p.join("bin"), p.join("Contents/Home/bin"), p.join("jre/bin")] {
            if let Some(x) = launcher_exe(&bin) {
                out.push(x);
                break;
            }
        }
    }
}

/// Verwaltete Runtimes unter `java/`.
pub fn managed_runtimes(java_root: &Path) -> Vec<(String, PathBuf)> {
    let mut v = Vec::new();
    let Ok(rd) = std::fs::read_dir(java_root) else { return v };
    for e in rd.flatten() {
        let dir = e.path();
        if !dir.join(MARKER).is_file() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if let Some(x) = find_bin_in(&dir) {
            v.push((name, x));
        }
    }
    v
}

fn find_bin_in(dir: &Path) -> Option<PathBuf> {
    for bin in [dir.join("bin"), dir.join("jre.bundle/Contents/Home/bin"), dir.join("Contents/Home/bin")] {
        if let Some(x) = launcher_exe(&bin) {
            return Some(x);
        }
    }
    None
}

fn system_candidates() -> Vec<PathBuf> {
    let mut c = Vec::new();
    if let Some(home) = std::env::var_os("JAVA_HOME") {
        if let Some(x) = launcher_exe(&PathBuf::from(home).join("bin")) {
            c.push(x);
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        for d in std::env::split_paths(&path) {
            if let Some(x) = launcher_exe(&d) {
                // Windows: "javapath"-Stubs von Oracle sind ok, werden geprüft
                c.push(x);
            }
        }
    }
    #[cfg(windows)]
    {
        let vendors = [
            "Java", "Eclipse Adoptium", "Eclipse Foundation", "AdoptOpenJDK", "Zulu", "Microsoft", "Amazon Corretto", "BellSoft",
            "Semeru", "IBM", "ojdkbuild", "RedHat", "Liberica", "SapMachine", "GraalVM",
        ];
        for root in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
            if let Some(pf) = std::env::var_os(root) {
                for v in vendors {
                    push_bin_candidates(&PathBuf::from(&pf).join(v), &mut c);
                }
            }
        }
        if let Some(home) = dirs::home_dir() {
            push_bin_candidates(&home.join(".jdks"), &mut c);
        }
        // Runtimes des offiziellen Minecraft-Launchers
        let mut mc_runtimes = Vec::new();
        if let Some(appdata) = dirs::data_dir() {
            mc_runtimes.push(appdata.join(".minecraft").join("runtime"));
        }
        if let Some(local) = dirs::data_local_dir() {
            mc_runtimes.push(local.join("Packages").join("Microsoft.4297127D64EC6_8wekyb3d8bbwe").join("LocalCache").join("Local").join("runtime"));
        }
        for r in mc_runtimes {
            // runtime/<component>/<platform>/<component>/bin
            if let Ok(rd) = std::fs::read_dir(&r) {
                for comp in rd.flatten() {
                    if let Ok(rd2) = std::fs::read_dir(comp.path()) {
                        for plat in rd2.flatten() {
                            if let Some(x) = find_bin_in(&plat.path().join(comp.file_name())) {
                                c.push(x);
                            }
                        }
                    }
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        push_bin_candidates(Path::new("/Library/Java/JavaVirtualMachines"), &mut c);
        if let Some(home) = dirs::home_dir() {
            push_bin_candidates(&home.join("Library/Java/JavaVirtualMachines"), &mut c);
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for d in ["/usr/lib/jvm", "/usr/lib64/jvm", "/opt/java", "/opt/jdk"] {
            push_bin_candidates(Path::new(d), &mut c);
        }
        if let Some(home) = dirs::home_dir() {
            push_bin_candidates(&home.join(".jdks"), &mut c);
            push_bin_candidates(&home.join(".sdkman/candidates/java"), &mut c);
        }
    }
    c
}

fn canonical(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// Alle Java-Installationen (verwaltete zuerst, dann System; neueste Version zuerst).
pub async fn list(state: &Core) -> Vec<JavaInstall> {
    let java_root = state.paths.java_root();
    let mut cands: Vec<(PathBuf, bool)> = managed_runtimes(&java_root).into_iter().map(|(_, p)| (p, true)).collect();
    cands.extend(tokio::task::spawn_blocking(system_candidates).await.unwrap_or_default().into_iter().map(|p| (p, false)));
    let mut seen = std::collections::HashSet::new();
    let cands: Vec<(PathBuf, bool)> = cands.into_iter().filter(|(p, _)| seen.insert(canonical(p))).collect();
    let probes = futures::future::join_all(cands.into_iter().map(|(p, m)| async move { probe(&p, m).await })).await;
    let mut out: Vec<JavaInstall> = probes.into_iter().filter_map(|r| r.ok()).collect();
    // Gleiche Installation über verschiedene Pfade (z. B. Oracle-javapath) zusammenfassen
    let mut seen_v = std::collections::HashSet::new();
    out.retain(|j| j.managed || seen_v.insert((j.version.clone(), j.vendor.clone(), j.arch.clone())));
    out.sort_by(|a, b| b.managed.cmp(&a.managed).then(b.major.cmp(&a.major)).then(a.path.cmp(&b.path)));
    out
}

// ------------------------------------------------------------------ Mojang-Runtimes

#[derive(Debug, Deserialize)]
struct RuntimeEntry {
    manifest: RuntimeManifestRef,
    version: RuntimeVersion,
}
#[derive(Debug, Deserialize)]
struct RuntimeManifestRef {
    sha1: Option<String>,
    url: String,
}
#[derive(Debug, Deserialize)]
struct RuntimeVersion {
    name: String,
}
#[derive(Debug, Deserialize)]
struct RuntimeManifest {
    files: HashMap<String, RuntimeFile>,
}
#[derive(Debug, Deserialize)]
struct RuntimeFile {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    executable: bool,
    #[serde(default)]
    downloads: Option<HashMap<String, RuntimeDl>>,
    #[serde(default)]
    target: Option<String>,
}
#[derive(Debug, Deserialize)]
struct RuntimeDl {
    sha1: Option<String>,
    size: Option<u64>,
    url: String,
}

fn mojang_platform() -> &'static str {
    match (super::meta::os_name(), super::meta::arch_name()) {
        ("windows", "x86") => "windows-x86",
        ("windows", "aarch64") => "windows-arm64",
        ("windows", _) => "windows-x64",
        ("osx", "aarch64") => "mac-os-arm64",
        ("osx", _) => "mac-os",
        ("linux", "x86") => "linux-i386",
        _ => "linux",
    }
}

type RuntimeIndex = HashMap<String, HashMap<String, Vec<RuntimeEntry>>>;

async fn runtime_index(state: &Core) -> AppResult<RuntimeIndex> {
    let cache = state.paths.meta().join("java-runtimes.json");
    match state.net.get_bytes(RUNTIMES_URL).await {
        Ok(b) => {
            let idx: RuntimeIndex = serde_json::from_slice(&b).ctx("Java-Liste von Mojang ungültig")?;
            let _ = tokio::fs::write(&cache, &b).await;
            Ok(idx)
        }
        Err(e) => {
            let b = tokio::fs::read(&cache).await.map_err(|_| AppError::msg(format!("Java-Liste nicht ladbar: {e}")))?;
            Ok(serde_json::from_slice(&b)?)
        }
    }
}

fn component_for_major(idx: &RuntimeIndex, major: u32) -> Option<String> {
    let plat = idx.get(mojang_platform())?;
    let preferred = match major {
        8 => "jre-legacy",
        16 => "java-runtime-alpha",
        17 => "java-runtime-gamma",
        21 => "java-runtime-delta",
        25 => "java-runtime-epsilon",
        _ => "",
    };
    if plat.get(preferred).is_some_and(|v| !v.is_empty()) {
        return Some(preferred.to_string());
    }
    let mut names: Vec<&String> = plat
        .iter()
        .filter(|(k, _)| !k.contains("snapshot") && (k.starts_with("java-runtime") || k.starts_with("jre")))
        .filter(|(_, v)| v.first().is_some_and(|e| parse_major(&e.version.name) == major))
        .map(|(k, _)| k)
        .collect();
    names.sort();
    names.last().map(|s| s.to_string())
}

/// Mojang-Runtime-Komponente installieren. Gibt Pfad zu java(w) zurück.
pub async fn install_mojang_component(state: &Core, component: &str, force: bool, sp: Option<&SubProgress>) -> AppResult<PathBuf> {
    let dir = state.paths.java_root().join(component);
    if !force && dir.join(MARKER).is_file() {
        if let Some(x) = find_bin_in(&dir) {
            return Ok(x);
        }
    }
    let idx = runtime_index(state).await?;
    let entry = idx
        .get(mojang_platform())
        .and_then(|p| p.get(component))
        .and_then(|v| v.first())
        .ok_or_else(|| AppError::msg(format!("Java-Komponente {component} gibt es für dieses System nicht.")))?;
    if let Some(sp) = sp {
        sp.message(format!("Java {} wird heruntergeladen …", entry.version.name));
    }
    let manifest_bytes = state.net.get_bytes(&entry.manifest.url).await?;
    if let Some(expected) = &entry.manifest.sha1 {
        use sha1::Digest;
        let got = hex::encode(sha1::Sha1::digest(&manifest_bytes));
        if !got.eq_ignore_ascii_case(expected) {
            return Err(AppError::msg("Java-Manifest: Prüfsumme falsch"));
        }
    }
    let manifest: RuntimeManifest = serde_json::from_slice(&manifest_bytes).ctx("Java-Manifest ungültig")?;
    let mut items = Vec::new();
    let mut executables = Vec::new();
    let mut links = Vec::new();
    for (rel, f) in &manifest.files {
        let Some(target) = crate::util::safe_join(&dir, rel) else { continue };
        match f.kind.as_str() {
            "directory" => {
                tokio::fs::create_dir_all(&target).await?;
            }
            "file" => {
                let Some(raw) = f.downloads.as_ref().and_then(|d| d.get("raw")) else { continue };
                if force {
                    verify_or_remove(&target, raw.sha1.as_deref()).await;
                }
                items.push(DownloadItem::new(&raw.url, &target).sha1(raw.sha1.clone()).size(raw.size));
                if f.executable {
                    executables.push(target);
                }
            }
            "link" => {
                if let Some(t) = &f.target {
                    links.push((target, t.clone()));
                }
            }
            _ => {}
        }
    }
    state.net.download_all(items, sp).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for e in &executables {
            let _ = std::fs::set_permissions(e, std::fs::Permissions::from_mode(0o755));
        }
        for (link, target) in &links {
            if !link.exists() {
                let _ = std::os::unix::fs::symlink(target, link);
            }
        }
    }
    #[cfg(not(unix))]
    let _ = (&executables, &links);
    let marker = serde_json::json!({ "component": component, "version": entry.version.name, "source": "mojang" });
    crate::util::write_json_atomic(&dir.join(MARKER), &marker)?;
    find_bin_in(&dir).ok_or_else(|| AppError::msg("Java wurde geladen, aber java.exe fehlt."))
}

async fn verify_or_remove(path: &Path, sha1: Option<&str>) {
    let Some(expected) = sha1 else { return };
    if !path.is_file() {
        return;
    }
    let p = path.to_path_buf();
    let ok = tokio::task::spawn_blocking(move || crate::net::sha1_file(&p))
        .await
        .ok()
        .and_then(|r| r.ok())
        .is_some_and(|h| h.eq_ignore_ascii_case(expected));
    if !ok {
        let _ = tokio::fs::remove_file(path).await;
    }
}

// ------------------------------------------------------------------ Adoptium

#[derive(Debug, Deserialize)]
struct AdoptiumAsset {
    binary: AdoptiumBinary,
    #[serde(default)]
    version: Option<AdoptiumVersion>,
}
#[derive(Debug, Deserialize)]
struct AdoptiumBinary {
    package: AdoptiumPackage,
}
#[derive(Debug, Deserialize)]
struct AdoptiumPackage {
    link: String,
    name: String,
    #[serde(default)]
    checksum: Option<String>,
    #[serde(default)]
    size: Option<u64>,
}
#[derive(Debug, Deserialize)]
struct AdoptiumVersion {
    #[serde(default)]
    openjdk_version: Option<String>,
}

pub async fn install_adoptium(state: &Core, major: u32, sp: Option<&SubProgress>) -> AppResult<PathBuf> {
    let dir = state.paths.java_root().join(format!("adoptium-{major}"));
    if dir.join(MARKER).is_file() {
        if let Some(x) = find_bin_in(&dir) {
            return Ok(x);
        }
    }
    let os = match super::meta::os_name() {
        "windows" => "windows",
        "osx" => "mac",
        _ => "linux",
    };
    let arch = match super::meta::arch_name() {
        "aarch64" => "aarch64",
        "x86" => "x86-32",
        _ => "x64",
    };
    let mut asset = None;
    for image in ["jre", "jdk"] {
        let url = format!("https://api.adoptium.net/v3/assets/latest/{major}/hotspot?architecture={arch}&image_type={image}&os={os}&vendor=eclipse");
        if let Ok(list) = state.net.get_json::<Vec<AdoptiumAsset>>(&url).await {
            if let Some(a) = list.into_iter().find(|a| a.binary.package.name.ends_with(".zip") || a.binary.package.name.ends_with(".tar.gz")) {
                asset = Some(a);
                break;
            }
        }
    }
    let asset = asset.ok_or_else(|| AppError::msg(format!("Java {major} ist zum Download nicht verfügbar.")))?;
    if let Some(sp) = sp {
        sp.message(format!("Java {major} (Adoptium) wird heruntergeladen …"));
    }
    let pkg = &asset.binary.package;
    let tmp = state.paths.tmp().join(format!("adoptium-{major}-{}", pkg.name));
    let _ = tokio::fs::remove_file(&tmp).await;
    state.net.download_all(vec![DownloadItem::new(&pkg.link, &tmp).size(pkg.size)], sp).await?;
    let checksum = pkg.checksum.clone();
    let name = pkg.name.clone();
    let dir2 = dir.clone();
    let tmp2 = tmp.clone();
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        if let Some(expected) = checksum {
            let got = crate::net::sha256_file(&tmp2)?;
            if !got.eq_ignore_ascii_case(&expected) {
                return Err(AppError::msg("Java-Download: Prüfsumme falsch"));
            }
        }
        if dir2.exists() {
            std::fs::remove_dir_all(&dir2)?;
        }
        std::fs::create_dir_all(&dir2)?;
        if name.ends_with(".zip") {
            extract_zip_strip(&tmp2, &dir2)?;
        } else {
            extract_targz_strip(&tmp2, &dir2)?;
        }
        Ok(())
    })
    .await??;
    let _ = tokio::fs::remove_file(&tmp).await;
    let version = asset.version.and_then(|v| v.openjdk_version).unwrap_or_else(|| major.to_string());
    crate::util::write_json_atomic(&dir.join(MARKER), &serde_json::json!({ "component": format!("adoptium-{major}"), "version": version, "source": "adoptium" }))?;
    find_bin_in(&dir).ok_or_else(|| AppError::msg("Java wurde entpackt, aber java.exe fehlt."))
}

/// ZIP entpacken und den obersten Ordner entfernen (jdk-21.0.5+11-jre/...).
fn extract_zip_strip(zip_path: &Path, dest: &Path) -> AppResult<()> {
    let f = std::fs::File::open(zip_path)?;
    let mut z = zip::ZipArchive::new(f)?;
    for i in 0..z.len() {
        let mut e = z.by_index(i)?;
        let name = e.name().replace('\\', "/");
        let rel = match name.split_once('/') {
            Some((_, r)) => r.to_string(),
            None => continue,
        };
        if rel.is_empty() {
            continue;
        }
        let Some(out) = crate::util::safe_join(dest, &rel) else { continue };
        if e.is_dir() {
            std::fs::create_dir_all(&out)?;
        } else {
            if let Some(p) = out.parent() {
                std::fs::create_dir_all(p)?;
            }
            let mut w = std::fs::File::create(&out)?;
            std::io::copy(&mut e, &mut w)?;
            #[cfg(unix)]
            if let Some(mode) = e.unix_mode() {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&out, std::fs::Permissions::from_mode(mode));
            }
        }
    }
    Ok(())
}

fn extract_targz_strip(path: &Path, dest: &Path) -> AppResult<()> {
    // tar.gz nur auf Unix (Adoptium liefert unter Windows ZIPs) – über das System-tar.
    let status = std::process::Command::new("tar")
        .arg("-xzf")
        .arg(path)
        .arg("-C")
        .arg(dest)
        .arg("--strip-components=1")
        .status()?;
    if !status.success() {
        return Err(AppError::msg("Java-Archiv konnte nicht entpackt werden"));
    }
    Ok(())
}

/// Java einer Hauptversion installieren (Mojang bevorzugt, sonst Adoptium).
pub async fn install_major(state: &Core, major: u32, sp: Option<&SubProgress>) -> AppResult<PathBuf> {
    match runtime_index(state).await {
        Ok(idx) => {
            if let Some(c) = component_for_major(&idx, major) {
                match install_mojang_component(state, &c, false, sp).await {
                    Ok(p) => return Ok(p),
                    Err(AppError::Cancelled) => return Err(AppError::Cancelled),
                    Err(e) => tracing::warn!("Mojang-Java {c} fehlgeschlagen, versuche Adoptium: {e}"),
                }
            }
        }
        Err(e) => tracing::warn!("Mojang-Java-Liste nicht verfügbar: {e}"),
    }
    install_adoptium(state, major, sp).await
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
mod tests {
    use super::*;
    #[test]
    fn majors() {
        assert_eq!(parse_major("1.8.0_392"), 8);
        assert_eq!(parse_major("21.0.5"), 21);
        assert_eq!(parse_major("17"), 17);
        assert_eq!(parse_major("25-ea"), 25);
    }
    #[test]
    fn props() {
        let out = "Property settings:\n    java.vendor = Eclipse Adoptium\n    java.version = 21.0.5\n    os.arch = amd64\n\nopenjdk version \"21.0.5\"";
        let (v, vendor, arch) = parse_properties(out).unwrap();
        assert_eq!(v, "21.0.5");
        assert_eq!(vendor.as_deref(), Some("Eclipse Adoptium"));
        assert_eq!(arch, "x64");
        let (v, _, _) = parse_properties("java version \"1.8.0_51\"\nJava(TM) SE Runtime").unwrap();
        assert_eq!(v, "1.8.0_51");
    }
}
