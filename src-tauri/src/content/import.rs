//! Import von Modpacks als neue Instanz: `.mrpack`, CurseForge-ZIP, `.vlpack`, Prism-/MultiMC-Export.
//! Außerdem `modpack_install` (Modpack von Modrinth/CurseForge laden und importieren).
//!
//! Das Spiel selbst (Vanilla/Loader/Java) wird hier **nicht** installiert (siehe docs/CONTRACT.md).
use super::index::{self, ContentIndex, IndexEntry};
use super::missing::{self, MissingEntry};
use super::{curseforge as cf, modrinth as mr, provider, *};
use crate::error::{AppError, AppResult};
use crate::instance::{Instance, InstallState, Loader, PackSource, PackSourceKind};
use crate::net::DownloadItem;
use crate::state::AppState;
use crate::tasks::{SubProgress, TaskHandle};
use crate::util::safe_join;
use serde::Deserialize;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct PackFile {
    /// Relativer Pfad im Spielordner
    pub path: String,
    pub url: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    /// (Quelle, Projekt-ID, Versions-/Datei-ID), falls bekannt
    pub origin: Option<(Source, String, String)>,
}

#[derive(Debug, Clone, Copy)]
pub struct CfRef {
    pub project_id: u64,
    pub file_id: u64,
    pub required: bool,
}

#[derive(Debug, Clone, Default)]
pub struct PrismSettings {
    pub min_memory_mb: Option<u32>,
    pub max_memory_mb: Option<u32>,
    pub jvm_args: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PackPlan {
    pub format: PackFormat,
    pub name: String,
    pub version_name: Option<String>,
    pub author: Option<String>,
    pub mc_version: String,
    pub loader: Loader,
    pub icon: Option<Vec<u8>>,
    /// Zip-Präfixe, deren Inhalt in den Spielordner kopiert wird (spätere überschreiben frühere)
    pub overrides: Vec<String>,
    pub files: Vec<PackFile>,
    pub cf_files: Vec<CfRef>,
    pub prism: Option<PrismSettings>,
    /// Anzahl Mods im Prism-Export (für die Vorschau)
    pub embedded_mods: u32,
}

impl PackPlan {
    pub fn file_count(&self) -> u32 {
        (self.files.len() + self.cf_files.iter().filter(|f| f.required).count()) as u32 + self.embedded_mods
    }
}

// ------------------------------------------------------------------ Formate

#[derive(Deserialize)]
struct MrIndex {
    #[serde(default)]
    name: String,
    #[serde(rename = "versionId", default)]
    version_id: Option<String>,
    #[serde(default)]
    files: Vec<MrIndexFile>,
    #[serde(default)]
    dependencies: HashMap<String, String>,
}

#[derive(Deserialize)]
struct MrIndexFile {
    path: String,
    #[serde(default)]
    hashes: HashMap<String, String>,
    #[serde(default)]
    env: Option<HashMap<String, String>>,
    #[serde(default)]
    downloads: Vec<String>,
    #[serde(rename = "fileSize", default)]
    file_size: Option<u64>,
}

#[derive(Deserialize)]
struct CfManifest {
    minecraft: CfManifestMc,
    #[serde(default)]
    name: String,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    files: Vec<CfManifestFile>,
    #[serde(default)]
    overrides: Option<String>,
}

#[derive(Deserialize)]
struct CfManifestMc {
    version: String,
    #[serde(rename = "modLoaders", default)]
    mod_loaders: Vec<CfManifestLoader>,
}

#[derive(Deserialize)]
struct CfManifestLoader {
    id: String,
    #[serde(default)]
    primary: bool,
}

#[derive(Deserialize)]
struct CfManifestFile {
    #[serde(rename = "projectID")]
    project_id: u64,
    #[serde(rename = "fileID")]
    file_id: u64,
    #[serde(default = "yes")]
    required: bool,
}

fn yes() -> bool {
    true
}

/// `vlpack.json` (siehe docs/VLPACK.md).
#[derive(Debug, Deserialize, serde::Serialize)]
pub struct VlPack {
    pub format_version: u32,
    pub name: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub mc_version: String,
    pub loader: Loader,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub files: Vec<VlFile>,
}

#[derive(Debug, Deserialize, serde::Serialize, Clone)]
pub struct VlFile {
    pub path: String,
    /// "modrinth" | "curseforge" | "url"
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_id: Option<String>,
    pub url: String,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
}

fn loader_from_mrpack(deps: &HashMap<String, String>) -> Loader {
    for (k, kind) in [("neoforge", LoaderKind::Neoforge), ("forge", LoaderKind::Forge), ("quilt-loader", LoaderKind::Quilt), ("fabric-loader", LoaderKind::Fabric)] {
        if let Some(v) = deps.get(k) {
            return Loader { kind, version: Some(v.clone()) };
        }
    }
    Loader { kind: LoaderKind::Vanilla, version: None }
}

/// CurseForge-Loader-ID (`forge-47.2.0`, `neoforge-21.1.77`, `fabric-0.15.7`, `quilt-0.25.0`) -> Loader.
pub fn loader_from_cf_id(id: &str, mc: &str) -> Loader {
    let (kind_s, ver) = id.split_once('-').unwrap_or((id, ""));
    let kind = match kind_s.to_ascii_lowercase().as_str() {
        "forge" => LoaderKind::Forge,
        "neoforge" => LoaderKind::Neoforge,
        "fabric" => LoaderKind::Fabric,
        "quilt" => LoaderKind::Quilt,
        _ => return Loader { kind: LoaderKind::Vanilla, version: None },
    };
    // Ältere NeoForge-IDs: "neoforge-1.20.1-47.1.79"
    let ver = ver.strip_prefix(&format!("{mc}-")).unwrap_or(ver);
    Loader { kind, version: Some(ver.to_string()).filter(|v| !v.is_empty()) }
}

pub fn cf_loader_id(l: &Loader) -> Option<String> {
    let v = l.version.as_deref()?;
    Some(match l.kind {
        LoaderKind::Vanilla => return None,
        LoaderKind::Forge => format!("forge-{v}"),
        LoaderKind::Neoforge => format!("neoforge-{v}"),
        LoaderKind::Fabric => format!("fabric-{v}"),
        LoaderKind::Quilt => format!("quilt-{v}"),
    })
}

/// Modrinth-CDN-URL -> (Projekt-ID, Versions-ID).
pub fn modrinth_ids_from_url(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix("https://cdn.modrinth.com/data/")?;
    let mut it = rest.split('/');
    let pid = it.next()?;
    if it.next()? != "versions" {
        return None;
    }
    let vid = it.next()?;
    it.next()?;
    Some((pid.to_string(), vid.to_string()))
}

fn check_rel(path: &str) -> AppResult<()> {
    if safe_join(Path::new("base"), path).is_none() {
        return Err(AppError::Invalid(format!("Das Pack enthält einen unzulässigen Pfad: {path}")));
    }
    Ok(())
}

fn parse_ini(text: &str) -> HashMap<String, String> {
    text.lines()
        .filter_map(|l| {
            let l = l.trim();
            if l.starts_with('[') || l.starts_with('#') || l.starts_with(';') {
                return None;
            }
            let (k, v) = l.split_once('=')?;
            Some((k.trim().to_string(), v.trim().to_string()))
        })
        .collect()
}

#[derive(Deserialize)]
struct MmcPack {
    #[serde(default)]
    components: Vec<MmcComponent>,
}

#[derive(Deserialize)]
struct MmcComponent {
    uid: String,
    #[serde(default)]
    version: Option<String>,
    #[serde(rename = "cachedVersion", default)]
    cached_version: Option<String>,
}

fn read_zip_file<R: std::io::Read + std::io::Seek>(zip: &mut zip::ZipArchive<R>, name: &str) -> Option<Vec<u8>> {
    let mut f = zip.by_name(name).ok()?;
    if f.size() > 64 * 1024 * 1024 {
        return None;
    }
    let mut v = Vec::new();
    f.read_to_end(&mut v).ok()?;
    Some(v)
}

fn json_of<T: serde::de::DeserializeOwned>(bytes: &[u8], what: &str) -> AppResult<T> {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    serde_json::from_slice(bytes).map_err(|e| AppError::Invalid(format!("{what} ist fehlerhaft: {e}")))
}

/// Datei analysieren (blockierend).
pub fn analyze(path: &Path) -> AppResult<PackPlan> {
    let f = std::fs::File::open(path).map_err(|e| AppError::NotFound(format!("{} ({e})", path.display())))?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(f)).map_err(|_| AppError::Invalid("Die Datei ist kein gültiges ZIP-Archiv / Modpack".into()))?;
    let names: Vec<String> = zip.file_names().map(str::to_string).collect();
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Import".into());

    if let Some(b) = read_zip_file(&mut zip, "modrinth.index.json") {
        let idx: MrIndex = json_of(&b, "modrinth.index.json")?;
        let mc = idx.dependencies.get("minecraft").cloned().ok_or_else(|| AppError::Invalid("mrpack ohne Minecraft-Version".into()))?;
        let mut files = Vec::new();
        for f in idx.files {
            if f.env.as_ref().and_then(|e| e.get("client")).is_some_and(|c| c == "unsupported") {
                continue;
            }
            check_rel(&f.path)?;
            let Some(url) = f.downloads.iter().find(|u| u.starts_with("https://") || u.starts_with("http://")).cloned() else {
                tracing::warn!("mrpack: {} ohne Download-URL übersprungen", f.path);
                continue;
            };
            let origin = modrinth_ids_from_url(&url).map(|(p, v)| (Source::Modrinth, p, v));
            files.push(PackFile { path: f.path, url, sha1: f.hashes.get("sha1").cloned(), size: f.file_size, origin });
        }
        return Ok(PackPlan {
            format: PackFormat::Mrpack,
            name: if idx.name.trim().is_empty() { stem } else { idx.name },
            version_name: idx.version_id,
            author: None,
            loader: loader_from_mrpack(&idx.dependencies),
            mc_version: mc,
            icon: read_zip_file(&mut zip, "icon.png").filter(|b| super::meta::image_mime(b).is_some()),
            overrides: vec!["overrides/".into(), "client-overrides/".into()],
            files,
            cf_files: vec![],
            prism: None,
            embedded_mods: 0,
        });
    }

    if let Some(b) = read_zip_file(&mut zip, "vlpack.json") {
        let p: VlPack = json_of(&b, "vlpack.json")?;
        if p.format_version > 1 {
            return Err(AppError::Invalid(format!("vlpack-Format {} wird von dieser Launcher-Version nicht unterstützt – bitte Launcher aktualisieren", p.format_version)));
        }
        let mut files = Vec::new();
        for f in p.files {
            check_rel(&f.path)?;
            let origin = match f.source.as_str() {
                "modrinth" => f.project_id.clone().zip(f.version_id.clone()).map(|(a, b)| (Source::Modrinth, a, b)),
                "curseforge" => f.project_id.clone().zip(f.file_id.clone().or(f.version_id.clone())).map(|(a, b)| (Source::Curseforge, a, b)),
                _ => None,
            };
            files.push(PackFile { path: f.path, url: f.url, sha1: f.sha1, size: f.size, origin });
        }
        let icon = p.icon.as_deref().and_then(|i| read_zip_file(&mut zip, i)).filter(|b| super::meta::image_mime(b).is_some());
        return Ok(PackPlan {
            format: PackFormat::Vlpack,
            name: p.name,
            version_name: p.version,
            author: p.author,
            mc_version: p.mc_version,
            loader: p.loader,
            icon,
            overrides: vec!["overrides/".into()],
            files,
            cf_files: vec![],
            prism: None,
            embedded_mods: 0,
        });
    }

    if let Some(b) = read_zip_file(&mut zip, "manifest.json") {
        if let Ok(m) = json_of::<CfManifest>(&b, "manifest.json") {
            let lid = m.minecraft.mod_loaders.iter().find(|l| l.primary).or(m.minecraft.mod_loaders.first()).map(|l| l.id.clone());
            let loader = lid.map(|id| loader_from_cf_id(&id, &m.minecraft.version)).unwrap_or(Loader { kind: LoaderKind::Vanilla, version: None });
            let ov = m.overrides.clone().filter(|o| !o.trim().is_empty()).unwrap_or_else(|| "overrides".into());
            check_rel(&ov)?;
            return Ok(PackPlan {
                format: PackFormat::Curseforge,
                name: if m.name.trim().is_empty() { stem } else { m.name },
                version_name: m.version,
                author: m.author.filter(|a| !a.is_empty()),
                mc_version: m.minecraft.version,
                loader,
                icon: None,
                overrides: vec![format!("{}/", ov.trim_end_matches('/'))],
                files: vec![],
                cf_files: m.files.iter().map(|f| CfRef { project_id: f.project_id, file_id: f.file_id, required: f.required }).collect(),
                prism: None,
                embedded_mods: 0,
            });
        }
    }

    // Prism/MultiMC: instance.cfg im Wurzelordner oder eine Ebene tiefer
    let cfg_name = names
        .iter()
        .filter(|n| n.ends_with("instance.cfg") && (n.as_str() == "instance.cfg" || (n.matches('/').count() == 1 && n.ends_with("/instance.cfg"))))
        .min_by_key(|n| n.len())
        .cloned();
    if let Some(cfg_name) = cfg_name {
        let root = cfg_name.strip_suffix("instance.cfg").unwrap_or("").to_string();
        let cfg_text = String::from_utf8_lossy(&read_zip_file(&mut zip, &cfg_name).unwrap_or_default()).to_string();
        let cfg = parse_ini(&cfg_text);
        let pack: Option<MmcPack> = read_zip_file(&mut zip, &format!("{root}mmc-pack.json")).and_then(|b| serde_json::from_slice(&b).ok());
        let mut mc = cfg.get("IntendedVersion").cloned().unwrap_or_default();
        let mut loader = Loader { kind: LoaderKind::Vanilla, version: None };
        if let Some(p) = &pack {
            for c in &p.components {
                let v = c.version.clone().or(c.cached_version.clone());
                match c.uid.as_str() {
                    "net.minecraft" => mc = v.unwrap_or_default(),
                    "net.fabricmc.fabric-loader" => loader = Loader { kind: LoaderKind::Fabric, version: v },
                    "org.quiltmc.quilt-loader" => loader = Loader { kind: LoaderKind::Quilt, version: v },
                    "net.minecraftforge" => loader = Loader { kind: LoaderKind::Forge, version: v },
                    "net.neoforged" => loader = Loader { kind: LoaderKind::Neoforge, version: v },
                    _ => {}
                }
            }
        }
        if mc.is_empty() {
            return Err(AppError::Invalid("Prism/MultiMC-Export ohne Minecraft-Version (mmc-pack.json fehlt)".into()));
        }
        let game = [".minecraft/", "minecraft/"].iter().map(|g| format!("{root}{g}")).find(|g| names.iter().any(|n| n.starts_with(g.as_str())));
        let embedded_mods = game.as_ref().map(|g| names.iter().filter(|n| n.starts_with(&format!("{g}mods/")) && n.ends_with(".jar")).count() as u32).unwrap_or(0);
        let icon = cfg
            .get("iconKey")
            .filter(|k| !k.is_empty() && k.as_str() != "default")
            .and_then(|k| read_zip_file(&mut zip, &format!("{root}{k}.png")))
            .filter(|b| super::meta::image_mime(b).is_some());
        let mem = |k: &str| cfg.get(k).and_then(|v| v.parse::<u32>().ok());
        let override_mem = cfg.get("OverrideMemory").is_some_and(|v| v == "true");
        let override_args = cfg.get("OverrideJavaArgs").is_some_and(|v| v == "true");
        let settings = PrismSettings {
            min_memory_mb: if override_mem { mem("MinMemAlloc") } else { None },
            max_memory_mb: if override_mem { mem("MaxMemAlloc") } else { None },
            jvm_args: if override_args { cfg.get("JvmArgs").cloned().filter(|s| !s.is_empty()) } else { None },
            notes: cfg.get("notes").cloned().filter(|s| !s.is_empty()),
        };
        let format = if cfg_text.contains("[General]") { PackFormat::Prism } else { PackFormat::Multimc };
        return Ok(PackPlan {
            format,
            name: cfg.get("name").cloned().filter(|n| !n.is_empty()).unwrap_or(stem),
            version_name: None,
            author: None,
            mc_version: mc,
            loader,
            icon,
            overrides: game.into_iter().collect(),
            files: vec![],
            cf_files: vec![],
            prism: Some(settings),
            embedded_mods,
        });
    }

    Err(AppError::Invalid(
        "Unbekanntes Format. Unterstützt werden .mrpack, CurseForge-Modpacks (.zip), .vlpack und Prism-/MultiMC-Exporte.".into(),
    ))
}

pub async fn preview(path: &str) -> AppResult<ImportPreview> {
    let p = PathBuf::from(path);
    let plan = tokio::task::spawn_blocking(move || analyze(&p)).await??;
    Ok(ImportPreview {
        format: plan.format,
        file_count: plan.file_count(),
        icon: plan.icon.as_deref().and_then(super::meta::data_url),
        name: plan.name,
        version_name: plan.version_name,
        mc_version: plan.mc_version,
        loader: plan.loader,
        author: plan.author,
    })
}

// ------------------------------------------------------------------ Ausführung

/// Zusätzliche Angaben (Modpack-Installation aus dem Katalog).
#[derive(Debug, Clone, Default)]
pub struct ImportOptions {
    pub name: Option<String>,
    pub source: Option<PackSource>,
    pub icon_url: Option<String>,
}

/// Overrides aus dem Archiv in den Spielordner entpacken (blockierend).
/// `progress` meldet 0..1 und liefert `Err(Cancelled)` bei Abbruch.
fn extract_overrides(zip_path: &Path, prefixes: &[String], game_dir: &Path, progress: &dyn Fn(f64) -> AppResult<()>) -> AppResult<()> {
    let f = std::fs::File::open(zip_path)?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(f))?;
    let total = (zip.len() * prefixes.len()).max(1);
    for (pi, prefix) in prefixes.iter().enumerate() {
        for i in 0..zip.len() {
            if i % 64 == 0 {
                progress((pi * zip.len() + i) as f64 / total as f64)?;
            }
            let mut entry = zip.by_index(i)?;
            let name = entry.name().replace('\\', "/");
            let Some(rel) = name.strip_prefix(prefix.as_str()) else { continue };
            if rel.is_empty() {
                continue;
            }
            let Some(target) = safe_join(game_dir, rel) else {
                return Err(AppError::Invalid(format!("Das Pack enthält einen unzulässigen Pfad: {name}")));
            };
            if entry.is_dir() {
                std::fs::create_dir_all(&target)?;
                continue;
            }
            if let Some(p) = target.parent() {
                std::fs::create_dir_all(p)?;
            }
            let mut out = std::fs::File::create(&target)?;
            std::io::copy(&mut entry, &mut out)?;
        }
    }
    progress(1.0)
}

fn new_instance(name: String, plan: &PackPlan, source: Option<PackSource>) -> Instance {
    let mut inst = Instance {
        id: String::new(),
        name,
        icon: None,
        accent: None,
        group: None,
        mc_version: plan.mc_version.clone(),
        loader: plan.loader.clone(),
        java: Default::default(),
        window: Default::default(),
        source,
        install_state: InstallState::NotInstalled,
        version_id: None,
        created_at: crate::util::now_ms(),
        last_played: None,
        play_time_secs: 0,
        notes: None,
    };
    if let Some(p) = &plan.prism {
        inst.java.min_memory_mb = p.min_memory_mb;
        inst.java.max_memory_mb = p.max_memory_mb;
        inst.java.jvm_args = p.jvm_args.clone();
        inst.notes = p.notes.clone();
    }
    inst
}

fn pack_source_kind(f: PackFormat) -> PackSourceKind {
    match f {
        PackFormat::Mrpack => PackSourceKind::Modrinth,
        PackFormat::Curseforge => PackSourceKind::Curseforge,
        PackFormat::Vlpack => PackSourceKind::Vlpack,
        PackFormat::Prism | PackFormat::Multimc => PackSourceKind::Prism,
    }
}

struct ResolvedCf {
    files: Vec<PackFile>,
    missing: Vec<MissingEntry>,
    warnings: Vec<String>,
}

/// CurseForge-Manifest auflösen: Datei-Infos + Projekte (Klasse -> Zielordner).
async fn resolve_cf(state: &AppState, refs: &[CfRef]) -> AppResult<ResolvedCf> {
    let refs: Vec<&CfRef> = refs.iter().filter(|r| r.required).collect();
    let file_ids: Vec<u64> = refs.iter().map(|r| r.file_id).collect();
    let mod_ids: Vec<u64> = refs.iter().map(|r| r.project_id).collect::<HashSet<_>>().into_iter().collect();
    let files: HashMap<u64, cf::CfFile> = cf::raw_files_by_id(state, &file_ids).await?.into_iter().map(|f| (f.id, f)).collect();
    let mods: HashMap<u64, cf::CfMod> = cf::raw_mods(state, &mod_ids).await?.into_iter().map(|m| (m.id, m)).collect();
    let mut out = ResolvedCf { files: vec![], missing: vec![], warnings: vec![] };
    for r in refs {
        let Some(f) = files.get(&r.file_id) else {
            out.warnings.push(format!("CurseForge-Datei {} (Projekt {}) nicht gefunden", r.file_id, r.project_id));
            continue;
        };
        let m = mods.get(&r.project_id);
        let kind = cf::kind_of_class(m.and_then(|m| m.class_id));
        let file_name = crate::paths::sanitize_file_name(&f.file_name);
        let path = format!("{}/{file_name}", kind.folder());
        match f.download_url.clone().filter(|u| !u.is_empty()) {
            Some(url) => out.files.push(PackFile {
                path,
                url,
                sha1: f.sha1(),
                size: Some(f.file_length).filter(|s| *s > 0),
                origin: Some((Source::Curseforge, r.project_id.to_string(), r.file_id.to_string())),
            }),
            None => out.missing.push(MissingEntry {
                info: MissingDownload {
                    file_name,
                    project_name: m.map(|m| m.name.clone()).unwrap_or_else(|| format!("Projekt {}", r.project_id)),
                    page_url: m
                        .map(|m| cf::file_page_url(m, r.file_id))
                        .unwrap_or_else(|| format!("https://www.curseforge.com/projects/{}", r.project_id)),
                    kind,
                },
                sha1: f.sha1(),
                project_id: Some(r.project_id.to_string()),
                file_id: Some(r.file_id.to_string()),
            }),
        }
    }
    Ok(out)
}

async fn set_icon_bytes(state: &AppState, instance_id: &str, bytes: &[u8]) -> AppResult<()> {
    let ext = match super::meta::image_mime(bytes) {
        Some("image/png") => "png",
        Some("image/jpeg") => "jpg",
        Some("image/gif") => "gif",
        Some("image/webp") => "webp",
        _ => return Ok(()),
    };
    let dest = state.paths.instance_dir(instance_id).join(format!("icon.{ext}"));
    tokio::fs::write(&dest, bytes).await?;
    let s = dest.to_string_lossy().to_string();
    state.instances.modify(instance_id, |i| i.icon = Some(s))?;
    Ok(())
}

/// Importiert eine Pack-Datei als neue Instanz. Gibt die Instanz-ID zurück.
pub async fn run_import(state: &AppState, task: &TaskHandle, path: &Path, opts: ImportOptions, sub: SubProgress) -> AppResult<String> {
    sub.message("Analysiere Pack …");
    let p = path.to_path_buf();
    let plan = tokio::task::spawn_blocking(move || analyze(&p)).await??;
    task.check()?;

    // CurseForge vorab auflösen (braucht Key) – vor dem Anlegen der Instanz
    let mut cf_res = ResolvedCf { files: vec![], missing: vec![], warnings: vec![] };
    if plan.format == PackFormat::Curseforge && !plan.cf_files.is_empty() {
        cf::key(state)?;
        sub.message(format!("Löse {} CurseForge-Dateien auf …", plan.cf_files.len()));
        cf_res = resolve_cf(state, &plan.cf_files).await?;
        // Gesperrte Downloads: identische Datei (gleicher SHA-1) von Modrinth laden, falls vorhanden
        let sha1s: Vec<String> = cf_res.missing.iter().filter_map(|m| m.sha1.clone()).collect();
        let mirrors = mr::mirrors(state, &sha1s).await;
        if !mirrors.is_empty() {
            let mut still = Vec::new();
            for m in std::mem::take(&mut cf_res.missing) {
                match m.sha1.as_ref().and_then(|h| mirrors.get(&h.to_ascii_lowercase())) {
                    Some(mi) => cf_res.files.push(PackFile {
                        path: format!("{}/{}", m.info.kind.folder(), m.info.file_name),
                        url: mi.url.clone(),
                        sha1: m.sha1.clone(),
                        size: Some(mi.size),
                        origin: Some((Source::Modrinth, mi.project_id.clone(), mi.version_id.clone())),
                    }),
                    None => still.push(m),
                }
            }
            cf_res.missing = still;
        }
    }
    task.check()?;

    let name = opts.name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| plan.name.clone());
    let source = opts.source.clone().or_else(|| {
        Some(PackSource { kind: pack_source_kind(plan.format), project_id: None, version_id: None, name: Some(plan.name.clone()), version_name: plan.version_name.clone() })
    });
    let inst = state.instances.insert_new(new_instance(name.clone(), &plan, source))?;
    task.set_instance(inst.id.clone());
    if opts.source.is_none() {
        task.set_title(format!("{name} importieren"));
    }

    let res = async {
        let game_dir = state.paths.game_dir(&inst.id);
        // Overrides
        if !plan.overrides.is_empty() {
            sub.message("Entpacke Dateien …");
            let zp = path.to_path_buf();
            let prefixes = plan.overrides.clone();
            let gd = game_dir.clone();
            let s = sub.sub(0.0, 0.2);
            tokio::task::spawn_blocking(move || {
                extract_overrides(&zp, &prefixes, &gd, &|p| {
                    s.progress(p);
                    s.check()
                })
            })
            .await??;
        }
        task.check()?;
        // Downloads
        let mut files = plan.files.clone();
        files.extend(cf_res.files.iter().cloned());
        let mut items = Vec::new();
        for f in &files {
            let target = safe_join(&game_dir, &f.path).ok_or_else(|| AppError::Invalid(format!("Unzulässiger Pfad: {}", f.path)))?;
            items.push(DownloadItem::new(f.url.clone(), target).sha1(f.sha1.clone()).size(f.size));
        }
        sub.message(format!("Lade {} Datei(en) …", items.len()));
        state.net.download_all(items, Some(&sub.sub(0.2, 0.95))).await?;
        task.check()?;

        // Index (Herkunft bekannter Dateien) + fehlende Downloads
        {
            let lock = state.content.lock(&inst.id);
            let _g = lock.lock().await;
            let mut idx = ContentIndex::load(&state.paths, &inst.id);
            for f in &files {
                let Some((source, pid, vid)) = &f.origin else { continue };
                let rel = f.path.replace('\\', "/");
                let Some((folder, file)) = rel.split_once('/') else { continue };
                if ContentKind::from_folder(folder).is_none() || file.contains('/') {
                    continue;
                }
                idx.files.insert(
                    index::key(folder, file),
                    IndexEntry {
                        source: *source,
                        project_id: pid.clone(),
                        version_id: vid.clone(),
                        sha1: f.sha1.clone(),
                        sha512: None,
                        title: None,
                        icon_url: None,
                        version_number: None,
                        url: Some(f.url.clone()),
                        size: f.size,
                        date: None,
                        release_type: None,
                    },
                );
            }
            idx.save(&state.paths, &inst.id)?;
        }
        missing::add(&state.paths, &inst.id, cf_res.missing.clone())?;

        // Icon
        let icon = match (&plan.icon, &opts.icon_url) {
            (Some(b), _) => Some(b.to_vec()),
            (None, Some(url)) => state.net.get_bytes(url).await.ok().map(|b| b.to_vec()),
            _ => None,
        };
        if let Some(b) = icon {
            if let Err(e) = set_icon_bytes(state, &inst.id, &b).await {
                tracing::warn!("Icon für {} nicht gesetzt: {e}", inst.id);
            }
        }
        sub.progress(1.0);
        Ok::<(), AppError>(())
    }
    .await;

    match res {
        Ok(()) => {
            for w in &cf_res.warnings {
                tracing::warn!("Import {}: {w}", inst.id);
            }
            let n = plan.files.len() + cf_res.files.len();
            let mut msg = if n == 0 { "Import abgeschlossen".to_string() } else { format!("{n} Datei(en) geladen") };
            if !cf_res.missing.is_empty() {
                msg.push_str(&format!(", {} manuell herunterzuladen", cf_res.missing.len()));
            }
            task.message(msg);
            state.content.emit_changed(&inst.id);
            Ok(inst.id)
        }
        Err(e) => {
            if let Err(de) = state.instances.delete(&inst.id) {
                tracing::warn!("Halb importierte Instanz {} nicht entfernt: {de}", inst.id);
            }
            Err(e)
        }
    }
}

/// Task-Körper von `import_pack`.
pub async fn run_import_task(state: AppState, task: TaskHandle, path: String, name: Option<String>) -> AppResult<()> {
    let sub = task.sub(0.0, 1.0);
    run_import(&state, &task, Path::new(&path), ImportOptions { name, ..Default::default() }, sub).await?;
    Ok(())
}

/// Task-Körper von `modpack_install`.
pub async fn run_modpack_install(state: AppState, task: TaskHandle, source: Source, project_id: String, version_id: Option<String>) -> AppResult<()> {
    task.stage("Lade Modpack-Informationen …", None);
    let brief = provider::brief(&state, source, &project_id).await?;
    if brief.project_type != ProjectType::Modpack {
        return Err(AppError::Invalid(format!("{} ist kein Modpack", brief.title)));
    }
    task.set_title(format!("Modpack {} installieren", brief.title));
    let (version, file) = match source {
        Source::Modrinth => {
            let v = match &version_id {
                Some(v) => mr::convert_version(mr::raw_version(&state, v).await?),
                None => {
                    let mut list: Vec<ProjectVersion> = mr::raw_versions(&state, &brief.id).await?.into_iter().map(mr::convert_version).collect();
                    list.sort_by(|a, b| b.date.cmp(&a.date));
                    provider::pick_best(&list, None).ok_or_else(|| AppError::NotFound(format!("keine Version von {}", brief.title)))?
                }
            };
            let file = v
                .files
                .iter()
                .find(|f| f.primary && f.filename.ends_with(".mrpack"))
                .or_else(|| v.files.iter().find(|f| f.filename.ends_with(".mrpack")))
                .cloned()
                .ok_or_else(|| AppError::msg(format!("{} {}: keine .mrpack-Datei", brief.title, v.version_number)))?;
            (v, file)
        }
        Source::Curseforge => {
            cf::key(&state)?;
            let f = match &version_id {
                Some(v) => cf::raw_file(&state, &brief.id, v).await?,
                None => {
                    let mut files = cf::raw_files(&state, &brief.id, None, None).await?;
                    files.retain(|f| f.is_server_pack != Some(true) && f.is_available != Some(false));
                    cf::sort_files(&mut files);
                    files.iter().find(|f| f.release_type == 1).or(files.first()).cloned().ok_or_else(|| AppError::NotFound(format!("keine Datei von {}", brief.title)))?
                }
            };
            let v = cf::convert_file(&f);
            let file = v.files[0].clone();
            (v, file)
        }
    };
    let Some(url) = file.url.clone() else {
        return Err(AppError::msg(format!(
            "Der Autor von {} erlaubt keine Downloads über andere Launcher. Lade das Modpack auf {} herunter und importiere die Datei.",
            brief.title,
            format_args!("{}/files/{}", brief.page_url.trim_end_matches('/'), version.id)
        )));
    };
    task.check()?;
    let ext = if source == Source::Modrinth { "mrpack" } else { "zip" };
    let tmp = state.paths.tmp().join(format!("{}.{ext}", uuid::Uuid::new_v4()));
    task.stage(format!("Lade {} …", file.filename), Some(0.0));
    let dl = state
        .net
        .download_all(vec![DownloadItem::new(url, tmp.clone()).sha1(file.sha1.clone()).size(Some(file.size).filter(|s| *s > 0))], Some(&task.sub(0.0, 0.15)))
        .await;
    let res = match dl {
        Ok(()) => {
            let opts = ImportOptions {
                name: Some(brief.title.clone()),
                source: Some(PackSource {
                    kind: if source == Source::Modrinth { PackSourceKind::Modrinth } else { PackSourceKind::Curseforge },
                    project_id: Some(brief.id.clone()),
                    version_id: Some(version.id.clone()),
                    name: Some(brief.title.clone()),
                    version_name: Some(version.version_number.clone()),
                }),
                icon_url: brief.icon_url.clone(),
            };
            run_import(&state, &task, &tmp, opts, task.sub(0.15, 1.0)).await.map(|_| ())
        }
        Err(e) => Err(e),
    };
    let _ = tokio::fs::remove_file(&tmp).await;
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_zip(path: &Path, files: &[(&str, &[u8])]) {
        let f = std::fs::File::create(path).unwrap();
        let mut w = zip::ZipWriter::new(f);
        for (n, d) in files {
            if n.ends_with('/') {
                w.add_directory(n.trim_end_matches('/'), zip::write::SimpleFileOptions::default()).unwrap();
            } else {
                w.start_file(*n, zip::write::SimpleFileOptions::default()).unwrap();
                w.write_all(d).unwrap();
            }
        }
        w.finish().unwrap();
    }

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("vl-import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn cf_loader_ids() {
        assert_eq!(loader_from_cf_id("forge-47.2.0", "1.20.1"), Loader { kind: LoaderKind::Forge, version: Some("47.2.0".into()) });
        assert_eq!(loader_from_cf_id("neoforge-1.20.1-47.1.79", "1.20.1"), Loader { kind: LoaderKind::Neoforge, version: Some("47.1.79".into()) });
        assert_eq!(loader_from_cf_id("neoforge-21.1.77", "1.21.1"), Loader { kind: LoaderKind::Neoforge, version: Some("21.1.77".into()) });
        assert_eq!(loader_from_cf_id("fabric-0.15.7", "1.20.1").kind, LoaderKind::Fabric);
        assert_eq!(loader_from_cf_id("quilt-0.25.0", "1.20.1").version.as_deref(), Some("0.25.0"));
        assert_eq!(cf_loader_id(&Loader { kind: LoaderKind::Forge, version: Some("47.2.0".into()) }).as_deref(), Some("forge-47.2.0"));
    }

    #[test]
    fn modrinth_url() {
        assert_eq!(
            modrinth_ids_from_url("https://cdn.modrinth.com/data/AANobbMI/versions/OihdIimA/sodium-fabric-0.5.13%2Bmc1.20.1.jar"),
            Some(("AANobbMI".into(), "OihdIimA".into()))
        );
        assert_eq!(modrinth_ids_from_url("https://github.com/x/y.jar"), None);
    }

    #[test]
    fn analyze_mrpack() {
        let d = tmp();
        let p = d.join("pack.mrpack");
        let index = br#"{"formatVersion":1,"game":"minecraft","versionId":"1.2.3","name":"Test Pack","summary":"x",
          "files":[
            {"path":"mods/a.jar","hashes":{"sha1":"aa","sha512":"bb"},"env":{"client":"required","server":"required"},"downloads":["https://cdn.modrinth.com/data/P1/versions/V1/a.jar"],"fileSize":10},
            {"path":"mods/server-only.jar","hashes":{"sha1":"cc"},"env":{"client":"unsupported","server":"required"},"downloads":["https://x/s.jar"],"fileSize":10}
          ],
          "dependencies":{"minecraft":"1.20.1","fabric-loader":"0.15.7"}}"#;
        write_zip(&p, &[("modrinth.index.json", index), ("overrides/config/a.txt", b"x"), ("client-overrides/options.txt", b"y")]);
        let plan = analyze(&p).unwrap();
        assert_eq!(plan.format, PackFormat::Mrpack);
        assert_eq!(plan.name, "Test Pack");
        assert_eq!(plan.mc_version, "1.20.1");
        assert_eq!(plan.loader, Loader { kind: LoaderKind::Fabric, version: Some("0.15.7".into()) });
        assert_eq!(plan.files.len(), 1, "Server-only-Datei wird übersprungen");
        assert_eq!(plan.files[0].origin, Some((Source::Modrinth, "P1".into(), "V1".into())));
        assert_eq!(plan.file_count(), 1);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn mrpack_zip_slip_rejected() {
        let d = tmp();
        let p = d.join("evil.mrpack");
        let index = br#"{"formatVersion":1,"name":"Evil","files":[{"path":"../../evil.exe","hashes":{},"downloads":["https://x/e"]}],"dependencies":{"minecraft":"1.20.1"}}"#;
        write_zip(&p, &[("modrinth.index.json", index)]);
        assert!(matches!(analyze(&p), Err(AppError::Invalid(_))));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn extract_and_zip_slip() {
        let d = tmp();
        let p = d.join("p.mrpack");
        write_zip(&p, &[("overrides/config/a.txt", b"1"), ("overrides/options.txt", b"o"), ("client-overrides/options.txt", b"c"), ("other/x", b"x")]);
        let gd = d.join("game");
        extract_overrides(&p, &["overrides/".into(), "client-overrides/".into()], &gd, &|_| Ok(())).unwrap();
        assert_eq!(std::fs::read(gd.join("config/a.txt")).unwrap(), b"1");
        assert_eq!(std::fs::read(gd.join("options.txt")).unwrap(), b"c", "client-overrides gewinnt");
        assert!(!gd.join("x").exists());
        let evil = d.join("evil.mrpack");
        write_zip(&evil, &[("overrides/../escape.txt", b"x")]);
        assert!(extract_overrides(&evil, &["overrides/".into()], &gd, &|_| Ok(())).is_err());
        assert!(!d.join("escape.txt").exists());
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn analyze_curseforge() {
        let d = tmp();
        let p = d.join("cf.zip");
        let manifest = br#"{"minecraft":{"version":"1.20.1","modLoaders":[{"id":"forge-47.2.0","primary":true}]},"manifestType":"minecraftModpack","manifestVersion":1,
          "name":"All the Mods","version":"0.2.1","author":"ATM Team","files":[{"projectID":238222,"fileID":4712866,"required":true},{"projectID":1,"fileID":2,"required":false}],"overrides":"overrides"}"#;
        write_zip(&p, &[("manifest.json", manifest), ("overrides/config/x.toml", b"a=1"), ("modlist.html", b"<ul></ul>")]);
        let plan = analyze(&p).unwrap();
        assert_eq!(plan.format, PackFormat::Curseforge);
        assert_eq!(plan.name, "All the Mods");
        assert_eq!(plan.author.as_deref(), Some("ATM Team"));
        assert_eq!(plan.loader, Loader { kind: LoaderKind::Forge, version: Some("47.2.0".into()) });
        assert_eq!(plan.cf_files.len(), 2);
        assert_eq!(plan.file_count(), 1);
        assert_eq!(plan.overrides, vec!["overrides/"]);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn analyze_vlpack() {
        let d = tmp();
        let p = d.join("x.vlpack");
        let json = br#"{"format_version":1,"name":"Mein Pack","version":"1.0","author":"Ich","description":"d","mc_version":"1.21.1",
          "loader":{"kind":"neoforge","version":"21.1.77"},"icon":"icon.png",
          "files":[{"path":"mods/a.jar","source":"modrinth","project_id":"P","version_id":"V","url":"https://cdn.modrinth.com/data/P/versions/V/a.jar","sha1":"aa","size":3},
                   {"path":"mods/b.jar","source":"curseforge","project_id":"1","file_id":"2","url":"https://edge.forgecdn.net/files/2/b.jar","sha1":"bb","size":3},
                   {"path":"config/c.json","source":"url","url":"https://example.com/c.json","sha1":null,"size":null}]}"#;
        write_zip(&p, &[("vlpack.json", json), ("icon.png", b"\x89PNG\r\n\x1a\n...."), ("overrides/options.txt", b"x")]);
        let plan = analyze(&p).unwrap();
        assert_eq!(plan.format, PackFormat::Vlpack);
        assert_eq!(plan.loader.kind, LoaderKind::Neoforge);
        assert!(plan.icon.is_some());
        assert_eq!(plan.files[1].origin, Some((Source::Curseforge, "1".into(), "2".into())));
        assert_eq!(plan.files[2].origin, None);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn analyze_prism_nested() {
        let d = tmp();
        let p = d.join("prism.zip");
        let cfg = b"[General]\nConfigVersion=1.2\nname=Meine Prism-Instanz\niconKey=flame\nOverrideMemory=true\nMaxMemAlloc=6144\nMinMemAlloc=1024\nnotes=Hallo\n";
        let pack = br#"{"components":[{"uid":"net.minecraft","version":"1.20.1"},{"uid":"net.fabricmc.intermediary","version":"1.20.1"},{"uid":"net.fabricmc.fabric-loader","version":"0.15.7"}],"formatVersion":1}"#;
        write_zip(
            &p,
            &[
                ("Meine/instance.cfg", cfg),
                ("Meine/mmc-pack.json", pack),
                ("Meine/flame.png", b"\x89PNG\r\n\x1a\n...."),
                ("Meine/.minecraft/mods/a.jar", b"PK"),
                ("Meine/.minecraft/options.txt", b"x"),
            ],
        );
        let plan = analyze(&p).unwrap();
        assert_eq!(plan.format, PackFormat::Prism);
        assert_eq!(plan.name, "Meine Prism-Instanz");
        assert_eq!(plan.mc_version, "1.20.1");
        assert_eq!(plan.loader, Loader { kind: LoaderKind::Fabric, version: Some("0.15.7".into()) });
        assert_eq!(plan.overrides, vec!["Meine/.minecraft/"]);
        assert_eq!(plan.embedded_mods, 1);
        assert!(plan.icon.is_some());
        let s = plan.prism.unwrap();
        assert_eq!(s.max_memory_mb, Some(6144));
        assert_eq!(s.notes.as_deref(), Some("Hallo"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn unknown_format() {
        let d = tmp();
        let p = d.join("x.zip");
        write_zip(&p, &[("readme.txt", b"x")]);
        assert!(matches!(analyze(&p), Err(AppError::Invalid(_))));
        std::fs::remove_dir_all(&d).ok();
    }
}
