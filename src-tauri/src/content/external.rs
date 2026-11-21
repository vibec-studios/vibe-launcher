//! Import direkt aus anderen Launchern: Modrinth App, Prism/MultiMC, CurseForge App, ATLauncher,
//! NoRisk Client (siehe [`super::norisk`]) oder ein beliebiger Spielordner.
//!
//! Fremde Ordner werden **nur gelesen**. Die SQLite-Datenbank der Modrinth App (WAL-Modus, App läuft
//! evtl.) wird vor dem Lesen samt `-wal`/`-shm` nach `cache/tmp/` kopiert.
use super::extsettings::{self, ExtSettings};
use super::import::{loader_from_cf_id, parse_ini, prism_info};
use super::{ExternalInstance, ExternalLauncher, LauncherKind};
use crate::error::{AppError, AppResult};
use crate::instance::{InstallState, Instance, Loader, LoaderKind, PackSource, PackSourceKind};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const WARN_GUESSED: &str = "Version und Loader wurden aus den Mods geschätzt – bitte prüfen.";
const WARN_UNKNOWN: &str = "Minecraft-Version unbekannt – bitte vor dem Import angeben.";
const WARN_VERSIONS: &str = "Version aus dem Ordner versions geschätzt (zuletzt gestartet) – bitte prüfen.";

/// Erkannte Instanz inkl. interner Angaben für den Import.
#[derive(Debug, Clone)]
pub struct Found {
    pub info: ExternalInstance,
    /// Spielordner (`.minecraft`)
    pub game_dir: PathBuf,
    pub icon_path: Option<PathBuf>,
    pub pack: Option<PackSource>,
    /// Einstellungen der Instanz im fremden Launcher (siehe [`super::extsettings`])
    pub settings: ExtSettings,
    /// NoRisk: was übernommen/installiert wird
    pub norisk: Option<super::norisk::Plan>,
    /// Zusätzliche Quellen im Spielordner (NoRisk Sync Packs), siehe [`super::srctree`]
    pub overlays: Vec<super::srctree::Overlay>,
}

pub(crate) fn launcher_name(k: LauncherKind) -> &'static str {
    match k {
        LauncherKind::Modrinth => "Modrinth App",
        LauncherKind::Prism => "Prism Launcher",
        LauncherKind::Multimc => "MultiMC",
        LauncherKind::Curseforge => "CurseForge",
        LauncherKind::Atlauncher => "ATLauncher",
        LauncherKind::Gdlauncher => "GDLauncher",
        LauncherKind::Norisk => "NoRisk Client",
        LauncherKind::Folder => "Ordner",
    }
}

fn s(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

/// Pfad für Vergleiche normalisieren (Groß-/Kleinschreibung, Trenner).
pub fn norm(p: &str) -> String {
    let p = p.replace('/', "\\");
    let p = p.trim_end_matches('\\');
    if cfg!(windows) {
        p.to_lowercase()
    } else {
        p.replace('\\', "/")
    }
}

fn ms(v: i64) -> i64 {
    // Sekunden oder Millisekunden?
    if v > 0 && v < 100_000_000_000 {
        v * 1000
    } else {
        v
    }
}

fn icon_data(p: Option<&Path>) -> Option<String> {
    let p = p?;
    let m = std::fs::metadata(p).ok()?;
    if m.len() > 2 * 1024 * 1024 {
        return None;
    }
    super::meta::data_url(&std::fs::read(p).ok()?)
}

fn count_mods(game_dir: &Path) -> u32 {
    let Ok(rd) = std::fs::read_dir(game_dir.join("mods")) else { return 0 };
    rd.flatten()
        .filter(|e| {
            let n = e.file_name().to_string_lossy().to_ascii_lowercase();
            n.ends_with(".jar") || n.ends_with(".jar.disabled")
        })
        .count() as u32
}

pub(crate) fn found(name: String, game_dir: PathBuf, source_path: &Path, mc: String, loader: Loader, icon_path: Option<PathBuf>) -> Found {
    Found {
        info: ExternalInstance {
            source_path: s(source_path),
            name,
            mc_version: mc,
            loader,
            icon: icon_data(icon_path.as_deref()),
            mod_count: count_mods(&game_dir),
            last_played: None,
            play_time_secs: None,
            size: None,
            warning: None,
            imported_as: None,
            settings: None,
        },
        game_dir,
        icon_path,
        pack: None,
        settings: ExtSettings::default(),
        norisk: None,
        overlays: Vec::new(),
    }
}

fn vanilla() -> Loader {
    Loader { kind: LoaderKind::Vanilla, version: None }
}

fn parse_loader(kind: &str, version: Option<String>) -> Loader {
    match LoaderKind::parse(kind) {
        Some(LoaderKind::Vanilla) | None => vanilla(),
        Some(k) => Loader { kind: k, version: version.filter(|v| !v.is_empty()) },
    }
}

// ------------------------------------------------------------------ Schätzen aus dem Ordner

fn version_in(s: &str) -> Option<String> {
    let re = regex::Regex::new(r"\d+\.\d+(\.\d+)?").ok()?;
    // Minecraft hat keine "x.y.0"-Versionen ("1.21.0" heißt "1.21")
    re.find(s).map(|m| m.as_str().strip_suffix(".0").filter(|v| v.matches('.').count() == 1).unwrap_or(m.as_str()).to_string())
}

/// Loader + Minecraft-Version aus den Mod-Metadaten schätzen (höchstens 25 JARs).
pub fn infer(game_dir: &Path) -> (String, Loader) {
    let Ok(rd) = std::fs::read_dir(game_dir.join("mods")) else { return (String::new(), vanilla()) };
    let mut loaders: HashMap<LoaderKind, u32> = HashMap::new();
    let mut versions: HashMap<String, u32> = HashMap::new();
    let jars: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("jar"))).take(25).collect();
    for jar in jars {
        let Ok(f) = std::fs::File::open(&jar) else { continue };
        let Ok(mut z) = zip::ZipArchive::new(std::io::BufReader::new(f)) else { continue };
        let mut read = |n: &str| -> Option<Vec<u8>> {
            use std::io::Read;
            let mut e = z.by_name(n).ok()?;
            let mut v = Vec::new();
            e.read_to_end(&mut v).ok()?;
            Some(v)
        };
        if let Some(v) = read("fabric.mod.json").and_then(|b| super::meta::lenient_json(&b)) {
            *loaders.entry(LoaderKind::Fabric).or_default() += 1;
            let dep = v.get("depends").and_then(|d| d.get("minecraft"));
            let txt = match dep {
                Some(Value::String(s)) => Some(s.clone()),
                Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str()).next().map(str::to_string),
                _ => None,
            };
            if let Some(v) = txt.as_deref().and_then(version_in) {
                *versions.entry(v).or_default() += 1;
            }
        } else if read("quilt.mod.json").is_some() {
            *loaders.entry(LoaderKind::Quilt).or_default() += 1;
        } else if let Some((kind, t)) = read("META-INF/neoforge.mods.toml").map(|t| (LoaderKind::Neoforge, t)).or_else(|| read("META-INF/mods.toml").map(|t| (LoaderKind::Forge, t))) {
            *loaders.entry(kind).or_default() += 1;
            let text = String::from_utf8_lossy(&t);
            // [[dependencies.x]] modId="minecraft" ... versionRange="[1.20.1,1.21)"
            if let Some(pos) = text.find("modId=\"minecraft\"").or_else(|| text.find("modId = \"minecraft\"")) {
                let rest = &text[pos..text.len().min(pos + 400)];
                if let Some(vr) = rest.find("versionRange") {
                    if let Some(v) = version_in(&rest[vr..rest.len().min(vr + 60)]) {
                        *versions.entry(v).or_default() += 1;
                    }
                }
            }
        }
    }
    let loader = loaders.into_iter().max_by_key(|(_, n)| *n).map(|(k, _)| Loader { kind: k, version: None }).unwrap_or_else(vanilla);
    // "1.20" (aus ">=1.20") zählt für die spezifischste passende Version ("1.20.1")
    let keys: Vec<String> = versions.keys().cloned().collect();
    for k in &keys {
        let prefix = format!("{k}.");
        if let Some(best) = keys.iter().filter(|o| o.starts_with(&prefix)).max_by_key(|o| versions.get(*o).copied().unwrap_or(0)).cloned() {
            if let Some(n) = versions.remove(k) {
                *versions.entry(best).or_default() += n;
            }
        }
    }
    let mc = versions.into_iter().max_by(|a, b| a.1.cmp(&b.1).then(a.0.len().cmp(&b.0.len())).then(a.0.cmp(&b.0))).map(|(v, _)| v).unwrap_or_default();
    (mc, loader)
}

fn with_guess(mut f: Found) -> Found {
    let (mc, loader) = infer(&f.game_dir);
    f.info.mc_version = mc;
    f.info.loader = loader;
    f.info.warning = Some(if f.info.mc_version.is_empty() { WARN_UNKNOWN } else { WARN_GUESSED }.into());
    f
}

// ------------------------------------------------------------------ Modrinth App

pub fn modrinth_roots() -> Vec<PathBuf> {
    let Some(d) = dirs::data_dir() else { return vec![] };
    ["ModrinthApp", "com.modrinth.theseus"].iter().map(|n| d.join(n)).filter(|p| p.join("app.db").is_file() || p.join("profiles").is_dir()).collect()
}

/// Datenbank samt WAL in den Cache kopieren (nur bei Änderung) und öffnen.
fn open_db_copy(root: &Path, tmp: &Path) -> Option<rusqlite::Connection> {
    open_db_copy_named(root, tmp, "modrinth-db")
}

/// `<root>/app.db` (+ `-wal`/`-shm`) nach `tmp/<prefix>-<hash>/` kopieren und die Kopie öffnen.
pub(crate) fn open_db_copy_named(root: &Path, tmp: &Path, prefix: &str) -> Option<rusqlite::Connection> {
    let db = root.join("app.db");
    if !db.is_file() {
        return None;
    }
    let stamp_of = |p: &Path| std::fs::metadata(p).ok().map(|m| format!("{}:{:?}", m.len(), m.modified().ok())).unwrap_or_default();
    let stamp = format!("{}|{}", stamp_of(&db), stamp_of(&root.join("app.db-wal")));
    let key = hex::encode(<sha1::Sha1 as sha1::Digest>::digest(norm(&s(root)).as_bytes()));
    let dir = tmp.join(format!("{prefix}-{}", &key[..12]));
    let stamp_file = dir.join("stamp");
    if std::fs::read_to_string(&stamp_file).ok().as_deref() != Some(stamp.as_str()) {
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).ok()?;
        for ext in ["", "-wal", "-shm"] {
            let src = root.join(format!("app.db{ext}"));
            if src.is_file() {
                if let Err(e) = std::fs::copy(&src, dir.join(format!("app.db{ext}"))) {
                    tracing::warn!("Modrinth-DB nicht kopierbar ({}): {e}", src.display());
                    if ext.is_empty() {
                        return None;
                    }
                }
            }
        }
        if let Ok(c) = rusqlite::Connection::open(dir.join("app.db")) {
            scrub_secrets(&c);
        }
        let _ = std::fs::write(&stamp_file, &stamp);
    }
    // Kopie gehört uns – normal öffnen (WAL wird dabei in die Kopie übernommen)
    rusqlite::Connection::open(dir.join("app.db")).map_err(|e| tracing::warn!("Modrinth-DB nicht lesbar: {e}")).ok()
}

const SECRET_TABLES: &[&str] = &["minecraft_users", "minecraft_device_tokens", "modrinth_users", "accounts", "credentials"];

fn scrub_secrets(c: &rusqlite::Connection) {
    let _ = c.execute_batch("PRAGMA secure_delete = ON;");
    for t in SECRET_TABLES {
        if has_table(c, t) {
            let _ = c.execute(&format!("DELETE FROM \"{t}\""), []);
        }
    }
    let _ = c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
}

#[derive(Debug, Default, Clone)]
struct MrRow {
    path: String,
    name: String,
    icon_path: Option<String>,
    last_played: Option<i64>,
    played: i64,
    game_version: Option<String>,
    loader: Option<String>,
    loader_version: Option<String>,
    project_id: Option<String>,
    version_id: Option<String>,
}

fn has_table(c: &rusqlite::Connection, t: &str) -> bool {
    c.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1", [t], |r| r.get::<_, i64>(0)).unwrap_or(0) > 0
}

fn columns(c: &rusqlite::Connection, t: &str) -> Vec<String> {
    let Ok(mut st) = c.prepare(&format!("PRAGMA table_info({t})")) else { return vec![] };
    st.query_map([], |r| r.get::<_, String>(1)).map(|it| it.flatten().collect()).unwrap_or_default()
}

fn mr_rows(c: &rusqlite::Connection) -> Vec<MrRow> {
    let col = |cols: &[String], name: &str, fallback: &str| if cols.iter().any(|c| c == name) { name.to_string() } else { fallback.to_string() };
    // Neues Schema: instances + instance_content_sets (+ instance_links)
    if has_table(c, "instances") && has_table(c, "instance_content_sets") {
        let ic = columns(c, "instances");
        let links = has_table(c, "instance_links");
        let sql = format!(
            "SELECT i.path, i.name, {icon}, {lp}, {sp} + {rp}, s.game_version, s.loader, s.loader_version, {pid}, {vid}
             FROM instances i LEFT JOIN instance_content_sets s ON s.id = i.applied_content_set_id {join}",
            icon = col(&ic, "icon_path", "NULL"),
            lp = col(&ic, "last_played", "NULL"),
            sp = col(&ic, "submitted_time_played", "0"),
            rp = col(&ic, "recent_time_played", "0"),
            pid = if links { "l.modrinth_project_id" } else { "NULL" },
            vid = if links { "l.modrinth_version_id" } else { "NULL" },
            join = if links { "LEFT JOIN instance_links l ON l.instance_id = i.id AND l.link_kind = 'modrinth_modpack'" } else { "" },
        );
        if let Ok(mut st) = c.prepare(&sql) {
            let rows = st.query_map([], |r| {
                Ok(MrRow {
                    path: r.get(0)?,
                    name: r.get(1)?,
                    icon_path: r.get(2)?,
                    last_played: r.get(3)?,
                    played: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                    game_version: r.get(5)?,
                    loader: r.get(6)?,
                    loader_version: r.get(7)?,
                    project_id: r.get(8)?,
                    version_id: r.get(9)?,
                })
            });
            match rows {
                Ok(it) => return it.flatten().collect(),
                Err(e) => tracing::warn!("Modrinth-DB (instances): {e}"),
            }
        }
    }
    // Älteres Schema: profiles
    if has_table(c, "profiles") {
        let pc = columns(c, "profiles");
        let sql = format!(
            "SELECT path, name, {icon}, {lp}, {sp} + {rp}, {gv}, {ml}, {mlv}, {pid}, {vid} FROM profiles",
            icon = col(&pc, "icon_path", "NULL"),
            lp = col(&pc, "last_played", "NULL"),
            sp = col(&pc, "submitted_time_played", "0"),
            rp = col(&pc, "recent_time_played", "0"),
            gv = col(&pc, "game_version", "NULL"),
            ml = col(&pc, "mod_loader", "NULL"),
            mlv = col(&pc, "mod_loader_version", "NULL"),
            pid = col(&pc, "linked_project_id", "NULL"),
            vid = col(&pc, "linked_version_id", "NULL"),
        );
        if let Ok(mut st) = c.prepare(&sql) {
            if let Ok(it) = st.query_map([], |r| {
                Ok(MrRow {
                    path: r.get(0)?,
                    name: r.get(1)?,
                    icon_path: r.get(2)?,
                    last_played: r.get(3)?,
                    played: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                    game_version: r.get(5)?,
                    loader: r.get(6)?,
                    loader_version: r.get(7)?,
                    project_id: r.get(8)?,
                    version_id: r.get(9)?,
                })
            }) {
                return it.flatten().collect();
            }
        }
    }
    vec![]
}

/// Sehr alte Modrinth-App: `profile.json` je Profilordner.
fn mr_profile_json(dir: &Path) -> Option<MrRow> {
    let v: Value = serde_json::from_slice(&std::fs::read(dir.join("profile.json")).ok()?).ok()?;
    let m = v.get("metadata")?;
    let st = |v: Option<&Value>| v.and_then(|x| x.as_str()).map(str::to_string);
    let linked = m.get("linked_data");
    Some(MrRow {
        path: dir.file_name()?.to_string_lossy().to_string(),
        name: st(m.get("name")).unwrap_or_default(),
        icon_path: st(m.get("icon")),
        last_played: m.get("last_played").and_then(|x| x.as_i64().or_else(|| x.as_str().and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.timestamp()))),
        played: v.get("submitted_time_played").and_then(|x| x.as_i64()).unwrap_or(0) + v.get("recent_time_played").and_then(|x| x.as_i64()).unwrap_or(0),
        game_version: st(m.get("game_version")),
        loader: st(m.get("loader")),
        loader_version: m.get("loader_version").and_then(|lv| lv.get("id").and_then(|x| x.as_str()).map(str::to_string).or_else(|| lv.as_str().map(str::to_string))),
        project_id: linked.and_then(|l| st(l.get("project_id"))),
        version_id: linked.and_then(|l| st(l.get("version_id"))),
    })
}

fn modrinth_scan(root: &Path, tmp: &Path) -> Vec<Found> {
    let conn = open_db_copy(root, tmp);
    let rows: Vec<MrRow> = conn.as_ref().map(mr_rows).unwrap_or_default();
    // Eigener Datenordner (Einstellung "custom_dir")
    let custom: Option<PathBuf> = conn
        .as_ref()
        .filter(|c| columns(c, "settings").iter().any(|x| x == "custom_dir"))
        .and_then(|c| c.query_row("SELECT custom_dir FROM settings LIMIT 1", [], |r| r.get::<_, Option<String>>(0)).ok().flatten())
        .map(PathBuf::from)
        .filter(|p| p.join("profiles").is_dir());
    let base = custom.unwrap_or_else(|| root.to_path_buf());
    let settings: HashMap<String, ExtSettings> = conn.as_ref().map(extsettings::modrinth_all).unwrap_or_default();
    let by_path: HashMap<String, MrRow> = rows.into_iter().map(|r| (r.path.to_lowercase(), r)).collect();
    let Ok(rd) = std::fs::read_dir(base.join("profiles")) else { return vec![] };
    let dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    // Parallel auswerten (Icons lesen, ggf. Mods für die Schätzung öffnen)
    let n = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 8);
    let chunk = dirs.len().div_ceil(n).max(1);
    std::thread::scope(|sc| {
        let handles: Vec<_> = dirs.chunks(chunk).map(|c| sc.spawn(|| c.iter().map(|d| modrinth_profile(d, &by_path, &settings)).collect::<Vec<_>>())).collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    })
}

fn modrinth_profile(dir: &Path, by_path: &HashMap<String, MrRow>, settings: &HashMap<String, ExtSettings>) -> Found {
    let mut f = modrinth_profile_inner(dir, by_path);
    let key = dir.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    f.settings = match settings.get(&key) {
        Some(s) => s.clone(),
        None => std::fs::read(dir.join("profile.json")).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).map(|v| extsettings::modrinth_profile_json(&v)).unwrap_or_default(),
    };
    f
}

fn modrinth_profile_inner(dir: &Path, by_path: &HashMap<String, MrRow>) -> Found {
    let dir = dir.to_path_buf();
    let folder = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    {
        let row = by_path.get(&folder.to_lowercase()).cloned().or_else(|| mr_profile_json(&dir));
        match row {
            Some(r) => {
                let loader = parse_loader(r.loader.as_deref().unwrap_or("vanilla"), r.loader_version.clone());
                let icon = r.icon_path.as_ref().map(PathBuf::from).filter(|p| p.is_file());
                let mut f = found(if r.name.trim().is_empty() { folder.clone() } else { r.name.clone() }, dir.clone(), &dir, r.game_version.clone().unwrap_or_default(), loader, icon);
                f.info.last_played = r.last_played.filter(|v| *v > 0).map(ms);
                f.info.play_time_secs = Some(r.played.max(0) as u64).filter(|v| *v > 0);
                if let Some(pid) = r.project_id.clone() {
                    f.pack = Some(PackSource { kind: PackSourceKind::Modrinth, project_id: Some(pid), version_id: r.version_id.clone(), name: Some(f.info.name.clone()), version_name: None });
                }
                if f.info.mc_version.is_empty() {
                    with_guess(f)
                } else {
                    f
                }
            }
            None => with_guess(found(folder.clone(), dir.clone(), &dir, String::new(), vanilla(), None)),
        }
    }
}

// ------------------------------------------------------------------ Prism / MultiMC

pub fn prism_roots() -> Vec<(LauncherKind, PathBuf)> {
    let Some(d) = dirs::data_dir() else { return vec![] };
    let mut v: Vec<(LauncherKind, PathBuf)> = vec![(LauncherKind::Prism, d.join("PrismLauncher")), (LauncherKind::Prism, d.join("PolyMC"))];
    if let Some(l) = dirs::data_local_dir() {
        v.push((LauncherKind::Prism, l.join("PrismLauncher")));
    }
    v.into_iter().filter(|(_, p)| p.is_dir()).collect()
}

/// Instanzordner eines Prism-/MultiMC-Wurzelordners (`InstanceDir` aus der Konfiguration).
fn prism_instances_dir(root: &Path) -> PathBuf {
    for cfg in ["prismlauncher.cfg", "polymc.cfg", "multimc.cfg"] {
        if let Ok(t) = std::fs::read_to_string(root.join(cfg)) {
            if let Some(v) = t.lines().find_map(|l| l.trim().strip_prefix("InstanceDir=")) {
                let p = PathBuf::from(v.trim());
                return if p.is_absolute() { p } else { root.join(p) };
            }
        }
    }
    root.join("instances")
}

fn prism_icons_dir(root: &Path) -> PathBuf {
    for cfg in ["prismlauncher.cfg", "polymc.cfg", "multimc.cfg"] {
        if let Ok(t) = std::fs::read_to_string(root.join(cfg)) {
            if let Some(v) = t.lines().find_map(|l| l.trim().strip_prefix("IconsDir=")) {
                let p = PathBuf::from(v.trim());
                return if p.is_absolute() { p } else { root.join(p) };
            }
        }
    }
    root.join("icons")
}

/// Globale Standardwerte, die eine Prism-Instanz erbt (nur diese Schlüssel; API-Schlüssel, Proxy-Passwort usw.
/// der Launcher-Konfiguration werden verworfen).
const PRISM_GLOBAL_KEYS: &[&str] =
    &["MinMemAlloc", "MaxMemAlloc", "JvmArgs", "MinecraftWinWidth", "MinecraftWinHeight", "PreLaunchCommand", "WrapperCommand", "PostExitCommand", "Env"];

/// `prismlauncher.cfg`/`polymc.cfg`/`multimc.cfg` der Wurzel (angegeben oder oberhalb des Instanzordners).
fn prism_global(dir: &Path, root: Option<&Path>) -> HashMap<String, String> {
    let mut cands: Vec<&Path> = root.into_iter().collect();
    cands.extend(dir.ancestors().skip(1).take(2));
    for c in cands {
        for cfg in ["prismlauncher.cfg", "polymc.cfg", "multimc.cfg"] {
            if let Ok(t) = std::fs::read_to_string(c.join(cfg)) {
                let mut m = parse_ini(&t);
                m.retain(|k, _| PRISM_GLOBAL_KEYS.contains(&k.as_str()));
                return m;
            }
        }
    }
    HashMap::new()
}

pub fn prism_one(dir: &Path, icons_dir: Option<&Path>) -> Option<(Found, LauncherKind)> {
    prism_one_in(dir, icons_dir, None)
}

fn prism_one_in(dir: &Path, icons_dir: Option<&Path>, root: Option<&Path>) -> Option<(Found, LauncherKind)> {
    let cfg = std::fs::read_to_string(dir.join("instance.cfg")).ok()?;
    let pack = std::fs::read(dir.join("mmc-pack.json")).ok();
    let info = prism_info(&cfg, pack.as_deref());
    let game_dir = [".minecraft", "minecraft"].iter().map(|g| dir.join(g)).find(|p| p.is_dir()).unwrap_or_else(|| dir.join(".minecraft"));
    let icon = info.icon_key.as_ref().and_then(|k| {
        let mut cands: Vec<PathBuf> = Vec::new();
        for base in icons_dir.into_iter().chain(std::iter::once(dir)) {
            for ext in ["png", "jpg", "jpeg", "gif", "webp"] {
                cands.push(base.join(format!("{k}.{ext}")));
            }
            cands.push(base.join(k));
        }
        cands.into_iter().find(|p| p.is_file())
    });
    let name = info.name.clone().unwrap_or_else(|| dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
    let mut f = found(name, game_dir, dir, info.mc_version.clone(), info.loader.clone(), icon);
    f.info.last_played = info.last_launch;
    f.info.play_time_secs = info.total_time.filter(|t| *t > 0);
    let map = parse_ini(&cfg);
    let folder = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let group = dir.parent().and_then(|p| extsettings::prism_group(p, &folder));
    f.settings = extsettings::prism(&map, &prism_global(dir, root), group);
    f.pack = extsettings::prism_pack(&map);
    if f.info.mc_version.is_empty() {
        f = with_guess(f);
    }
    let kind = if info.format == super::PackFormat::Multimc { LauncherKind::Multimc } else { LauncherKind::Prism };
    Some((f, kind))
}

fn prism_scan(instances: &Path, icons: Option<&Path>, root: Option<&Path>) -> Vec<Found> {
    let Ok(rd) = std::fs::read_dir(instances) else { return vec![] };
    rd.flatten()
        .filter(|e| !e.file_name().to_string_lossy().starts_with('_') && !e.file_name().to_string_lossy().starts_with('.'))
        .filter_map(|e| prism_one_in(&e.path(), icons, root).map(|(f, _)| f))
        .collect()
}

// ------------------------------------------------------------------ CurseForge App

pub fn curseforge_roots() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(h) = dirs::home_dir() {
        v.push(h.join("curseforge").join("minecraft").join("Instances"));
    }
    if let Some(d) = dirs::document_dir() {
        v.push(d.join("Curse").join("Minecraft").join("Instances"));
    }
    v.into_iter().filter(|p| p.is_dir()).collect()
}

pub fn curseforge_one(dir: &Path) -> Option<Found> {
    let v: Value = serde_json::from_slice(&std::fs::read(dir.join("minecraftinstance.json")).ok()?).ok()?;
    let st = |x: Option<&Value>| x.and_then(|x| x.as_str()).map(str::to_string).filter(|s| !s.is_empty());
    let name = st(v.get("name")).or_else(|| dir.file_name().map(|n| n.to_string_lossy().to_string()))?;
    let mc = st(v.get("gameVersion")).or_else(|| st(v.get("baseModLoader").and_then(|b| b.get("minecraftVersion")))).unwrap_or_default();
    let loader = st(v.get("baseModLoader").and_then(|b| b.get("name"))).map(|id| loader_from_cf_id(&id, &mc)).unwrap_or_else(vanilla);
    let icon = st(v.get("profileImagePath")).map(PathBuf::from).filter(|p| p.is_file());
    let mut f = found(name, dir.to_path_buf(), dir, mc, loader, icon);
    f.settings = extsettings::curseforge(&v);
    f.info.last_played = st(v.get("lastPlayed")).and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok()).map(|d| d.timestamp_millis()).filter(|v| *v > 0);
    if let Some(mp) = v.get("installedModpack").filter(|m| !m.is_null()) {
        let pid = mp.get("addonID").and_then(|x| x.as_u64()).map(|x| x.to_string());
        let fid = mp.get("installedFile").and_then(|f| f.get("id")).and_then(|x| x.as_u64()).map(|x| x.to_string());
        if pid.is_some() {
            f.pack = Some(PackSource { kind: PackSourceKind::Curseforge, project_id: pid, version_id: fid, name: Some(f.info.name.clone()), version_name: None });
        }
    }
    if f.info.mc_version.is_empty() {
        f = with_guess(f);
    }
    Some(f)
}

fn curseforge_scan(dir: &Path) -> Vec<Found> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    rd.flatten().filter_map(|e| curseforge_one(&e.path())).collect()
}

// ------------------------------------------------------------------ ATLauncher

pub fn atlauncher_roots() -> Vec<PathBuf> {
    let Some(d) = dirs::data_dir() else { return vec![] };
    [d.join("ATLauncher").join("instances")].into_iter().filter(|p| p.is_dir()).collect()
}

pub fn atlauncher_one(dir: &Path) -> Option<Found> {
    let v: Value = serde_json::from_slice(&std::fs::read(dir.join("instance.json")).ok()?).ok()?;
    let l = v.get("launcher")?;
    let st = |x: Option<&Value>| x.and_then(|x| x.as_str()).map(str::to_string).filter(|s| !s.is_empty());
    let name = st(l.get("name")).or_else(|| dir.file_name().map(|n| n.to_string_lossy().to_string()))?;
    let mc = st(v.get("id")).filter(|s| s.chars().next().is_some_and(|c| c.is_ascii_digit())).or_else(|| st(l.get("minecraftVersion"))).unwrap_or_default();
    let lv = l.get("loaderVersion");
    let loader = lv.and_then(|lv| st(lv.get("type"))).map(|t| parse_loader(&t, lv.and_then(|lv| st(lv.get("version"))))).unwrap_or_else(vanilla);
    let icon = [dir.join("instance.png")].into_iter().find(|p| p.is_file());
    let mut f = found(name, dir.to_path_buf(), dir, mc, loader, icon);
    f.info.last_played = l.get("lastPlayed").and_then(|x| x.as_i64().or_else(|| x.as_str().and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.timestamp_millis()))).filter(|v| *v > 0).map(ms);
    f.info.play_time_secs = l.get("totalPlayTime").and_then(|x| x.as_u64()).filter(|v| *v > 0);
    f.settings = extsettings::atlauncher(l, extsettings::atlauncher_global(dir).as_ref());
    f.pack = extsettings::atlauncher_pack(l);
    if f.info.mc_version.is_empty() {
        f = with_guess(f);
    }
    Some(f)
}

fn atlauncher_scan(dir: &Path) -> Vec<Found> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    rd.flatten().filter_map(|e| atlauncher_one(&e.path())).collect()
}

// ------------------------------------------------------------------ Beliebiger Ordner

fn looks_like_game_dir(p: &Path) -> bool {
    ["mods", "saves", "options.txt", "config", "resourcepacks"].iter().any(|n| p.join(n).exists())
}

fn folder_one(dir: &Path) -> Option<Found> {
    let game = if dir.join(".minecraft").is_dir() { dir.join(".minecraft") } else { dir.to_path_buf() };
    if !looks_like_game_dir(&game) {
        return None;
    }
    let name = dir.file_name().map(|n| n.to_string_lossy().trim_start_matches('.').to_string()).filter(|n| !n.is_empty()).unwrap_or_else(|| "Import".into());
    let name = if name.eq_ignore_ascii_case("minecraft") { "Minecraft".to_string() } else { name };
    let icon = ["icon.png", "instance.png"].iter().map(|n| dir.join(n)).find(|p| p.is_file());
    let mut f = with_guess(found(name, game, dir, String::new(), vanilla(), icon));
    let has_mods = f.info.mod_count > 0;
    if let Some(g) = super::vanilla::guess(&f.game_dir, f.info.loader.kind) {
        if f.info.mc_version.is_empty() || (!has_mods && f.info.loader.kind == LoaderKind::Vanilla) {
            f.info.mc_version = g.mc;
            f.info.loader = if has_mods && g.loader.kind == LoaderKind::Vanilla { f.info.loader } else { g.loader };
            f.info.warning = Some(WARN_VERSIONS.into());
        } else if g.mc == f.info.mc_version && g.loader.kind == f.info.loader.kind {
            f.info.loader.version = g.loader.version;
        }
    }
    Some(f)
}

// ------------------------------------------------------------------ Öffentliche Abläufe

fn sort(v: &mut [Found]) {
    v.sort_by(|a, b| b.info.last_played.unwrap_or(0).cmp(&a.info.last_played.unwrap_or(0)).then(a.info.name.to_lowercase().cmp(&b.info.name.to_lowercase())));
}

fn launcher(id: LauncherKind, path: &Path, mut found: Vec<Found>) -> (ExternalLauncher, Vec<Found>) {
    sort(&mut found);
    (ExternalLauncher { id, name: source_name(id, path).into(), path: s(path), instances: found.iter().map(info_of).collect() }, found)
}

/// Anzeige-Daten einer Instanz inkl. gefundener Einstellungen.
fn info_of(f: &Found) -> ExternalInstance {
    let mut i = f.info.clone();
    i.settings = Some(f.settings.clone()).filter(|s| !s.is_empty());
    i
}

/// Alle bekannten Launcher an den Standardorten (blockierend).
pub fn detect_blocking(tmp: &Path) -> Vec<(ExternalLauncher, Vec<Found>)> {
    let mut out = Vec::new();
    for r in modrinth_roots() {
        out.push(launcher(LauncherKind::Modrinth, &r, modrinth_scan(&r, tmp)));
    }
    for (k, r) in prism_roots() {
        let icons = prism_icons_dir(&r);
        let inst = prism_instances_dir(&r);
        out.push(launcher(k, &r, prism_scan(&inst, Some(&icons), Some(&r))));
    }
    for r in curseforge_roots() {
        out.push(launcher(LauncherKind::Curseforge, &r, curseforge_scan(&r)));
    }
    for r in atlauncher_roots() {
        out.push(launcher(LauncherKind::Atlauncher, &r, atlauncher_scan(&r)));
    }
    for (carbon, r) in super::gdlauncher::roots() {
        out.push(launcher(LauncherKind::Gdlauncher, &r, super::gdlauncher::scan(&r, carbon)));
    }
    for r in super::norisk::roots() {
        out.push(launcher(LauncherKind::Norisk, &r, super::norisk::scan(&r, tmp, &icons_of(tmp))));
    }
    if let Some((r, f)) = official_root().and_then(|r| folder_one(&r).map(|f| (r, f))) {
        out.push(launcher(LauncherKind::Folder, &r, vec![f]));
    }
    out
}

const OFFICIAL: &str = "Minecraft Launcher";

fn is_official(dir: &Path) -> bool {
    let game = if dir.join(".minecraft").is_dir() { dir.join(".minecraft") } else { dir.to_path_buf() };
    game.join("versions").is_dir() && ["launcher_profiles.json", "launcher_settings.json", "launcher_profiles_microsoft_store.json"].iter().any(|f| game.join(f).is_file())
}

fn source_name(kind: LauncherKind, path: &Path) -> &'static str {
    if kind == LauncherKind::Folder && is_official(path) {
        OFFICIAL
    } else {
        launcher_name(kind)
    }
}

fn official_root() -> Option<PathBuf> {
    let d = if cfg!(windows) {
        dirs::data_dir()?.join(".minecraft")
    } else if cfg!(target_os = "macos") {
        dirs::data_dir()?.join("minecraft")
    } else {
        dirs::home_dir()?.join(".minecraft")
    };
    let worth = ["mods", "saves", "resourcepacks", "shaderpacks", "options.txt"].iter().any(|n| {
        let p = d.join(n);
        p.is_file() || std::fs::read_dir(&p).is_ok_and(|mut rd| rd.next().is_some())
    });
    worth.then_some(d)
}

/// `cache/icons` neben `cache/tmp`.
pub(crate) fn icons_of(tmp: &Path) -> PathBuf {
    tmp.parent().map(|c| c.join("icons")).unwrap_or_else(|| tmp.join("icons"))
}

/// Frei gewählten Ordner analysieren: Launcher-Wurzel, Instanzen-Ordner oder einzelne Instanz.
pub fn scan_dir_blocking(path: &Path, tmp: &Path) -> AppResult<(ExternalLauncher, Vec<Found>)> {
    if !path.is_dir() {
        return Err(AppError::NotFound(format!("Ordner {}", path.display())));
    }
    // NoRisk-Wurzel
    if super::norisk::is_root(path) {
        return Ok(launcher(LauncherKind::Norisk, path, super::norisk::scan(path, tmp, &icons_of(tmp))));
    }
    // Modrinth-Wurzel / Profilordner / einzelnes Profil
    if path.join("app.db").is_file() || (path.join("profiles").is_dir() && path.join("meta").is_dir()) {
        return Ok(launcher(LauncherKind::Modrinth, path, modrinth_scan(path, tmp)));
    }
    if path.file_name().is_some_and(|n| n.eq_ignore_ascii_case("profiles")) {
        if let Some(root) = path.parent().filter(|r| r.join("app.db").is_file()) {
            return Ok(launcher(LauncherKind::Modrinth, root, modrinth_scan(root, tmp)));
        }
    }
    if let Some(root) = path.parent().filter(|p| p.file_name().is_some_and(|n| n.eq_ignore_ascii_case("profiles"))).and_then(|p| p.parent()).filter(|r| r.join("app.db").is_file()) {
        let all = modrinth_scan(root, tmp);
        let me = norm(&s(path));
        let one: Vec<Found> = all.into_iter().filter(|f| norm(&f.info.source_path) == me).collect();
        if !one.is_empty() {
            return Ok(launcher(LauncherKind::Modrinth, path, one));
        }
    }
    // Prism/MultiMC-Wurzel
    for (cfg, kind) in [("prismlauncher.cfg", LauncherKind::Prism), ("polymc.cfg", LauncherKind::Prism), ("multimc.cfg", LauncherKind::Multimc)] {
        if path.join(cfg).is_file() {
            let icons = prism_icons_dir(path);
            return Ok(launcher(kind, path, prism_scan(&prism_instances_dir(path), Some(&icons), Some(path))));
        }
    }
    // Einzelne Instanz
    if path.join("instance.cfg").is_file() {
        let icons = path.parent().and_then(|p| p.parent()).map(|r| r.join("icons"));
        if let Some((f, kind)) = prism_one(path, icons.as_deref()) {
            return Ok(launcher(kind, path, vec![f]));
        }
    }
    if let Some(f) = curseforge_one(path) {
        return Ok(launcher(LauncherKind::Curseforge, path, vec![f]));
    }
    if let Some(f) = atlauncher_one(path) {
        return Ok(launcher(LauncherKind::Atlauncher, path, vec![f]));
    }
    if path.join("instance.json").is_file() || path.join("config.json").is_file() {
        if let Some(f) = super::gdlauncher::one(path) {
            return Ok(launcher(LauncherKind::Gdlauncher, path, vec![f]));
        }
    }
    for (inst, carbon) in [(super::gdlauncher::carbon_instances(path), true), (super::gdlauncher::legacy_instances(path), false), (path.to_path_buf(), true), (path.to_path_buf(), false)] {
        let list = super::gdlauncher::scan(&inst, carbon);
        if !list.is_empty() {
            return Ok(launcher(LauncherKind::Gdlauncher, path, list));
        }
    }
    // Ordner mit mehreren Instanzen
    let subdirs: Vec<PathBuf> = std::fs::read_dir(path).map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect()).unwrap_or_default();
    let has = |f: &str| subdirs.iter().any(|d| d.join(f).is_file());
    if has("instance.cfg") {
        let icons = path.parent().map(|r| r.join("icons"));
        let list = prism_scan(path, icons.as_deref(), None);
        let kind = if list.is_empty() { LauncherKind::Prism } else { subdirs.iter().find_map(|d| prism_one(d, None).map(|(_, k)| k)).unwrap_or(LauncherKind::Prism) };
        return Ok(launcher(kind, path, list));
    }
    if has("minecraftinstance.json") {
        return Ok(launcher(LauncherKind::Curseforge, path, curseforge_scan(path)));
    }
    if has("instance.json") {
        return Ok(launcher(LauncherKind::Atlauncher, path, atlauncher_scan(path)));
    }
    if let Some(f) = folder_one(path) {
        return Ok(launcher(LauncherKind::Folder, path, vec![f]));
    }
    let list: Vec<Found> = subdirs.iter().filter_map(|d| folder_one(d)).collect();
    if !list.is_empty() {
        return Ok(launcher(LauncherKind::Folder, path, list));
    }
    Err(AppError::Invalid("In diesem Ordner wurde keine Minecraft-Instanz gefunden".into()))
}

/// Eine Instanz anhand ihres Pfads erneut einlesen (für den Import).
fn describe_blocking(kind: LauncherKind, source: &Path, tmp: &Path) -> AppResult<Found> {
    let me = norm(&s(source));
    let pick = |v: Vec<Found>| v.into_iter().find(|f| norm(&f.info.source_path) == me);
    let f = match kind {
        LauncherKind::Modrinth => {
            let root = source.parent().and_then(|p| p.parent()).map(Path::to_path_buf);
            let mut roots = modrinth_roots();
            if let Some(r) = root.filter(|r| r.join("app.db").is_file() || r.join("profiles").is_dir()) {
                roots.insert(0, r);
            }
            roots.iter().find_map(|r| pick(modrinth_scan(r, tmp)))
        }
        LauncherKind::Prism | LauncherKind::Multimc => {
            let icons = source.parent().and_then(|p| p.parent()).map(prism_icons_dir);
            prism_one(source, icons.as_deref()).map(|(f, _)| f)
        }
        LauncherKind::Curseforge => curseforge_one(source),
        LauncherKind::Atlauncher => atlauncher_one(source),
        LauncherKind::Gdlauncher => super::gdlauncher::one(source),
        LauncherKind::Norisk => super::norisk::describe(&s(source), tmp, &icons_of(tmp)),
        LauncherKind::Folder => folder_one(source),
    };
    f.ok_or_else(|| AppError::NotFound(format!("Instanz {}", source.display())))
}

/// Mehrere Instanzen einlesen; Modrinth- und NoRisk-Wurzeln werden dabei nur einmal gelesen.
/// `None`, wenn die Quelle nicht mehr vorhanden ist.
pub(crate) fn describe_many(reqs: &[(LauncherKind, String)], tmp: &Path) -> Vec<Option<Found>> {
    let mut cache: HashMap<String, Vec<Found>> = HashMap::new();
    reqs.iter()
        .map(|(kind, source)| {
            let me = norm(source);
            let from = |list: &[Found]| list.iter().find(|f| norm(&f.info.source_path) == me).cloned();
            match kind {
                LauncherKind::Modrinth => {
                    let mut roots: Vec<PathBuf> = Path::new(source).parent().and_then(|p| p.parent()).map(Path::to_path_buf).into_iter().collect();
                    roots.retain(|r| r.join("app.db").is_file() || r.join("profiles").is_dir());
                    roots.extend(modrinth_roots());
                    roots.iter().find_map(|r| from(cache.entry(format!("mr|{}", norm(&s(r)))).or_insert_with(|| modrinth_scan(r, tmp))))
                }
                LauncherKind::Norisk => super::norisk::roots_for(source)
                    .iter()
                    .find_map(|r| from(cache.entry(format!("nr|{}", norm(&s(r)))).or_insert_with(|| super::norisk::scan(r, tmp, &icons_of(tmp))))),
                k => describe_blocking(*k, Path::new(source), tmp).ok(),
            }
        })
        .collect()
}

/// Merker: aus welchem Ordner wurde eine Instanz importiert (`instances/<id>/external.json`).
#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct ExternalMark {
    pub launcher: LauncherKind,
    pub source_path: String,
    pub imported_at: i64,
    /// Beim Import übernommene Einträge der obersten Ebene des Spielordners (für den Nachimport: in Vibe
    /// gelöschte Einträge nicht erneut vorschlagen). Fehlt bei älteren Importen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copied: Option<Vec<String>>,
}

impl ExternalMark {
    pub fn prior(&self) -> super::gamedata::Prior {
        super::gamedata::Prior { launcher: Some(self.launcher), imported_at: self.imported_at, copied: self.copied.clone() }
    }
}

pub(crate) fn read_mark(state: &AppState, instance_id: &str) -> Option<ExternalMark> {
    let p = state.paths.instance_dir(instance_id).join("external.json");
    serde_json::from_slice(&std::fs::read(p).ok()?).ok()
}

pub(crate) fn write_mark(state: &AppState, instance_id: &str, launcher: LauncherKind, source_path: &str, copied: Vec<String>) -> AppResult<()> {
    crate::util::write_json_atomic(
        &state.paths.instance_dir(instance_id).join("external.json"),
        &ExternalMark { launcher, source_path: source_path.to_string(), imported_at: crate::util::now_ms(), copied: Some(copied) },
    )
}

fn imported_map(state: &AppState) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for inst in state.instances.list() {
        if let Some(mark) = read_mark(state, &inst.id) {
            m.insert(norm(&mark.source_path), inst.id.clone());
        }
    }
    m
}

fn mark_imported(state: &AppState, list: &mut [ExternalLauncher]) {
    let m = imported_map(state);
    for l in list {
        for i in &mut l.instances {
            i.imported_as = m.get(&norm(&i.source_path)).cloned();
        }
    }
}

pub async fn detect(state: &AppState) -> AppResult<Vec<ExternalLauncher>> {
    let tmp = state.paths.tmp();
    let mut list: Vec<ExternalLauncher> = tokio::task::spawn_blocking(move || detect_blocking(&tmp).into_iter().map(|(l, _)| l).collect()).await?;
    mark_imported(state, &mut list);
    Ok(list)
}

pub async fn scan_dir(state: &AppState, path: String) -> AppResult<ExternalLauncher> {
    let tmp = state.paths.tmp();
    let (l, _) = tokio::task::spawn_blocking(move || scan_dir_blocking(Path::new(&path), &tmp)).await??;
    let mut v = [l];
    mark_imported(state, &mut v);
    let [l] = v;
    Ok(l)
}

fn fmt_size(b: u64) -> String {
    let mb = b as f64 / 1024.0 / 1024.0;
    if mb >= 1024.0 {
        format!("{:.1} GB", mb / 1024.0).replace('.', ",")
    } else {
        format!("{mb:.0} MB")
    }
}

/// Zu kopierende Dateien + Gesamtgröße nach den gemeinsamen Regeln ([`super::gamedata::skip_top`]: ohne Logs,
/// Caches, Launcher-Interna; Konten/Tokens auf keiner Ebene).
/// Verlinkte Dateien (z. B. eine geteilte `options.txt`) werden mit ihrem Inhalt kopiert, verlinkte Ordner nur
/// auf oberster Ebene (z. B. `config`, `saves`) – darin wird keinen weiteren Ordner-Links gefolgt (keine Schleifen).
/// ATLauncher: deaktivierte Mods (`disabledmods/*.jar`) kommen als `mods/<name>.disabled`.
fn plan_copy(src: &Path, kind: LauncherKind) -> (Vec<(PathBuf, PathBuf, u64)>, u64) {
    use super::gamedata::{skip_inner, skip_top, Purpose};
    let mut files = Vec::new();
    let mut total = 0;
    let mut add = |path: &Path, rel: &Path, ft: std::fs::FileType, top: bool, files: &mut Vec<(PathBuf, PathBuf, u64)>| {
        if ft.is_dir() {
            files.push((path.to_path_buf(), rel.to_path_buf(), u64::MAX));
            return false;
        }
        let meta = if ft.is_symlink() { std::fs::metadata(path) } else { path.symlink_metadata() };
        match meta {
            Ok(m) if m.is_file() => {
                total += m.len();
                files.push((path.to_path_buf(), rel.to_path_buf(), m.len()));
                false
            }
            // verlinkter Ordner auf oberster Ebene -> Inhalt übernehmen
            Ok(m) if m.is_dir() && top => {
                files.push((path.to_path_buf(), rel.to_path_buf(), u64::MAX));
                true
            }
            _ => false,
        }
    };
    let keep = |e: &walkdir::DirEntry| {
        let n = e.file_name().to_string_lossy();
        if e.depth() == 1 {
            !skip_top(kind, Purpose::Import, &n)
        } else {
            e.depth() == 0 || !skip_inner(&n)
        }
    };
    for e in walkdir::WalkDir::new(src).follow_links(false).into_iter().filter_entry(keep).flatten() {
        let Ok(rel) = e.path().strip_prefix(src) else { continue };
        if rel.as_os_str().is_empty() {
            continue;
        }
        if add(e.path(), rel, e.file_type(), e.depth() == 1, &mut files) {
            for w in walkdir::WalkDir::new(e.path()).follow_links(false).min_depth(1).into_iter().filter_entry(|w| !skip_inner(&w.file_name().to_string_lossy())).flatten() {
                let Ok(inner) = w.path().strip_prefix(e.path()) else { continue };
                add(w.path(), &rel.join(inner), w.file_type(), false, &mut files);
            }
        }
    }
    if kind == LauncherKind::Atlauncher {
        if let Ok(rd) = std::fs::read_dir(src.join("disabledmods")) {
            for d in rd.flatten() {
                let n = d.file_name().to_string_lossy().to_string();
                let Ok(m) = d.metadata() else { continue };
                if m.is_file() && n.to_ascii_lowercase().ends_with(".jar") && !src.join("mods").join(&n).exists() {
                    total += m.len();
                    files.push((d.path(), Path::new("mods").join(format!("{n}.disabled")), m.len()));
                }
            }
        }
    }
    (files, total)
}

#[allow(clippy::too_many_arguments)]
pub async fn run_import(
    state: AppState,
    task: TaskHandle,
    kind: LauncherKind,
    source_path: String,
    name: Option<String>,
    mc_version: Option<String>,
    loader: Option<Loader>,
    settings: Option<Vec<String>>,
) -> AppResult<()> {
    task.stage("Lese Instanz …", None);
    let keys: std::collections::HashSet<String> = settings.unwrap_or_else(extsettings::default_keys).into_iter().collect();
    let tmp = state.paths.tmp();
    let sp = PathBuf::from(&source_path);
    let f = tokio::task::spawn_blocking(move || describe_blocking(kind, &sp, &tmp)).await??;
    if kind == LauncherKind::Norisk {
        return super::norisk::run_import(state, task, f, source_path, name, mc_version, loader, keys).await;
    }
    let mc = mc_version.filter(|v| !v.trim().is_empty()).unwrap_or_else(|| f.info.mc_version.clone());
    if mc.trim().is_empty() {
        return Err(AppError::Invalid(format!("{}: Minecraft-Version unbekannt – bitte angeben", f.info.name)));
    }
    let loader = loader.unwrap_or_else(|| f.info.loader.clone());
    let name = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| f.info.name.clone());
    task.set_title(format!("{name} übernehmen"));
    let src_game = f.game_dir.clone();
    task.check()?;
    let (files, total) = tokio::task::spawn_blocking(move || plan_copy(&src_game, kind)).await?;
    let copied = super::gamedata::top_names(files.iter().map(|f| f.1.as_path()));

    let mut inst = Instance {
        id: String::new(),
        name: name.clone(),
        icon: None,
        accent: None,
        group: None,
        mc_version: mc,
        loader,
        java: Default::default(),
        window: Default::default(),
        hooks: Default::default(),
        source: Some(f.pack.clone().unwrap_or(PackSource {
            kind: match kind {
                LauncherKind::Modrinth => PackSourceKind::Modrinth,
                LauncherKind::Curseforge => PackSourceKind::Curseforge,
                LauncherKind::Prism | LauncherKind::Multimc => PackSourceKind::Prism,
                LauncherKind::Atlauncher | LauncherKind::Gdlauncher | LauncherKind::Norisk | LauncherKind::Folder => PackSourceKind::Local,
            },
            project_id: None,
            version_id: None,
            name: Some(source_name(kind, Path::new(&source_path)).to_string()),
            version_name: None,
        })),
        install_state: InstallState::NotInstalled,
        version_id: None,
        created_at: crate::util::now_ms(),
        last_played: f.info.last_played,
        play_time_secs: f.info.play_time_secs.unwrap_or(0),
        notes: None,
        auto_update_content: None,
        bedrock: None,
    };
    let (prepared, java_note) = extsettings::prepare(&state.settings(), &f.settings, &inst.mc_version, keys.contains("java")).await;
    extsettings::apply(&mut inst, &prepared, &keys);
    let inst = state.instances.insert_new(inst)?;
    task.set_instance(inst.id.clone());

    let n_files = files.iter().filter(|f| f.2 != u64::MAX).count();
    let res: AppResult<()> = async {
        write_mark(&state, &inst.id, kind, &source_path, copied)?;
        task.stage(format!("Kopiere {} Dateien …", files.iter().filter(|f| f.2 != u64::MAX).count()), Some(0.0));
        let dst = state.paths.game_dir(&inst.id);
        let t2 = task.clone();
        tokio::task::spawn_blocking(move || -> AppResult<()> {
            let mut done = 0u64;
            for (i, (src, rel, size)) in files.iter().enumerate() {
                if i % 32 == 0 {
                    t2.check()?;
                }
                let target = dst.join(rel);
                if *size == u64::MAX {
                    std::fs::create_dir_all(&target)?;
                    continue;
                }
                if let Some(p) = target.parent() {
                    std::fs::create_dir_all(p)?;
                }
                std::fs::copy(src, &target).map_err(|e| AppError::msg(format!("{} konnte nicht kopiert werden: {e}", rel.display())))?;
                done += size;
                t2.progress(if total == 0 { 1.0 } else { done as f64 / total as f64 });
            }
            Ok(())
        })
        .await??;
        if let Some(icon) = f.icon_path.as_ref().and_then(|p| std::fs::read(p).ok()) {
            if let Err(e) = super::import::set_icon_bytes(&state, &inst.id, &icon).await {
                tracing::warn!("Icon nicht übernommen: {e}");
            }
        }
        Ok(())
    }
    .await;
    match res {
        Ok(()) => {
            let r = super::importreport::ImportReport {
                launcher: source_name(kind, Path::new(&source_path)).into(),
                at: crate::util::now_ms(),
                files: n_files as u64,
                bytes: total,
                jars: super::importreport::mod_files(&state.paths.game_dir(&inst.id)),
                ..Default::default()
            };
            if let Err(e) = super::importreport::save(&state, &inst.id, &r) {
                tracing::warn!("Import-Bericht nicht gespeichert: {e}");
            }
            task.message(match &java_note {
                Some(n) => format!("{} übernommen · {n}", fmt_size(total)),
                None => format!("{} übernommen", fmt_size(total)),
            });
            state.content.emit_changed(&inst.id);
            Ok(())
        }
        Err(e) => {
            if let Err(de) = state.instances.delete(&inst.id) {
                tracing::warn!("Halb importierte Instanz {} nicht entfernt: {de}", inst.id);
            }
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("vl-ext-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn prism_instance_folder() {
        let root = tmp();
        let inst = root.join("instances").join("Meine");
        std::fs::create_dir_all(inst.join(".minecraft/mods")).unwrap();
        std::fs::create_dir_all(root.join("icons")).unwrap();
        std::fs::write(root.join("prismlauncher.cfg"), "[General]\nInstanceDir=instances\n").unwrap();
        std::fs::write(root.join("icons/flame.png"), b"\x89PNG\r\n\x1a\n0000").unwrap();
        std::fs::write(inst.join("instance.cfg"), "[General]\nname=Meine Instanz\niconKey=flame\nlastLaunchTime=1700000000000\ntotalTimePlayed=3600\n").unwrap();
        std::fs::write(inst.join("mmc-pack.json"), r#"{"components":[{"uid":"net.minecraft","version":"1.20.1"},{"uid":"net.neoforged","version":"47.1.106"}]}"#).unwrap();
        std::fs::write(inst.join(".minecraft/mods/a.jar"), b"x").unwrap();
        std::fs::write(inst.join(".minecraft/mods/b.jar.disabled"), b"x").unwrap();
        let (l, f) = scan_dir_blocking(&root, &root.join("tmp")).unwrap();
        assert_eq!(l.id, LauncherKind::Prism);
        assert_eq!(l.instances.len(), 1);
        let i = &l.instances[0];
        assert_eq!(i.name, "Meine Instanz");
        assert_eq!(i.mc_version, "1.20.1");
        assert_eq!(i.loader.kind, LoaderKind::Neoforge);
        assert_eq!(i.mod_count, 2);
        assert_eq!(i.last_played, Some(1_700_000_000_000));
        assert_eq!(i.play_time_secs, Some(3600));
        assert!(i.icon.is_some());
        assert_eq!(f[0].game_dir, inst.join(".minecraft"));
        // einzelne Instanz direkt
        let (l2, _) = scan_dir_blocking(&inst, &root.join("tmp")).unwrap();
        assert_eq!(l2.instances[0].name, "Meine Instanz");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn curseforge_and_atlauncher() {
        let root = tmp();
        let cf = root.join("cf").join("ATM9");
        std::fs::create_dir_all(cf.join("mods")).unwrap();
        std::fs::write(
            cf.join("minecraftinstance.json"),
            r#"{"name":"All the Mods 9","gameVersion":"1.20.1","baseModLoader":{"name":"forge-47.2.0","minecraftVersion":"1.20.1"},"lastPlayed":"2024-05-01T10:00:00Z","installedModpack":{"addonID":715572,"installedFile":{"id":5000}}}"#,
        )
        .unwrap();
        let (l, f) = scan_dir_blocking(&root.join("cf"), &root.join("tmp")).unwrap();
        assert_eq!(l.id, LauncherKind::Curseforge);
        assert_eq!(l.instances[0].loader, Loader { kind: LoaderKind::Forge, version: Some("47.2.0".into()) });
        assert_eq!(f[0].pack.as_ref().unwrap().project_id.as_deref(), Some("715572"));
        assert!(l.instances[0].last_played.is_some());

        let atl = root.join("atl").join("Vanilla");
        std::fs::create_dir_all(atl.join("mods")).unwrap();
        std::fs::write(atl.join("instance.json"), r#"{"id":"1.20.4","launcher":{"name":"Mein ATL","loaderVersion":{"type":"Fabric","version":"0.15.7"},"lastPlayed":1700000000000,"totalPlayTime":120}}"#).unwrap();
        let (l, _) = scan_dir_blocking(&atl, &root.join("tmp")).unwrap();
        assert_eq!(l.id, LauncherKind::Atlauncher);
        assert_eq!(l.instances[0].mc_version, "1.20.4");
        assert_eq!(l.instances[0].loader.kind, LoaderKind::Fabric);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn folder_guess() {
        let root = tmp();
        let g = root.join("MeinSpiel");
        std::fs::create_dir_all(g.join("mods")).unwrap();
        let jar = std::fs::File::create(g.join("mods/x.jar")).unwrap();
        let mut w = zip::ZipWriter::new(jar);
        w.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default()).unwrap();
        use std::io::Write;
        w.write_all(br#"{"id":"x","depends":{"minecraft":"~1.20.1","fabricloader":">=0.14"}}"#).unwrap();
        w.finish().unwrap();
        let (l, _) = scan_dir_blocking(&g, &root.join("tmp")).unwrap();
        assert_eq!(l.id, LauncherKind::Folder);
        let i = &l.instances[0];
        assert_eq!(i.mc_version, "1.20.1");
        assert_eq!(i.loader.kind, LoaderKind::Fabric);
        assert!(i.warning.is_some());
        assert!(scan_dir_blocking(&root.join("nichts"), &root).is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn modrinth_new_schema() {
        let root = tmp();
        std::fs::create_dir_all(root.join("profiles/Mein Profil/mods")).unwrap();
        std::fs::create_dir_all(root.join("profiles/Ohne DB/mods")).unwrap();
        std::fs::create_dir_all(root.join("meta")).unwrap();
        {
            let c = rusqlite::Connection::open(root.join("app.db")).unwrap();
            c.execute_batch(
                "PRAGMA journal_mode=WAL;
                 CREATE TABLE settings (id INTEGER, custom_dir TEXT);
                 CREATE TABLE instances (id TEXT, path TEXT, applied_content_set_id TEXT, name TEXT, icon_path TEXT, last_played INTEGER, submitted_time_played INTEGER, recent_time_played INTEGER);
                 CREATE TABLE instance_content_sets (id TEXT, instance_id TEXT, game_version TEXT, loader TEXT, loader_version TEXT);
                 CREATE TABLE instance_links (instance_id TEXT, link_kind TEXT, modrinth_project_id TEXT, modrinth_version_id TEXT);
                 INSERT INTO instances VALUES ('i1','Mein Profil','s1','Schöner Name',NULL,1700000000,100,20);
                 INSERT INTO instance_content_sets VALUES ('s1','i1','1.21.1','neoforge','21.1.227');
                 INSERT INTO instance_links VALUES ('i1','modrinth_modpack','PROJ','VER');",
            )
            .unwrap();
        }
        let (l, f) = scan_dir_blocking(&root, &root.join("tmp")).unwrap();
        assert_eq!(l.id, LauncherKind::Modrinth);
        let p = f.iter().find(|f| f.info.name == "Schöner Name").unwrap();
        assert_eq!(p.info.mc_version, "1.21.1");
        assert_eq!(p.info.loader, Loader { kind: LoaderKind::Neoforge, version: Some("21.1.227".into()) });
        assert_eq!(p.info.last_played, Some(1_700_000_000_000));
        assert_eq!(p.info.play_time_secs, Some(120));
        assert_eq!(p.pack.as_ref().unwrap().project_id.as_deref(), Some("PROJ"));
        let o = f.iter().find(|f| f.info.name == "Ohne DB").unwrap();
        assert!(o.info.warning.is_some());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn db_copy_without_tokens() {
        let root = tmp();
        {
            let c = rusqlite::Connection::open(root.join("app.db")).unwrap();
            c.execute_batch("CREATE TABLE minecraft_users (uuid TEXT, access_token TEXT); INSERT INTO minecraft_users VALUES ('u','GEHEIM'); CREATE TABLE instances (path TEXT); INSERT INTO instances VALUES ('p');").unwrap();
        }
        let c = open_db_copy_named(&root, &root.join("tmp"), "modrinth-db").unwrap();
        assert_eq!(c.query_row("SELECT count(*) FROM minecraft_users", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        assert_eq!(c.query_row("SELECT count(*) FROM instances", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        drop(c);
        let copy = std::fs::read_dir(root.join("tmp")).unwrap().flatten().next().unwrap().path();
        for f in std::fs::read_dir(&copy).unwrap().flatten() {
            let b = std::fs::read(f.path()).unwrap();
            assert!(!b.windows(6).any(|w| w == b"GEHEIM"), "{:?}", f.path());
        }
        let orig = rusqlite::Connection::open(root.join("app.db")).unwrap();
        assert_eq!(orig.query_row("SELECT count(*) FROM minecraft_users", [], |r| r.get::<_, i64>(0)).unwrap(), 1, "Original unverändert");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn modrinth_old_schema() {
        let root = tmp();
        std::fs::create_dir_all(root.join("profiles/alt")).unwrap();
        {
            let c = rusqlite::Connection::open(root.join("app.db")).unwrap();
            c.execute_batch(
                "CREATE TABLE profiles (path TEXT, name TEXT, icon_path TEXT, game_version TEXT, mod_loader TEXT, mod_loader_version TEXT, last_played INTEGER, submitted_time_played INTEGER, recent_time_played INTEGER, linked_project_id TEXT, linked_version_id TEXT);
                 INSERT INTO profiles VALUES ('alt','Altes Profil',NULL,'1.20.1','fabric','0.15.7',NULL,0,0,NULL,NULL);",
            )
            .unwrap();
        }
        let (_, f) = scan_dir_blocking(&root, &root.join("tmp")).unwrap();
        assert_eq!(f[0].info.name, "Altes Profil");
        assert_eq!(f[0].info.loader.kind, LoaderKind::Fabric);
        assert_eq!(f[0].info.mc_version, "1.20.1");
        std::fs::remove_dir_all(&root).ok();
    }

    // ---------------------------------------------------------------- Einstellungen (Fixtures je Launcher)

    fn vibe_instance(mc: &str) -> Instance {
        serde_json::from_value(serde_json::json!({
            "id": "imp", "name": "Importiert", "icon": null, "accent": null, "group": null, "mc_version": mc,
            "loader": {"kind": "forge", "version": "47.2.0"}, "created_at": 0
        }))
        .unwrap()
    }

    fn keys(k: &[&str]) -> std::collections::HashSet<String> {
        k.iter().map(|s| s.to_string()).collect()
    }

    /// Prism-Wurzel: globale Standards (inkl. API-Schlüssel, der nie übernommen wird), Gruppe, Modpack-Herkunft.
    fn prism_root() -> (PathBuf, PathBuf) {
        let root = tmp();
        let inst = root.join("instances").join("ATM9");
        std::fs::create_dir_all(inst.join(".minecraft/config")).unwrap();
        std::fs::write(
            root.join("prismlauncher.cfg"),
            "[General]\nInstanceDir=instances\nMaxMemAlloc=4096\nMinMemAlloc=512\nJvmArgs=-XX:+UseG1GC\nMinecraftWinWidth=854\nMinecraftWinHeight=480\nCFKeyOverride=geheim\nWrapperCommand=gamemoderun\n",
        )
        .unwrap();
        std::fs::write(root.join("instances/instgroups.json"), r#"{"formatVersion":"1","groups":{"Modpacks":{"hidden":false,"instances":["ATM9"]}}}"#).unwrap();
        std::fs::write(
            inst.join("instance.cfg"),
            "[General]\nname=All the Mods 9\nOverrideMemory=true\nMinMemAlloc=2048\nMaxMemAlloc=8192\nOverrideWindow=true\nMinecraftWinWidth=1920\nMinecraftWinHeight=1080\n\
             OverrideCommands=true\nPreLaunchCommand=echo $INST_NAME\nOverrideEnv=true\nEnv={\"FOO\":\"bar\"}\nnotes=\"Erste Zeile\\nZweite\"\n\
             ManagedPack=true\nManagedPackType=flame\nManagedPackID=715572\nManagedPackVersionID=5000\nManagedPackName=All the Mods 9\ntotalTimePlayed=7200\n",
        )
        .unwrap();
        std::fs::write(inst.join("mmc-pack.json"), r#"{"components":[{"uid":"net.minecraft","version":"1.20.1"},{"uid":"net.minecraftforge","version":"47.2.0"}]}"#).unwrap();
        std::fs::write(inst.join(".minecraft/options.txt"), "fov:0.8\nkey_key.jump:key.keyboard.space\n").unwrap();
        std::fs::write(inst.join(".minecraft/config/jei.toml"), "a=1").unwrap();
        (root, inst)
    }

    #[test]
    fn prism_settings_read() {
        let (root, inst) = prism_root();
        let (l, f) = scan_dir_blocking(&root, &root.join("tmp")).unwrap();
        let s = &f[0].settings;
        assert_eq!((s.min_memory_mb, s.max_memory_mb), (Some(2048), Some(8192)));
        assert_eq!((s.width, s.height), (Some(1920), Some(1080)));
        assert_eq!(s.jvm_args.as_deref(), Some("-XX:+UseG1GC"), "globale JVM-Argumente (geerbt)");
        assert!(s.inherited.contains(&"jvm_args".to_string()));
        assert!(s.pre_launch.as_deref().unwrap().contains("INST_NAME"));
        // Instanz überschreibt die Befehle -> globaler Wrapper zählt nicht
        assert!(s.wrapper.is_none());
        assert_eq!(s.env.get("FOO").map(String::as_str), Some("bar"));
        assert_eq!(s.notes.as_deref(), Some("Erste Zeile\nZweite"));
        assert_eq!(s.group.as_deref(), Some("Modpacks"));
        let pack = f[0].pack.as_ref().unwrap();
        assert_eq!((pack.kind, pack.project_id.as_deref()), (PackSourceKind::Curseforge, Some("715572")));
        assert!(l.instances[0].settings.is_some(), "Einstellungen gehen an den Import-Dialog");
        // Nur bekannte Schlüssel der globalen Konfiguration
        let g = prism_global(&inst, Some(&root));
        assert!(!g.contains_key("CFKeyOverride") && !g.contains_key("InstanceDir"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn modrinth_settings_read() {
        let root = tmp();
        std::fs::create_dir_all(root.join("profiles/Eigen/mods")).unwrap();
        std::fs::create_dir_all(root.join("meta")).unwrap();
        {
            let c = rusqlite::Connection::open(root.join("app.db")).unwrap();
            c.execute_batch(
                "CREATE TABLE settings (id INTEGER, custom_dir TEXT, extra_launch_args TEXT, custom_env_vars TEXT, mc_memory_max INTEGER, mc_force_fullscreen INTEGER,
                    mc_game_resolution_x INTEGER, mc_game_resolution_y INTEGER, hook_pre_launch TEXT, hook_wrapper TEXT, hook_post_exit TEXT);
                 INSERT INTO settings VALUES (0,NULL,'[]','[]',2048,0,854,480,NULL,NULL,NULL);
                 CREATE TABLE profiles (path TEXT, name TEXT, icon_path TEXT, game_version TEXT, mod_loader TEXT, mod_loader_version TEXT, last_played INTEGER,
                    submitted_time_played INTEGER, recent_time_played INTEGER, linked_project_id TEXT, linked_version_id TEXT, groups TEXT,
                    override_java_path TEXT, override_extra_launch_args TEXT, override_custom_env_vars TEXT, override_mc_memory_max INTEGER,
                    override_mc_force_fullscreen INTEGER, override_mc_game_resolution_x INTEGER, override_mc_game_resolution_y INTEGER,
                    override_hook_pre_launch TEXT, override_hook_wrapper TEXT, override_hook_post_exit TEXT);
                 INSERT INTO profiles VALUES ('Eigen','Eigenes Profil',NULL,'1.21.1','fabric','0.16.9',1700000000,600,0,NULL,NULL,'[\"Survival\"]',
                    NULL,'[\"-Xss4M\"]','[[\"MESA_GLTHREAD\",\"true\"]]',6144,1,NULL,NULL,NULL,'prime-run',NULL);",
            )
            .unwrap();
        }
        let (l, f) = scan_dir_blocking(&root, &root.join("tmp")).unwrap();
        assert_eq!(l.id, LauncherKind::Modrinth);
        let s = &f[0].settings;
        assert_eq!(s.max_memory_mb, Some(6144));
        assert_eq!(s.jvm_args.as_deref(), Some("-Xss4M"));
        assert_eq!(s.env.get("MESA_GLTHREAD").map(String::as_str), Some("true"));
        assert_eq!(s.fullscreen, Some(true));
        assert_eq!((s.width, s.height), (Some(854), Some(480)), "Auflösung aus den App-Standards");
        assert_eq!(s.wrapper.as_deref(), Some("prime-run"));
        assert_eq!(s.group.as_deref(), Some("Survival"));
        // Kopie der DB wird gelesen, das Original bleibt unverändert
        assert!(root.join("tmp").read_dir().unwrap().next().is_some());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn curseforge_settings_read() {
        let root = tmp();
        let cf = root.join("Instances").join("Pack");
        std::fs::create_dir_all(cf.join("mods")).unwrap();
        std::fs::write(
            cf.join("minecraftinstance.json"),
            r#"{"name":"Pack","gameVersion":"1.20.1","baseModLoader":{"name":"forge-47.2.0"},"isMemoryOverride":true,"allocatedMemory":10240,"javaArgsOverride":"-XX:+UseZGC"}"#,
        )
        .unwrap();
        let (_, f) = scan_dir_blocking(&cf, &root.join("tmp")).unwrap();
        assert_eq!(f[0].settings.max_memory_mb, Some(10240));
        assert_eq!(f[0].settings.jvm_args.as_deref(), Some("-XX:+UseZGC"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn atlauncher_settings_read() {
        let root = tmp();
        let inst = root.join("instances").join("FO");
        std::fs::create_dir_all(inst.join("mods")).unwrap();
        std::fs::create_dir_all(root.join("configs")).unwrap();
        std::fs::write(
            root.join("configs/ATLauncher.json"),
            r#"{"initialMemory":512,"maximumMemory":4096,"windowWidth":1600,"windowHeight":900,"javaParameters":"-XX:+UseG1GC","proxyHost":"x","enableCommands":true,"wrapperCommand":"gamemoderun"}"#,
        )
        .unwrap();
        std::fs::write(
            inst.join("instance.json"),
            r#"{"id":"1.20.4","launcher":{"name":"Fabulously","maximumMemory":6144,"loaderVersion":{"type":"Fabric","version":"0.15.7"},"totalPlayTime":3600,
                "modrinthProject":{"id":"1KVo5zza"},"modrinthVersion":{"id":"VER"}}}"#,
        )
        .unwrap();
        let (_, f) = scan_dir_blocking(&inst, &root.join("tmp")).unwrap();
        let s = &f[0].settings;
        assert_eq!(s.max_memory_mb, Some(6144));
        assert_eq!((s.width, s.height), (Some(1600), Some(900)));
        assert!(s.inherited.contains(&"window".to_string()));
        assert_eq!(s.wrapper.as_deref(), Some("gamemoderun"));
        assert!(s.inherited.contains(&"hooks".to_string()));
        assert_eq!(f[0].pack.as_ref().unwrap().project_id.as_deref(), Some("1KVo5zza"));
        std::fs::remove_dir_all(&root).ok();
    }

    /// Nachträglich übernehmen: nur Instanz-Daten, Spielordner (Quelle wie Ziel) bleibt unangetastet.
    #[test]
    fn retro_apply_only_settings() {
        let (root, inst_dir) = prism_root();
        let tmpd = root.join("tmp");
        // Wie bei einer schon importierten Instanz: per Kennung erneut einlesen
        let found = describe_many(&[(LauncherKind::Prism, s(&inst_dir))], &tmpd).pop().flatten().unwrap();
        assert!(describe_many(&[(LauncherKind::Prism, s(&root.join("instances/weg")))], &tmpd)[0].is_none(), "Quelle fehlt -> kein Angebot");
        let vibe_game = root.join("vibe-game");
        std::fs::create_dir_all(&vibe_game).unwrap();
        std::fs::write(vibe_game.join("options.txt"), "fov:0.5\n").unwrap();

        let mut i = vibe_instance("1.20.1");
        i.java.max_memory_mb = Some(12288); // eigener Wert in Vibe
        let vibe = crate::settings::Settings::default();
        let prepared = found.settings.clone().effective(&vibe);
        let changes = super::extsettings::diff(&i, &prepared);
        let by = |k: &str| changes.iter().find(|c| c.key == k).cloned().unwrap();
        assert!(!by("memory").default_on, "eigener RAM-Wert in Vibe -> nicht vorausgewählt");
        assert!(by("window").default_on);
        assert!(!by("hooks").default_on);
        // Übernehmen wie vom Hinweis vorgeschlagen (Standard-Auswahl) + Spielzeit/Herkunft
        let mut chosen: Vec<&str> = changes.iter().filter(|c| c.default_on).map(|c| c.key.as_str()).collect();
        chosen.extend(["playtime", "pack"]);
        super::extsettings::apply_found(&mut i, &prepared, &found, &keys(&chosen));
        assert_eq!(i.java.max_memory_mb, Some(12288), "nicht gewählt -> unverändert");
        assert_eq!((i.window.width, i.window.height), (Some(1920), Some(1080)));
        assert_eq!(i.java.env.get("FOO").map(String::as_str), Some("bar"));
        assert!(i.hooks.pre_launch.is_none(), "Start-Befehle nur nach ausdrücklicher Wahl");
        assert_eq!(i.group.as_deref(), Some("Modpacks"));
        assert_eq!(i.play_time_secs, 7200);
        assert_eq!(i.source.as_ref().unwrap().project_id.as_deref(), Some("715572"));
        // Keine Dateien angefasst
        assert_eq!(std::fs::read_to_string(vibe_game.join("options.txt")).unwrap(), "fov:0.5\n");
        assert!(std::fs::read_to_string(inst_dir.join(".minecraft/options.txt")).unwrap().starts_with("fov:0.8"));
        // Danach: keine Unterschiede mehr in den übernommenen Bereichen
        let again = super::extsettings::diff(&i, &prepared);
        assert!(again.iter().all(|c| !chosen.contains(&c.key.as_str())), "{again:?}");
        std::fs::remove_dir_all(&root).ok();
    }

    /// Gemeinsame Regeln je Launcher: Mod-Daten kommen mit, Logs/Launcher-Interna/Konten nicht.
    #[test]
    fn plan_copy_rules_per_launcher() {
        let root = tmp();
        let game = root.join("game");
        for f in [
            "mods/a.jar",
            "config/a.toml",
            "xaero/minimap/x.txt",
            "XaeroWaypoints/w.txt",
            "journeymap/data/a.dat",
            "schematics/haus.litematic",
            "saves/Welt/level.dat",
            "options.txt",
            "servers.dat",
            "logs/latest.log",
            "crash-reports/c.txt",
            "accounts.json",
            "essential/microsoft_accounts.json",
            "essential/settings.json",
            "minecraftinstance.json",
            "instance.json",
            "disabledmods/off.jar",
            "profile.json",
            "versions/1.21/1.21.jar",
            "launcher_accounts.json",
        ] {
            let p = game.join(f);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, "x").unwrap();
        }
        let rels = |k: LauncherKind| -> Vec<String> { plan_copy(&game, k).0.iter().filter(|f| f.2 != u64::MAX).map(|f| f.1.to_string_lossy().replace('\\', "/")).collect() };
        for k in [LauncherKind::Prism, LauncherKind::Modrinth, LauncherKind::Curseforge, LauncherKind::Atlauncher, LauncherKind::Folder] {
            let r = rels(k);
            for keep in ["mods/a.jar", "config/a.toml", "xaero/minimap/x.txt", "XaeroWaypoints/w.txt", "journeymap/data/a.dat", "schematics/haus.litematic", "saves/Welt/level.dat", "options.txt", "servers.dat", "essential/settings.json"] {
                assert!(r.contains(&keep.to_string()), "{k:?}: {keep} fehlt in {r:?}");
            }
            for skip in ["logs/latest.log", "crash-reports/c.txt", "accounts.json", "essential/microsoft_accounts.json", "versions/1.21/1.21.jar", "launcher_accounts.json"] {
                assert!(!r.contains(&skip.to_string()), "{k:?}: {skip} darf nicht mit");
            }
        }
        assert!(!rels(LauncherKind::Curseforge).contains(&"minecraftinstance.json".to_string()));
        let atl = rels(LauncherKind::Atlauncher);
        assert!(!atl.contains(&"instance.json".to_string()) && !atl.contains(&"disabledmods/off.jar".to_string()));
        assert!(atl.contains(&"mods/off.jar.disabled".to_string()), "deaktivierte ATLauncher-Mods: {atl:?}");
        assert!(!rels(LauncherKind::Modrinth).contains(&"profile.json".to_string()));
        assert!(rels(LauncherKind::Prism).contains(&"minecraftinstance.json".to_string()), "nur bei CurseForge Launcher-intern");
        assert_eq!(super::super::gamedata::top_names(rels(LauncherKind::Prism).iter().map(Path::new)).iter().filter(|n| *n == "xaero").count(), 1);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn copy_follows_file_links() {
        let root = tmp();
        let (src, shared) = (root.join("game"), root.join("shared"));
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(shared.join("cfg")).unwrap();
        std::fs::write(shared.join("options.txt"), "fov:1").unwrap();
        std::fs::write(shared.join("cfg/a.toml"), "x").unwrap();
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(shared.join("options.txt"), src.join("options.txt")).is_ok()
            && std::os::windows::fs::symlink_dir(shared.join("cfg"), src.join("config")).is_ok();
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(shared.join("options.txt"), src.join("options.txt")).is_ok() && std::os::unix::fs::symlink(shared.join("cfg"), src.join("config")).is_ok();
        if !linked {
            // Ohne Recht auf Symlinks (Windows ohne Entwicklermodus) nicht prüfbar
            std::fs::remove_dir_all(&root).ok();
            return;
        }
        let (files, total) = plan_copy(&src, LauncherKind::Folder);
        let rels: Vec<String> = files.iter().filter(|f| f.2 != u64::MAX).map(|f| f.1.to_string_lossy().replace('\\', "/")).collect();
        assert!(rels.contains(&"options.txt".to_string()), "{rels:?}");
        assert!(rels.contains(&"config/a.toml".to_string()), "{rels:?}");
        assert_eq!(total, 6);
        std::fs::remove_dir_all(&root).ok();
    }
}
