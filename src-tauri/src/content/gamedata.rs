//! Spieldaten aus anderen Launchern: **eine** Regel für alle Launcher, was zum Spiel gehört (Import und
//! Nachimport), Vergleich Quelle ↔ Vibe-Instanz und Nachkopieren fehlender bzw. ausdrücklich gewählter Daten.
//!
//! - Mit kommt alles im Spielordner – Configs, Welten, Packs, Optionen, Daten anderer Mods (`xaero/`,
//!   `journeymap/`, `schematics/` …) – außer: Laufzeitreste ([`RUNTIME`]: Logs, Caches, Absturzberichte),
//!   Interna des Vanilla-Launchers ([`VANILLA_LAUNCHER`], falls ein ganzer `.minecraft` gewählt wurde),
//!   Interna des jeweiligen Launchers ([`launcher_skip`]) und – nur beim Nachimport – Mods (laufen über die
//!   Content-Logik).
//! - **Konten/Tokens** ([`is_secret`]) werden auf jeder Ebene übersprungen – nur der Name wird geprüft, die
//!   Datei wird nie geöffnet.
//! - Nachimport: [`scan`] vergleicht nur per Metadaten (Größe, Zeitstempel; Inhalt nur bei kleinen Dateien mit
//!   gleicher Größe). Standard ist „nur Fehlendes hinzufügen“; überschrieben wird nur pro Eintrag ausdrücklich.
//!   Welten werden einzeln angeboten und nie dateiweise gemischt (ganz hinzufügen oder ganz ersetzen).
//! - Fremde Ordner werden nur gelesen.
use super::srctree::{self, Overlay};
use super::LauncherKind;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Wofür gefiltert wird.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    /// Erstimport: Mods kommen je nach Launcher mit (Kopie) bzw. über die Launcher-eigene Logik (NoRisk).
    Import,
    /// Nachimport: nie Mods (Content-Logik), sonst wie beim Import.
    Reimport,
}

/// Laufzeitreste: Logs, Caches, Absturzberichte, Sitzungsdaten (oberste Ebene, Groß-/Kleinschreibung egal).
pub const RUNTIME: &[&str] = &[
    "logs",
    "crash-reports",
    "debug",
    "cache",
    ".cache",
    "downloads",
    "natives",
    "webcache",
    "webcache2",
    "usercache.json",
    "usernamecache.json",
    "realms_persistence.json",
    "command_history.txt",
    ".fabric",
    ".quilt",
    ".mixin.out",
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
];

/// Interna des offiziellen Launchers (wenn ein kompletter `.minecraft` als Ordner importiert wird).
pub const VANILLA_LAUNCHER: &[&str] = &[
    "versions",
    "libraries",
    "assets",
    "runtime",
    "bin",
    "launcher_log.txt",
    "launcher_cef_log.txt",
    "launcher_ui_state.json",
    "launcher_settings.json",
    "launcher_product_state.json",
    "launcher_entitlements.json",
    "launcher_gamer_pics.json",
    "launcher_skins.json",
    "treatment_tags.json",
    "staging",
    "quickPlay",
];

fn is_vanilla_launcher(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    VANILLA_LAUNCHER.iter().any(|s| s.eq_ignore_ascii_case(name))
        || (l.starts_with("launcher_") && (l.ends_with(".json") || l.ends_with(".txt") || l.ends_with(".bin") || l.ends_with(".log")))
        || (l.starts_with("clientid") && l.ends_with(".txt"))
}

/// Was eine frühere NoRisk-Version (bis v1.0.0-beta.4) übernommen hat – für Importe ohne Liste in `external.json`.
pub const LEGACY_NORISK_COPY: &[&str] =
    &["config", "defaultconfigs", "saves", "resourcepacks", "shaderpacks", "screenshots", "schematics", "options.txt", "optionsof.txt", "optionsshaders.txt", "servers.dat", "hotbar.nbt"];

/// Einträge, die früher schon gezielt „erneut übernommen“ werden konnten: hier wird auch angeboten, wenn sich
/// der Inhalt unterscheidet und die Vibe-Datei neuer ist (das Spiel schreibt `options.txt` bei jedem Beenden).
pub const ALWAYS_COMPARE: &[&str] = &["options.txt", "optionsof.txt", "optionsshaders.txt", "config", "defaultconfigs"];

/// Interna des jeweiligen Launchers (oberste Ebene des Spielordners).
pub fn launcher_skip(kind: LauncherKind) -> &'static [&'static str] {
    match kind {
        LauncherKind::Curseforge => &["minecraftinstance.json", ".curseclient"],
        // `disabledmods` = deaktivierte Mods (kommen beim Import als `mods/*.disabled`), `jarmods` = Jar-Mods
        LauncherKind::Atlauncher => &["instance.json", "instance.png", "disabledmods", "jarmods"],
        // sehr alte Modrinth-App: Profil-Metadaten im Profilordner
        LauncherKind::Modrinth => &["profile.json"],
        // NoRisk-eigene Daten laufen nur im NoRisk-Launcher, Mods kommen über Modrinth bzw. als passende lose JARs
        LauncherKind::Norisk => &["NoRiskClient", "optionsNRC.json", "custom_mods", "mods", "backups"],
        // Prism/MultiMC: Instanz-Metadaten (`instance.cfg`, `mmc-pack.json`, `patches/` …) liegen neben dem Spielordner
        LauncherKind::Gdlauncher => super::gdlauncher::LEGACY_SKIP,
        LauncherKind::Prism | LauncherKind::Multimc | LauncherKind::Folder => &[],
    }
}

/// Konto- bzw. Token-Dateien (jede Ebene). Nie öffnen, nie kopieren.
pub fn is_secret(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    l == "accounts.json"
        || l == "microsoft_accounts.json"
        || l.starts_with("launcher_accounts")
        || l.starts_with("launcher_msa_credentials")
        || (l.starts_with("launcher_profiles") && l.ends_with(".json"))
}

fn is_runtime(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    RUNTIME.iter().any(|s| s.eq_ignore_ascii_case(name)) || (l.starts_with("hs_err_pid") && l.ends_with(".log")) || l.ends_with(".dat_old") || l.ends_with(".tmp")
}

/// Wird dieser Eintrag (oberste Ebene des Spielordners) übersprungen?
pub fn skip_top(kind: LauncherKind, purpose: Purpose, name: &str) -> bool {
    if is_secret(name) || is_runtime(name) || is_vanilla_launcher(name) || (kind == LauncherKind::Gdlauncher && super::gdlauncher::skip_top(name)) || launcher_skip(kind).iter().any(|s| s.eq_ignore_ascii_case(name)) {
        return true;
    }
    purpose == Purpose::Reimport && (name.eq_ignore_ascii_case("mods") || name.eq_ignore_ascii_case("custom_mods"))
}

/// Wird eine Datei/ein Ordner unterhalb der obersten Ebene übersprungen? (Nur Konten/Tokens.)
pub fn skip_inner(name: &str) -> bool {
    is_secret(name)
}

// ------------------------------------------------------------------ Vergleich (Nachimport)

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DataKind {
    File,
    Dir,
    World,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DataStatus {
    /// Fehlt in Vibe ganz (war beim Import noch nicht da bzw. wurde damals nicht übernommen)
    Missing,
    /// Ordner da, aber einzelne Dateien fehlen
    Partial,
    /// In der Quelle neuer (nach dem Import im alten Launcher geändert)
    Newer,
    /// Unterschiedlich, die Vibe-Fassung ist neuer (nur [`ALWAYS_COMPARE`])
    Changed,
    /// Kam beim Import mit, wurde in Vibe aber gelöscht – nicht vorausgewählt
    Removed,
}

/// Ein Eintrag im Abschnitt „Dateien“.
#[derive(Debug, Clone, Serialize)]
pub struct DataEntry {
    /// Relativ zum Spielordner, mit `/`: `xaero`, `options.txt`, `saves/Meine Welt`
    pub path: String,
    pub kind: DataKind,
    /// Weltname aus `level.dat`
    pub name: Option<String>,
    pub status: DataStatus,
    /// Größe in der Quelle (Bytes)
    pub size: u64,
    /// Dateien, die beim Hinzufügen kopiert würden
    pub missing_files: u32,
    pub missing_size: u64,
    /// Dateien, die beim ausdrücklichen Überschreiben ersetzt würden
    pub overwrite_files: u32,
    pub overwrite_size: u64,
    /// Vorausgewählt (nur Hinzufügen, nie Überschreiben)
    pub default_on: bool,
}

/// Auswahl im Dialog: Eintrag übernehmen, optional überschreiben.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DataPick {
    pub path: String,
    #[serde(default)]
    pub overwrite: bool,
}

/// Was beim Import geschah (aus `external.json`).
#[derive(Debug, Clone, Default)]
pub struct Prior {
    pub launcher: Option<LauncherKind>,
    pub imported_at: i64,
    /// Beim Import übernommene Einträge der obersten Ebene; `None` bei älteren Importen
    pub copied: Option<Vec<String>>,
}

impl Prior {
    /// Wurde dieser Eintrag der obersten Ebene beim Import übernommen?
    fn took(&self, top: &str) -> bool {
        match &self.copied {
            Some(list) => list.iter().any(|c| c.eq_ignore_ascii_case(top)),
            // Ältere Importe: NoRisk nach fester Liste, alle anderen den ganzen Spielordner
            None if self.launcher == Some(LauncherKind::Norisk) => LEGACY_NORISK_COPY.iter().any(|c| c.eq_ignore_ascii_case(top)),
            None => true,
        }
    }
    /// Gab es die Datei schon beim Import (Erstellzeit, ersatzweise Änderungszeit)?
    fn existed(&self, m: &std::fs::Metadata) -> bool {
        if self.imported_at <= 0 {
            return true;
        }
        let t = m.created().or_else(|_| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64);
        t.map_or(true, |t| t <= self.imported_at)
    }
    /// Kam diese Datei beim Import mit (und fehlt jetzt, weil sie in Vibe gelöscht wurde)?
    fn copied_file(&self, top: &str, m: &std::fs::Metadata) -> bool {
        self.took(top) && self.existed(m)
    }
}

/// Toleranz für Zeitstempel (FAT/Netzlaufwerke runden auf 2 s).
const MTIME_SLACK_MS: i64 = 2_000;
/// Höchstens so viele Dateien je Instanz vergleichen.
const MAX_FILES: usize = 200_000;

fn mtime_ms(m: &std::fs::Metadata) -> i64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn same_content(a: &Path, b: &Path, size: u64) -> bool {
    use sha1::Digest;
    if size > 8 * 1024 * 1024 {
        return false;
    }
    match (std::fs::read(a), std::fs::read(b)) {
        (Ok(x), Ok(y)) => sha1::Sha1::digest(x) == sha1::Sha1::digest(y),
        _ => false,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FileState {
    Same,
    /// fehlt in Vibe, ist neu in der Quelle
    Missing,
    /// fehlt in Vibe, kam aber beim Import mit
    Deleted,
    Newer,
    /// unterschiedlich, Vibe neuer
    Older,
}

fn file_state(src: &Path, sm: &std::fs::Metadata, dst: &Path, top: &str, prior: &Prior) -> FileState {
    let Ok(dm) = std::fs::metadata(dst) else {
        return if prior.copied_file(top, sm) { FileState::Deleted } else { FileState::Missing };
    };
    if !dm.is_file() {
        return FileState::Same;
    }
    let (st, dt) = (mtime_ms(sm), mtime_ms(&dm));
    if sm.len() == dm.len() && (st - dt).abs() <= MTIME_SLACK_MS {
        return FileState::Same;
    }
    if sm.len() == dm.len() && same_content(src, dst, sm.len()) {
        return FileState::Same;
    }
    if st > dt + MTIME_SLACK_MS {
        FileState::Newer
    } else {
        FileState::Older
    }
}

/// Dateien unterhalb eines Ordners (Junctions/Symlinks werden mit Zyklusschutz verfolgt, ohne Konten/Tokens).
fn walk_files(dir: &Path, budget: &mut usize) -> Vec<(PathBuf, std::fs::Metadata)> {
    srctree::walk(dir, budget).into_iter().map(|(abs, _, m)| (abs, m)).collect()
}

fn rel_str(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

/// Weltordner? (`level.dat` vorhanden)
fn is_world(dir: &Path) -> bool {
    dir.join("level.dat").is_file() || dir.join("level.dat_old").is_file()
}

fn world_name(dir: &Path) -> Option<String> {
    let bytes = std::fs::read(dir.join("level.dat")).ok()?;
    let root = super::nbt::parse_maybe_gzip(&bytes).ok()?;
    let data = root.get("Data").cloned().unwrap_or(root);
    data.get("LevelName").and_then(|v| v.as_str()).map(str::to_string).filter(|s| !s.trim().is_empty())
}

/// Top-Level-Einträge der Quelle (samt Overlays), die nachimportiert werden können (sortiert).
fn top_entries(src: &Path, ov: &[Overlay], kind: LauncherKind) -> Vec<(String, PathBuf)> {
    srctree::tops(src, ov).into_iter().filter(|n| !skip_top(kind, Purpose::Reimport, n)).filter_map(|n| Some((n.clone(), srctree::locate(src, Path::new(&n), ov)?))).collect()
}

fn world_entry(src_world: &Path, dst_world: &Path, rel: String, prior: &Prior, budget: &mut usize) -> Option<DataEntry> {
    let files = walk_files(src_world, budget);
    let size: u64 = files.iter().map(|(_, m)| m.len()).sum();
    let name = world_name(src_world);
    let level = |d: &Path| std::fs::metadata(d.join("level.dat")).or_else(|_| std::fs::metadata(d.join("level.dat_old"))).ok();
    let count = files.len() as u32;
    let (status, default_on) = if !dst_world.exists() {
        let sm = std::fs::metadata(src_world).ok()?;
        if prior.copied_file("saves", &level(src_world).unwrap_or(sm)) {
            (DataStatus::Removed, false)
        } else {
            (DataStatus::Missing, true)
        }
    } else {
        // In der Quelle weitergespielt? (level.dat wird bei jedem Speichern geschrieben)
        let (Some(a), Some(b)) = (level(src_world), level(dst_world)) else { return None };
        if mtime_ms(&a) > mtime_ms(&b) + MTIME_SLACK_MS {
            (DataStatus::Newer, false)
        } else {
            return None;
        }
    };
    let missing = matches!(status, DataStatus::Missing | DataStatus::Removed);
    Some(DataEntry {
        path: rel,
        kind: DataKind::World,
        name,
        status,
        size,
        missing_files: if missing { count } else { 0 },
        missing_size: if missing { size } else { 0 },
        overwrite_files: if missing { 0 } else { count },
        overwrite_size: if missing { 0 } else { size },
        default_on,
    })
}

/// Vergleicht den Spielordner der Quelle mit dem der Vibe-Instanz. Gleiche Einträge fehlen in der Liste.
pub fn scan(src: &Path, ov: &[Overlay], dst: &Path, kind: LauncherKind, prior: &Prior) -> Vec<DataEntry> {
    let mut out = Vec::new();
    let mut worlds = Vec::new();
    let mut budget = MAX_FILES;
    for (name, path) in top_entries(src, ov, kind) {
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        let always = ALWAYS_COMPARE.iter().any(|a| a.eq_ignore_ascii_case(&name));
        if meta.is_dir() && name.eq_ignore_ascii_case("saves") {
            // Welten einzeln (Ordner ohne level.dat werden ignoriert)
            let dirs: Vec<(String, PathBuf)> = srctree::children(src, Path::new(&name), ov)
                .into_iter()
                .filter_map(|f| Some((f.clone(), srctree::locate(src, &Path::new(&name).join(&f), ov)?)))
                .filter(|(_, p)| p.is_dir() && is_world(p))
                .collect();
            for (folder, w) in dirs {
                if let Some(e) = world_entry(&w, &dst.join(&name).join(&folder), format!("{name}/{folder}"), prior, &mut budget) {
                    worlds.push(e);
                }
            }
            continue;
        }
        if meta.is_file() {
            if budget == 0 {
                break;
            }
            budget -= 1;
            let st = file_state(&path, &meta, &dst.join(&name), &name, prior);
            let (status, missing, over) = match st {
                FileState::Same => continue,
                FileState::Older if !always => continue,
                FileState::Missing => (DataStatus::Missing, true, false),
                FileState::Deleted => (DataStatus::Removed, true, false),
                FileState::Newer => (DataStatus::Newer, false, true),
                FileState::Older => (DataStatus::Changed, false, true),
            };
            out.push(DataEntry {
                path: name.clone(),
                kind: DataKind::File,
                name: None,
                status,
                size: meta.len(),
                missing_files: missing as u32,
                missing_size: if missing { meta.len() } else { 0 },
                overwrite_files: over as u32,
                overwrite_size: if over { meta.len() } else { 0 },
                default_on: status == DataStatus::Missing,
            });
            continue;
        }
        if !meta.is_dir() {
            continue;
        }
        let files: Vec<srctree::Entry> = srctree::files(src, Path::new(&name), ov, &mut budget);
        if files.is_empty() {
            continue;
        }
        let dst_exists = dst.join(&name).is_dir();
        let mut e = DataEntry {
            path: name.clone(),
            kind: DataKind::Dir,
            name: None,
            status: DataStatus::Missing,
            size: 0,
            missing_files: 0,
            missing_size: 0,
            overwrite_files: 0,
            overwrite_size: 0,
            default_on: false,
        };
        let mut deleted = (0u32, 0u64);
        for fe in &files {
            let (f, m, rel) = (&fe.abs, &fe.meta, &fe.rel);
            e.size += m.len();
            match file_state(f, m, &dst.join(rel), &name, prior) {
                FileState::Missing => {
                    e.missing_files += 1;
                    e.missing_size += m.len();
                }
                FileState::Deleted => {
                    deleted.0 += 1;
                    deleted.1 += m.len();
                }
                FileState::Newer => {
                    e.overwrite_files += 1;
                    e.overwrite_size += m.len();
                }
                FileState::Older if always => {
                    e.overwrite_files += 1;
                    e.overwrite_size += m.len();
                }
                _ => {}
            }
        }
        if !dst_exists && e.missing_files == 0 && deleted.0 > 0 {
            // Ganzer Ordner in Vibe gelöscht: zum Wiederherstellen anbieten, aber nicht vorauswählen
            e.status = DataStatus::Removed;
            e.missing_files = deleted.0;
            e.missing_size = deleted.1;
        } else if e.missing_files > 0 {
            e.status = if dst_exists { DataStatus::Partial } else { DataStatus::Missing };
            e.default_on = true;
        } else if e.overwrite_files > 0 {
            e.status = if always && !has_newer(&files, dst, &name, prior) { DataStatus::Changed } else { DataStatus::Newer };
        } else {
            continue;
        }
        out.push(e);
    }
    out.extend(worlds);
    out
}

fn has_newer(files: &[srctree::Entry], dst: &Path, top: &str, prior: &Prior) -> bool {
    files.iter().any(|e| file_state(&e.abs, &e.meta, &dst.join(&e.rel), top, prior) == FileState::Newer)
}

// ------------------------------------------------------------------ Nachkopieren

/// Eine Kopieraktion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CopyOp {
    pub from: PathBuf,
    /// relativ zum Spielordner
    pub rel: PathBuf,
    pub size: u64,
    /// ersetzt eine vorhandene Datei
    pub replace: bool,
}

#[derive(Debug, Clone, Default)]
pub struct CopyPlan {
    pub ops: Vec<CopyOp>,
    /// Welten (Ordnername in `saves/`), die komplett ersetzt werden – vorher Welt-Backup
    pub replace_worlds: Vec<String>,
}

impl CopyPlan {
    pub fn is_empty(&self) -> bool {
        self.ops.is_empty()
    }
    pub fn total(&self) -> u64 {
        self.ops.iter().map(|o| o.size).sum()
    }
    /// Berührt der Plan Bereiche, die ein Snapshot sichert (Configs, Packs, Optionen)?
    pub fn touches_snapshot(&self) -> bool {
        self.ops.iter().any(|o| {
            let top = o.rel.components().next().map(|c| c.as_os_str().to_string_lossy().to_string()).unwrap_or_default();
            super::snapshots::DIRS.iter().chain(super::snapshots::FILES).any(|d| d.eq_ignore_ascii_case(&top))
        })
    }
}

/// Gewählte Einträge in Kopieraktionen übersetzen (frisch gegen den aktuellen Stand geprüft).
/// Nur Einträge, die [`scan`] anbietet; Pfade außerhalb des Spielordners werden verworfen.
pub fn plan(src: &Path, ov: &[Overlay], dst: &Path, kind: LauncherKind, prior: &Prior, picks: &[DataPick]) -> CopyPlan {
    let offered: Vec<DataEntry> = scan(src, ov, dst, kind, prior);
    let mut plan = CopyPlan::default();
    let mut seen = HashSet::new();
    let mut budget = MAX_FILES;
    for p in picks {
        let Some(e) = offered.iter().find(|e| e.path == p.path) else { continue };
        if !seen.insert(e.path.clone()) {
            continue;
        }
        let rel = PathBuf::from(&e.path);
        let top = rel.components().next().map(|c| c.as_os_str().to_string_lossy().to_string()).unwrap_or_default();
        let always = ALWAYS_COMPARE.iter().any(|a| a.eq_ignore_ascii_case(&top));
        match e.kind {
            DataKind::World => {
                let exists = dst.join(&rel).exists();
                if exists && !p.overwrite {
                    continue;
                }
                if exists {
                    plan.replace_worlds.push(rel.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
                }
                for f in srctree::files(src, &rel, ov, &mut budget) {
                    plan.ops.push(CopyOp { size: f.meta.len(), from: f.abs, rel: f.rel, replace: false });
                }
            }
            DataKind::File | DataKind::Dir => {
                let restore = e.status == DataStatus::Removed;
                for fe in srctree::files(src, &rel, ov, &mut budget) {
                    let (f, m, r) = (fe.abs, fe.meta, fe.rel);
                    let st = file_state(&f, &m, &dst.join(&r), &top, prior);
                    let (take, replace) = match st {
                        FileState::Missing => (true, false),
                        FileState::Deleted => (restore, false),
                        FileState::Newer => (p.overwrite, true),
                        FileState::Older => (p.overwrite && always, true),
                        FileState::Same => (false, false),
                    };
                    if take {
                        plan.ops.push(CopyOp { from: f, rel: r, size: m.len(), replace });
                    }
                }
            }
        }
    }
    plan
}

/// Plan ausführen. Ersetzte Dateien außerhalb der Snapshot-Bereiche und außerhalb ersetzter Welten werden vorher
/// nach `keep` gesichert (gleiche relative Pfade). Welten in `replace_worlds` werden vorher geleert
/// (Welt-Backup macht der Aufrufer). `on_progress(kopierte Bytes)`; `check` bricht ab.
pub fn execute(
    plan: &CopyPlan,
    dst: &Path,
    keep: &Path,
    mut on_progress: impl FnMut(u64),
    check: impl Fn() -> crate::error::AppResult<()>,
) -> crate::error::AppResult<u32> {
    use crate::error::AppError;
    let in_snapshot = |rel: &Path| {
        let top = rel.components().next().map(|c| c.as_os_str().to_string_lossy().to_string()).unwrap_or_default();
        super::snapshots::DIRS.iter().chain(super::snapshots::FILES).any(|d| d.eq_ignore_ascii_case(&top))
    };
    for w in &plan.replace_worlds {
        if w.is_empty() || w.contains(['/', '\\']) || w == ".." {
            continue;
        }
        let d = dst.join("saves").join(w);
        if d.is_dir() {
            std::fs::remove_dir_all(&d).map_err(|e| AppError::msg(format!("Welt {w} konnte nicht ersetzt werden: {e}")))?;
        }
    }
    let mut done = 0u64;
    let mut n = 0u32;
    for (i, op) in plan.ops.iter().enumerate() {
        if i % 32 == 0 {
            check()?;
        }
        // Nur innerhalb des Spielordners schreiben
        if op.rel.is_absolute() || op.rel.components().any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::Prefix(_) | std::path::Component::RootDir)) {
            continue;
        }
        let to = dst.join(&op.rel);
        if op.replace && to.is_file() && !in_snapshot(&op.rel) {
            let b = keep.join(&op.rel);
            if let Some(p) = b.parent() {
                std::fs::create_dir_all(p)?;
            }
            std::fs::copy(&to, &b).map_err(|e| AppError::msg(format!("{} konnte nicht gesichert werden: {e}", op.rel.display())))?;
        }
        if let Some(p) = to.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::copy(&op.from, &to).map_err(|e| AppError::msg(format!("{} konnte nicht kopiert werden: {e}", rel_str(&op.rel))))?;
        done += op.size;
        n += 1;
        on_progress(done);
    }
    Ok(n)
}

/// Namen der obersten Ebene, die ein Import übernommen hat (für `external.json`).
pub fn top_names<'a>(rels: impl Iterator<Item = &'a Path>) -> Vec<String> {
    let mut v: Vec<String> = rels.filter_map(|r| r.components().next()).map(|c| c.as_os_str().to_string_lossy().to_string()).collect();
    v.sort_by_key(|s| s.to_lowercase());
    v.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("vl-gd-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn write(p: &Path, s: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, s).unwrap();
    }

    fn set_mtime(p: &Path, ms: i64) {
        let f = std::fs::File::options().write(true).open(p).unwrap();
        f.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_millis(ms as u64)).unwrap();
    }

    fn by<'a>(v: &'a [DataEntry], p: &str) -> Option<&'a DataEntry> {
        v.iter().find(|e| e.path == p)
    }

    #[test]
    fn rules_all_launchers() {
        use LauncherKind::*;
        for k in [Modrinth, Prism, Multimc, Curseforge, Atlauncher, Norisk, Folder] {
            for keep in ["config", "saves", "xaero", "XaeroWaypoints", "journeymap", "schematics", "screenshots", "options.txt", "servers.dat", "resourcepacks", "shaderpacks", "kubejs", "essential"] {
                assert!(!skip_top(k, Purpose::Import, keep), "{k:?}: {keep} muss mitkommen");
                assert!(!skip_top(k, Purpose::Reimport, keep), "{k:?}: {keep} muss nachimportierbar sein");
            }
            for skip in ["logs", "crash-reports", "hs_err_pid123.log", "servers.dat_old", "usercache.json", ".fabric", "accounts.json", "launcher_accounts.json", "launcher_accounts_microsoft_store.json", "launcher_profiles.json", "versions", "libraries", "assets"] {
                assert!(skip_top(k, Purpose::Import, skip), "{k:?}: {skip} darf nicht mitkommen");
            }
            // Mods nie beim Nachimport
            assert!(skip_top(k, Purpose::Reimport, "mods"));
        }
        // Mods beim Import: Kopie (außer NoRisk – dort über Modrinth/lose JARs)
        assert!(!skip_top(Prism, Purpose::Import, "mods"));
        assert!(skip_top(Norisk, Purpose::Import, "mods"));
        assert!(skip_top(Norisk, Purpose::Import, "NoRiskClient") && skip_top(Norisk, Purpose::Import, "optionsNRC.json"));
        assert!(!skip_top(Prism, Purpose::Import, "NoRiskClient"), "nur bei NoRisk Launcher-intern");
        assert!(skip_top(Curseforge, Purpose::Import, "minecraftinstance.json"));
        assert!(skip_top(Atlauncher, Purpose::Import, "instance.json"));
        assert!(skip_inner("accounts.json") && skip_inner("microsoft_accounts.json") && !skip_inner("waypoints.txt"));
    }

    #[test]
    fn official_launcher_internals() {
        for skip in [
            "launcher_entitlements_microsoft_store.json",
            "launcher_product_state_microsoft_store.json",
            "launcher_ui_state_microsoft_store.json",
            "launcher_gamer_pics_microsoft_store.json",
            "launcher_msa_credentials_microsoft_store.bin",
            "launcher_cef_log.txt",
            "clientId_v2.txt",
            "clientId.txt",
            "staging",
            "quickPlay",
            "webcache2",
        ] {
            assert!(skip_top(LauncherKind::Folder, Purpose::Import, skip), "{skip} ist Launcher-intern");
        }
        for keep in ["options.txt", "launcher.png", "resourcepacks", "screenshots", "pvpai-models"] {
            assert!(!skip_top(LauncherKind::Folder, Purpose::Import, keep), "{keep} gehört zum Spiel");
        }
    }

    /// Früherer NoRisk-Import (feste Liste): `xaero/` fehlt, Welt wurde übernommen, in der Quelle weitergespielt.
    #[test]
    fn scan_legacy_norisk() {
        let root = tmp();
        let (src, dst) = (root.join("src"), root.join("dst"));
        let t0 = 1_700_000_000_000i64;
        write(&src.join("xaero/minimap/Multiplayer_x/waypoints.txt"), "w");
        write(&src.join("journeymap/data/a.dat"), "jm");
        write(&src.join("options.txt"), "fov:1");
        write(&src.join("saves/Alt/level.dat"), "lvl2");
        write(&src.join("saves/Neu/level.dat"), "lvl");
        write(&src.join("saves/kein-welt/foo.txt"), "x");
        write(&src.join("logs/latest.log"), "log");
        write(&src.join("mods/a.jar"), "jar");
        write(&src.join("NoRiskClient/x.json"), "nrc");
        write(&src.join("essential/microsoft_accounts.json"), "TOKEN");
        write(&src.join("essential/settings.json"), "{}");
        write(&dst.join("options.txt"), "fov:1");
        write(&dst.join("saves/Alt/level.dat"), "lvl1");
        set_mtime(&dst.join("saves/Alt/level.dat"), t0);
        set_mtime(&src.join("saves/Alt/level.dat"), t0 + 3_600_000);
        // Import lange vor dem Anlegen der Fixtures -> alles in der Quelle ist „neu seit dem Import“
        let prior = Prior { launcher: Some(LauncherKind::Norisk), imported_at: 1_000, copied: None };
        let v = scan(&src, &[], &dst, LauncherKind::Norisk, &prior);
        let x = by(&v, "xaero").unwrap();
        assert_eq!((x.status, x.kind, x.missing_files, x.default_on), (DataStatus::Missing, DataKind::Dir, 1, true));
        assert_eq!(by(&v, "journeymap").unwrap().status, DataStatus::Missing);
        // Welten einzeln: neue fehlt, alte in der Quelle weitergespielt
        let neu = by(&v, "saves/Neu").unwrap();
        assert_eq!((neu.kind, neu.status, neu.default_on), (DataKind::World, DataStatus::Missing, true));
        let alt = by(&v, "saves/Alt").unwrap();
        assert_eq!((alt.status, alt.default_on), (DataStatus::Newer, false));
        assert!(by(&v, "saves/kein-welt").is_none());
        // gleiche Datei, Logs, Mods, NoRisk-Interna und Tokens nicht
        assert!(by(&v, "options.txt").is_none());
        for p in ["logs", "mods", "NoRiskClient"] {
            assert!(by(&v, p).is_none(), "{p}");
        }
        assert_eq!(by(&v, "essential").unwrap().missing_files, 1, "Konto-Datei wird nicht mitgezählt");

        // Standard übernehmen: nur Fehlendes, keine Welt ersetzt, keine Tokens
        let picks: Vec<DataPick> = v.iter().filter(|e| e.default_on).map(|e| DataPick { path: e.path.clone(), overwrite: false }).collect();
        let p = plan(&src, &[], &dst, LauncherKind::Norisk, &prior, &picks);
        assert!(p.replace_worlds.is_empty() && p.ops.iter().all(|o| !o.replace));
        let keep = root.join("keep");
        execute(&p, &dst, &keep, |_| {}, || Ok(())).unwrap();
        assert!(dst.join("xaero/minimap/Multiplayer_x/waypoints.txt").is_file());
        assert!(dst.join("saves/Neu/level.dat").is_file());
        assert_eq!(std::fs::read_to_string(dst.join("saves/Alt/level.dat")).unwrap(), "lvl1", "nicht überschrieben");
        assert!(!dst.join("essential/microsoft_accounts.json").exists());
        assert!(!dst.join("mods").exists() && !dst.join("logs").exists());
        // Danach: nur noch die neuere Welt
        let v2 = scan(&src, &[], &dst, LauncherKind::Norisk, &prior);
        assert_eq!(v2.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), vec!["saves/Alt"]);
        // Ausdrücklich ersetzen
        let p = plan(&src, &[], &dst, LauncherKind::Norisk, &prior, &[DataPick { path: "saves/Alt".into(), overwrite: true }]);
        assert_eq!(p.replace_worlds, vec!["Alt".to_string()]);
        execute(&p, &dst, &keep, |_| {}, || Ok(())).unwrap();
        assert_eq!(std::fs::read_to_string(dst.join("saves/Alt/level.dat")).unwrap(), "lvl2");
        std::fs::remove_dir_all(&root).ok();
    }

    /// Prism-Import mit Liste: in Vibe gelöschte Dinge werden nicht vorausgewählt; neuere Dateien nur ausdrücklich.
    #[test]
    fn scan_removed_and_overwrite() {
        let root = tmp();
        let (src, dst) = (root.join("src"), root.join("dst"));
        write(&src.join("screenshots/a.png"), "a");
        write(&src.join("schematics/haus.litematic"), "neu");
        write(&src.join("config/jei.toml"), "a=2");
        write(&src.join("config/neu.toml"), "n");
        write(&src.join("servers.dat"), "srv");
        write(&dst.join("schematics/haus.litematic"), "alt");
        write(&dst.join("config/jei.toml"), "a=1");
        write(&dst.join("servers.dat"), "srv-vibe");
        let old = 1_600_000_000_000i64;
        set_mtime(&dst.join("schematics/haus.litematic"), old);
        set_mtime(&src.join("schematics/haus.litematic"), old + 100_000);
        set_mtime(&src.join("servers.dat"), old);
        set_mtime(&dst.join("servers.dat"), old + 100_000);
        set_mtime(&src.join("config/jei.toml"), old);
        set_mtime(&dst.join("config/jei.toml"), old + 100_000);
        // Alles existierte schon beim Import (Erstellzeit < imported_at), screenshots wurde übernommen
        let prior = Prior { launcher: Some(LauncherKind::Prism), imported_at: i64::MAX / 2, copied: Some(vec!["screenshots".into(), "schematics".into(), "config".into(), "servers.dat".into()]) };
        let v = scan(&src, &[], &dst, LauncherKind::Prism, &prior);
        let s = by(&v, "screenshots").unwrap();
        assert_eq!((s.status, s.default_on), (DataStatus::Removed, false), "in Vibe gelöscht");
        let sc = by(&v, "schematics").unwrap();
        assert_eq!((sc.status, sc.overwrite_files, sc.default_on), (DataStatus::Newer, 1, false));
        // config: neu.toml existierte schon beim Import -> gilt als gelöscht; jei.toml unterschiedlich (Vibe neuer)
        let c = by(&v, "config").unwrap();
        assert_eq!((c.status, c.overwrite_files), (DataStatus::Changed, 1));
        // servers.dat: Vibe neuer, nicht in ALWAYS_COMPARE -> nicht angeboten
        assert!(by(&v, "servers.dat").is_none());

        // Ohne overwrite passiert bei „neuer“ nichts
        assert!(plan(&src, &[], &dst, LauncherKind::Prism, &prior, &[DataPick { path: "schematics".into(), overwrite: false }]).is_empty());
        let p = plan(&src, &[], &dst, LauncherKind::Prism, &prior, &[DataPick { path: "schematics".into(), overwrite: true }, DataPick { path: "screenshots".into(), overwrite: false }]);
        assert_eq!(p.ops.len(), 2);
        assert!(!p.touches_snapshot());
        let keep = root.join("keep");
        execute(&p, &dst, &keep, |_| {}, || Ok(())).unwrap();
        assert_eq!(std::fs::read_to_string(dst.join("schematics/haus.litematic")).unwrap(), "neu");
        assert_eq!(std::fs::read_to_string(keep.join("schematics/haus.litematic")).unwrap(), "alt", "alte Fassung gesichert");
        assert!(dst.join("screenshots/a.png").is_file(), "ausdrücklich wiederhergestellt");
        // config überschreiben -> Snapshot-Bereich (keine Extra-Sicherung)
        let p = plan(&src, &[], &dst, LauncherKind::Prism, &prior, &[DataPick { path: "config".into(), overwrite: true }]);
        assert!(p.touches_snapshot());
        assert_eq!(p.ops.len(), 1);
        // Unbekannte/manipulierte Pfade werden ignoriert
        assert!(plan(&src, &[], &dst, LauncherKind::Prism, &prior, &[DataPick { path: "../x".into(), overwrite: true }]).is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn new_files_after_import_count_as_missing() {
        let root = tmp();
        let (src, dst) = (root.join("src"), root.join("dst"));
        write(&src.join("screenshots/neu.png"), "n");
        std::fs::create_dir_all(dst.join("screenshots")).unwrap();
        // Import vor langer Zeit -> Datei ist neu
        let prior = Prior { launcher: Some(LauncherKind::Modrinth), imported_at: 1_000, copied: Some(vec!["screenshots".into()]) };
        let v = scan(&src, &[], &dst, LauncherKind::Modrinth, &prior);
        let s = by(&v, "screenshots").unwrap();
        assert_eq!((s.status, s.missing_files, s.default_on), (DataStatus::Partial, 1, true));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn top_names_dedup() {
        let rels = [PathBuf::from("config/a"), PathBuf::from("Config/b"), PathBuf::from("options.txt"), PathBuf::from("xaero/x")];
        assert_eq!(top_names(rels.iter().map(PathBuf::as_path)), vec!["config", "options.txt", "xaero"]);
    }
}
