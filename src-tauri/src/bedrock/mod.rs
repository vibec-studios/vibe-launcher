//! Minecraft Bedrock als eigener Instanztyp: Erkennung, getrennte Profile (Tausch der `com.mojang`-Ordner),
//! Add-ons (CurseForge + Dateien), Welten, Start über das installierte Spiel.
//!
//! Verfahren und Grenzen: docs/BEDROCK.md. Kein Code aus anderen (GPL/AGPL-)Launchern übernommen.
//!
//! Sicherheitsnetz für die Entwicklung: Debug-Builds fassen echte Bedrock-Daten nur an, wenn
//! `VIBE_BEDROCK_REAL=1` gesetzt ist. Mit `VIBE_BEDROCK_ROOT=<ordner>` liegen alle Bedrock-Pfade unter
//! diesem Ordner (wie `%AppData%`), und „Spielen“ startet das echte Spiel nicht, sondern simuliert eine
//! Sitzung (`VIBE_BEDROCK_SIM_SECS`, Standard 20 s).
use crate::error::{AppError, AppResult};
use crate::instance::{BedrockChannel, BedrockProfile, Instance};
use crate::paths::Paths;
use serde::Serialize;
use std::path::{Path, PathBuf};

pub mod cf;
pub mod detect;
pub mod game;
pub mod manifest;
pub mod packs;
pub mod swap;
pub mod worlds;

/// Gemeinsamer Ordner für Packs im GDK-Layout (`Users/Shared/games/com.mojang`).
pub const SHARED_USER: &str = "Shared";

/// Aufbau der echten Spieldaten.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Layout {
    /// Ab 1.21.120: `<base>/Users/<id>/games/com.mojang` (Welten, Einstellungen) +
    /// `<base>/Users/Shared/games/com.mojang` (Packs)
    Gdk,
    /// Alte Store-App: alles in `<base>/games/com.mojang`
    Uwp,
}

impl Layout {
    /// Vorhandene `com.mojang`-Ordner („Slots“) unter `base`, relativ und mit `/` getrennt, sortiert.
    pub fn slots(&self, base: &Path) -> Vec<String> {
        let mut out = Vec::new();
        match self {
            Layout::Uwp => {
                if base.join("games").join("com.mojang").is_dir() {
                    out.push("games/com.mojang".to_string());
                }
            }
            Layout::Gdk => {
                if let Ok(rd) = std::fs::read_dir(base.join("Users")) {
                    for e in rd.flatten() {
                        let name = e.file_name().to_string_lossy().to_string();
                        if !valid_user_dir(&name) {
                            continue;
                        }
                        if e.path().join("games").join("com.mojang").is_dir() {
                            out.push(format!("Users/{name}/games/com.mojang"));
                        }
                    }
                }
            }
        }
        out.sort();
        out
    }

    /// Slot mit den Packs (`resource_packs`, `behavior_packs` …).
    pub fn packs_slot(&self) -> String {
        match self {
            Layout::Gdk => format!("Users/{SHARED_USER}/games/com.mojang"),
            Layout::Uwp => "games/com.mojang".into(),
        }
    }

    /// Slots, die Welten enthalten können (GDK: alle Spieler außer `Shared`).
    pub fn world_slots(&self, base: &Path) -> Vec<String> {
        match self {
            Layout::Uwp => self.slots(base),
            Layout::Gdk => self.slots(base).into_iter().filter(|s| s != &self.packs_slot()).collect(),
        }
    }
}

/// Nur harmlose Ordnernamen unter `Users/` (Zahlen-IDs, `Shared`).
fn valid_user_dir(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') && !name.starts_with('.')
}

/// Relativer Slot-Pfad -> absoluter Pfad unter `base`.
pub fn slot_path(base: &Path, slot: &str) -> PathBuf {
    let mut p = base.to_path_buf();
    for c in slot.split('/') {
        p.push(c);
    }
    p
}

// ------------------------------------------------------------------ Orte der echten Daten

/// Wo das Spiel eines Kanals seine Daten hat.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub channel: BedrockChannel,
    pub base: PathBuf,
    pub layout: Layout,
}

impl Target {
    pub fn packs_dir(&self) -> PathBuf {
        slot_path(&self.base, &self.layout.packs_slot())
    }
}

/// Paketfamilien (für Registry-Suche und Store-Links).
pub fn package_family(channel: BedrockChannel) -> &'static str {
    match channel {
        BedrockChannel::Release => "Microsoft.MinecraftUWP_8wekyb3d8bbwe",
        BedrockChannel::Preview => "Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe",
    }
}

/// Store-Seite zum Installieren.
pub fn store_url(channel: BedrockChannel) -> &'static str {
    match channel {
        BedrockChannel::Release => "ms-windows-store://pdp/?productid=9NBLGGH2JHXJ",
        BedrockChannel::Preview => "ms-windows-store://search/?query=Minecraft%20Preview",
    }
}

fn gdk_dir_name(channel: BedrockChannel) -> &'static str {
    match channel {
        BedrockChannel::Release => "Minecraft Bedrock",
        BedrockChannel::Preview => "Minecraft Bedrock Preview",
    }
}

/// Test-/Entwicklungsordner statt echter Pfade (nur Debug-Builds).
pub fn dev_root() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        std::env::var_os("VIBE_BEDROCK_ROOT").filter(|v| !v.is_empty()).map(PathBuf::from)
    } else {
        None
    }
}

/// Dürfen echte Bedrock-Daten angefasst werden? (Release immer; Debug nur mit `VIBE_BEDROCK_REAL=1`)
pub fn real_allowed() -> bool {
    !cfg!(debug_assertions) || std::env::var_os("VIBE_BEDROCK_REAL").is_some()
}

/// Spiel nur simulieren (Debug mit `VIBE_BEDROCK_ROOT`).
pub fn simulated() -> bool {
    dev_root().is_some()
}

/// GDK- und UWP-Basisordner eines Kanals unter einem `%AppData%`/`%LocalAppData%`-Paar.
fn bases(roaming: &Path, local: &Path, channel: BedrockChannel) -> (PathBuf, PathBuf) {
    (
        roaming.join(gdk_dir_name(channel)),
        local.join("Packages").join(package_family(channel)).join("LocalState"),
    )
}

/// Layout wählen: GDK, sobald dessen Ordner existiert oder es keine alten UWP-Daten gibt.
pub fn choose(channel: BedrockChannel, gdk: PathBuf, uwp: PathBuf) -> Target {
    if !gdk.exists() && uwp.join("games").join("com.mojang").is_dir() {
        Target { channel, base: uwp, layout: Layout::Uwp }
    } else {
        Target { channel, base: gdk, layout: Layout::Gdk }
    }
}

/// Echte (bzw. Test-)Datenorte eines Kanals.
pub fn target(channel: BedrockChannel) -> AppResult<Target> {
    if let Some(root) = dev_root() {
        let (g, u) = bases(&root, &root, channel);
        return Ok(choose(channel, g, u));
    }
    if !real_allowed() {
        return Err(AppError::NotConfigured(
            "Entwicklungs-Build: echte Bedrock-Daten sind gesperrt. VIBE_BEDROCK_ROOT (Testordner) oder VIBE_BEDROCK_REAL=1 setzen.".into(),
        ));
    }
    if !cfg!(windows) {
        return Err(AppError::Invalid("Minecraft Bedrock gibt es nur unter Windows.".into()));
    }
    let roaming = dirs::data_dir().ok_or_else(|| AppError::msg("%AppData% nicht gefunden"))?;
    let local = dirs::data_local_dir().ok_or_else(|| AppError::msg("%LocalAppData% nicht gefunden"))?;
    let (g, u) = bases(&roaming, &local, channel);
    Ok(choose(channel, g, u))
}

// ------------------------------------------------------------------ Launcher-eigene Ordner

/// `<daten>/bedrock/` – Journal, Parkplatz, Sicherungen.
pub fn launcher_dir(paths: &Paths) -> PathBuf {
    paths.root.join("bedrock")
}

/// Eigenes Profil einer Instanz (Slots wie im echten Ordner).
pub fn profile_dir(paths: &Paths, instance_id: &str) -> PathBuf {
    paths.instance_dir(instance_id).join("bedrock")
}

pub fn swapper(paths: &Paths, t: &Target) -> swap::Swapper {
    let dir = launcher_dir(paths);
    swap::Swapper {
        target: t.base.clone(),
        layout: t.layout,
        park: dir.join("park").join(t.channel.as_str()),
        journal: dir.join(format!("swap-{}.json", t.channel.as_str())),
        rescue: dir.join("rescue"),
    }
}

/// Kanal/Profil einer Instanz, Fehler bei Java-Instanzen.
pub fn options(inst: &Instance) -> AppResult<crate::instance::BedrockOptions> {
    inst.bedrock.ok_or_else(|| AppError::Invalid(format!("„{}“ ist keine Bedrock-Instanz", inst.name)))
}

/// Wo die Daten einer Instanz gerade liegen: im echten Ordner (gemeinsames Profil oder gerade eingetauscht)
/// oder im eigenen Profilordner.
#[derive(Debug, Clone)]
pub struct DataLoc {
    pub base: PathBuf,
    pub layout: Layout,
    /// Liegt im echten Spielordner
    pub live: bool,
}

impl DataLoc {
    pub fn packs_dir(&self) -> PathBuf {
        slot_path(&self.base, &self.layout.packs_slot())
    }
    /// Alle Weltordner-Wurzeln (`…/com.mojang/minecraftWorlds`) mit Slot-Namen, die existieren.
    pub fn world_dirs(&self) -> Vec<(String, PathBuf)> {
        self.layout
            .world_slots(&self.base)
            .into_iter()
            .map(|s| {
                let p = slot_path(&self.base, &s).join("minecraftWorlds");
                (s, p)
            })
            .collect()
    }
}

pub fn data_loc(paths: &Paths, inst: &Instance) -> AppResult<DataLoc> {
    let o = options(inst)?;
    let t = target(o.channel)?;
    let sw = swapper(paths, &t);
    let active = sw.active_instance();
    if o.profile == BedrockProfile::Shared {
        // Während eine Instanz mit eigenem Profil eingetauscht ist, liegen im echten Ordner deren Daten
        if active.is_some() {
            return Err(AppError::Invalid(SWAPPED_MSG.into()));
        }
        return Ok(DataLoc { base: t.base, layout: t.layout, live: true });
    }
    if active.as_deref() == Some(inst.id.as_str()) {
        return Ok(DataLoc { base: t.base, layout: t.layout, live: true });
    }
    Ok(DataLoc { base: profile_dir(paths, &inst.id), layout: t.layout, live: false })
}

/// Meldung, wenn die normalen Bedrock-Daten gerade weggetauscht sind.
pub const SWAPPED_MSG: &str =
    "Gerade ist eine Bedrock-Instanz mit eigenem Profil eingetauscht. Sobald das Spiel geschlossen ist, sind hier wieder deine normalen Bedrock-Daten zu sehen.";

/// Datei/Ordner entfernen: in den Papierkorb (in Tests endgültig).
pub fn discard(p: &Path) -> AppResult<()> {
    if !p.exists() {
        return Ok(());
    }
    if !cfg!(test) && trash::delete(p).is_ok() {
        return Ok(());
    }
    if p.is_dir() {
        std::fs::remove_dir_all(p)?;
    } else {
        std::fs::remove_file(p)?;
    }
    Ok(())
}

/// Ordnergröße (Bytes), Fehler werden übersprungen.
pub fn dir_size(p: &Path) -> u64 {
    walkdir::WalkDir::new(p).into_iter().flatten().filter(|e| e.file_type().is_file()).filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum()
}

/// Bild als kleine data:-URL (Icons liegen oft außerhalb des Launcher-Ordners, den das Frontend lesen darf).
pub fn icon_data_url(p: &Path, max: u32) -> Option<String> {
    use base64::Engine;
    let meta = std::fs::metadata(p).ok()?;
    if !meta.is_file() || meta.len() > 8 * 1024 * 1024 {
        return None;
    }
    let bytes = std::fs::read(p).ok()?;
    let img = image::load_from_memory(&bytes).ok()?;
    let img = if img.width() > max || img.height() > max { img.thumbnail(max, max) } else { img };
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).ok()?;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(out.into_inner())))
}

// ------------------------------------------------------------------ Gemeinsame Abläufe (unter Sperre)

/// Etwas mit den Daten einer Bedrock-Instanz tun, während garantiert nicht getauscht wird.
pub fn with_data<T>(paths: &Paths, inst: &Instance, f: impl FnOnce(&DataLoc) -> AppResult<T>) -> AppResult<T> {
    let _g = game::DATA_LOCK.lock();
    let loc = data_loc(paths, inst)?;
    f(&loc)
}

/// Schreibender Zugriff, der bei laufendem Spiel nicht in den echten Ordner darf (Welten löschen/ersetzen).
pub fn with_data_idle<T>(paths: &Paths, inst: &Instance, f: impl FnOnce(&DataLoc) -> AppResult<T>) -> AppResult<T> {
    let ch = options(inst)?.channel;
    with_data(paths, inst, |loc| {
        if loc.live && game::game_running(ch) {
            return Err(AppError::Invalid(swap::RUNNING_MSG.into()));
        }
        f(loc)
    })
}

/// Höchstgröße einer importierten Datei.
pub const MAX_IMPORT: u64 = 4 * 1024 * 1024 * 1024;

/// `.mcpack`/`.mcaddon`/`.mcworld`/`.mctemplate`/`.zip` in eine Instanz übernehmen.
pub async fn import_file(state: &crate::state::AppState, instance_id: &str, path: &Path, source: Option<packs::PackSource>) -> AppResult<packs::ImportResult> {
    let inst = state.instances.get(instance_id)?;
    options(&inst)?;
    let paths = state.paths.clone();
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let meta = std::fs::metadata(&path)?;
        if !meta.is_file() {
            return Err(AppError::Invalid("Keine Datei".into()));
        }
        if meta.len() > MAX_IMPORT {
            return Err(AppError::Invalid("Die Datei ist zu groß".into()));
        }
        let entries = manifest::read_zip(&std::fs::read(&path)?)?;
        with_data(&paths, &inst, |loc| {
            let wd = worlds::import_dir(loc);
            packs::import_entries(&loc.packs_dir(), wd.as_deref(), &entries, source.as_ref())
        })
    })
    .await?
}

/// Darf an der Instanz gerade etwas Grundlegendes passieren (Löschen, Duplizieren)? Nicht, solange ihr
/// Profil eingetauscht ist.
pub fn guard_idle(paths: &Paths, inst: &Instance) -> AppResult<()> {
    let Some(o) = inst.bedrock else { return Ok(()) };
    if o.profile == BedrockProfile::Isolated {
        if let Ok(t) = target(o.channel) {
            if swapper(paths, &t).active_instance().as_deref() == Some(inst.id.as_str()) {
                return Err(AppError::Invalid("Das Profil dieser Bedrock-Instanz ist gerade eingetauscht. Bitte das Spiel schließen und kurz warten.".into()));
            }
        }
    }
    Ok(())
}

/// Leerer Temp-Ordner für Tests.
#[cfg(test)]
pub fn tempdir(tag: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("vl-bedrock-{tag}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&p).unwrap();
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slots_and_layout_choice() {
        let tmp = tempdir("layout");
        let gdk = tmp.join("Minecraft Bedrock");
        let uwp = tmp.join("uwp");
        // Nichts vorhanden -> GDK (aktuelle Versionen)
        assert_eq!(choose(BedrockChannel::Release, gdk.clone(), uwp.clone()).layout, Layout::Gdk);
        std::fs::create_dir_all(uwp.join("games/com.mojang")).unwrap();
        assert_eq!(choose(BedrockChannel::Release, gdk.clone(), uwp.clone()).layout, Layout::Uwp);
        std::fs::create_dir_all(gdk.join("Users/Shared/games/com.mojang")).unwrap();
        std::fs::create_dir_all(gdk.join("Users/123456/games/com.mojang")).unwrap();
        std::fs::create_dir_all(gdk.join("Users/nur-ordner")).unwrap();
        std::fs::create_dir_all(gdk.join("Users/.versteckt/games/com.mojang")).unwrap();
        let t = choose(BedrockChannel::Release, gdk.clone(), uwp);
        assert_eq!(t.layout, Layout::Gdk);
        assert_eq!(Layout::Gdk.slots(&gdk), vec!["Users/123456/games/com.mojang", "Users/Shared/games/com.mojang"]);
        assert_eq!(Layout::Gdk.world_slots(&gdk), vec!["Users/123456/games/com.mojang"]);
        assert_eq!(t.packs_dir(), gdk.join("Users").join("Shared").join("games").join("com.mojang"));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
