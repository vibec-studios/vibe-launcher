//! Getrennte Profile durch Tauschen der `com.mojang`-Ordner („Slots“).
//!
//! Vor dem Start einer Instanz mit eigenem Profil:
//! 1. Journal `swap-<kanal>.json` schreiben (Phase `swapping_in`, Liste der Slots des Nutzers)
//! 2. jeden echten Slot per `rename` in den Parkplatz `park/<kanal>/` schieben
//! 3. jeden Slot der Instanz per `rename` in den echten Ordner schieben
//! 4. Phase `active`
//!
//! Nach dem Spiel (und bei jeder Wiederaufnahme nach Absturz/Stromausfall) läuft [`Swapper::swap_out`]:
//! alles im echten Ordner, was nicht nachweislich Nutzerdaten sind, geht zurück ins Profil, danach kommen
//! die geparkten Nutzerdaten zurück, zuletzt wird das Journal gelöscht. Jeder Schritt ist ein einzelnes
//! `rename` auf demselben Laufwerk (atomar); aus Journal + Dateisystem ist zu jedem Zeitpunkt eindeutig,
//! wem ein Ordner gehört. Es wird nie etwas gelöscht oder überschrieben: Unerwartetes landet in `rescue/`.
//! Nie während das Spiel läuft (`running`-Prüfung vor jedem Tausch).
use super::{slot_path, Layout};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    SwappingIn,
    Active,
    SwappingOut,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Journal {
    pub instance_id: String,
    pub phase: Phase,
    /// Slots, die beim Eintauschen im echten Ordner lagen (= Daten des Nutzers, gehen in den Parkplatz)
    pub home_slots: Vec<String>,
    /// Slots, die aus dem Profil der Instanz kamen (nur zur Info)
    pub inst_slots: Vec<String>,
    /// Profilordner der Instanz (absolut)
    pub profile: PathBuf,
    pub started_at: i64,
}

/// Ergebnis des Zurücktauschens.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SwapReport {
    pub instance_id: String,
    /// Ordner, die nicht an ihren Platz passten und nach `rescue/` verschoben wurden
    pub rescued: Vec<PathBuf>,
}

pub struct Swapper {
    /// Echter Datenordner (z. B. `%AppData%\Minecraft Bedrock`)
    pub target: PathBuf,
    pub layout: Layout,
    /// Parkplatz für die Nutzerdaten während eine Instanz eingetauscht ist
    pub park: PathBuf,
    pub journal: PathBuf,
    /// Auffangordner für Unerwartetes (nie löschen)
    pub rescue: PathBuf,
}

/// Meldung, wenn das Spiel läuft.
pub const RUNNING_MSG: &str = "Minecraft Bedrock läuft gerade. Bitte schließe das Spiel zuerst.";

impl Swapper {
    pub fn load_journal(&self) -> Option<Journal> {
        let b = std::fs::read(&self.journal).ok()?;
        match serde_json::from_slice(&b) {
            Ok(j) => Some(j),
            Err(e) => {
                // Unlesbar sollte nie vorkommen (atomares Schreiben). Sicherheitshalber als „offen“ behandeln,
                // damit niemals getauscht wird, solange unklar ist, wem die Ordner gehören.
                tracing::error!("Bedrock-Journal {:?} unlesbar: {e}", self.journal);
                Some(Journal { instance_id: String::new(), phase: Phase::Active, home_slots: Vec::new(), inst_slots: Vec::new(), profile: PathBuf::new(), started_at: 0 })
            }
        }
    }

    /// Instanz, die gerade eingetauscht ist (bzw. deren Tausch offen ist).
    pub fn active_instance(&self) -> Option<String> {
        self.load_journal().map(|j| j.instance_id)
    }

    fn save(&self, j: &Journal) -> AppResult<()> {
        crash_point()?;
        crate::util::write_json_atomic(&self.journal, j)
    }

    /// Instanz-Profil in den echten Ordner tauschen. Bei Fehlern wird sofort zurückgetauscht.
    pub fn swap_in(&self, instance_id: &str, profile: &Path, running: &dyn Fn() -> bool) -> AppResult<()> {
        if let Some(j) = self.load_journal() {
            return Err(AppError::Invalid(format!(
                "Ein früherer Profil-Tausch ({}) ist noch nicht abgeschlossen. Bitte erst „Daten zurücktauschen“ ausführen.",
                if j.instance_id.is_empty() { "unbekannt" } else { j.instance_id.as_str() }
            )));
        }
        if running() {
            return Err(AppError::Invalid(RUNNING_MSG.into()));
        }
        if !self.layout.slots(&self.park).is_empty() {
            return Err(AppError::msg(format!(
                "Im Parkordner {:?} liegen noch Bedrock-Daten, aber es ist kein Tausch offen. Bitte die Daten von Hand prüfen (siehe docs/BEDROCK.md).",
                self.park
            )));
        }
        check_same_volume(&self.target, &self.park)?;
        check_same_volume(&self.target, profile)?;
        let home = self.layout.slots(&self.target);
        let inst = self.layout.slots(profile);
        // Verknüpfte Ordner (Junction/Symlink, z. B. von anderen Tools) nie tauschen: Sicherung und Tausch
        // würden sonst nur die Verknüpfung erfassen
        for p in home.iter().map(|s| slot_path(&self.target, s)).chain(inst.iter().map(|s| slot_path(profile, s))) {
            if std::fs::symlink_metadata(&p).is_ok_and(|m| m.file_type().is_symlink()) {
                return Err(AppError::Invalid(format!("{p:?} ist eine Verknüpfung (Junction/Symlink). Eigene Profile funktionieren nur mit normalen Ordnern – nutze „Gemeinsames Profil“.")));
            }
        }
        let mut j = Journal {
            instance_id: instance_id.to_string(),
            phase: Phase::SwappingIn,
            home_slots: home.clone(),
            inst_slots: inst.clone(),
            profile: profile.to_path_buf(),
            started_at: crate::util::now_ms(),
        };
        self.save(&j)?;
        let r = (|| -> AppResult<()> {
            for s in &home {
                mv(&slot_path(&self.target, s), &slot_path(&self.park, s))?;
            }
            for s in &inst {
                let dest = slot_path(&self.target, s);
                if dest.exists() {
                    return Err(AppError::msg(format!("{dest:?} ist unerwartet belegt")));
                }
                mv(&slot_path(profile, s), &dest)?;
            }
            j.phase = Phase::Active;
            self.save(&j)
        })();
        if let Err(e) = r {
            if is_crash(&e) {
                return Err(e);
            }
            tracing::warn!("Bedrock-Tausch fehlgeschlagen ({e}) – tausche zurück");
            if let Err(e2) = self.swap_out(running) {
                tracing::error!("Zurücktauschen nach Fehler fehlgeschlagen: {e2} (wird beim nächsten Start wiederholt)");
            }
            return Err(e);
        }
        Ok(())
    }

    /// Zurücktauschen bzw. offenen Tausch abschließen. `Ok(None)`, wenn nichts offen war.
    /// Idempotent: kann nach einem Abbruch an beliebiger Stelle einfach erneut aufgerufen werden.
    pub fn swap_out(&self, running: &dyn Fn() -> bool) -> AppResult<Option<SwapReport>> {
        let Some(mut j) = self.load_journal() else { return Ok(None) };
        if j.instance_id.is_empty() || j.profile.as_os_str().is_empty() {
            return Err(AppError::msg(format!("Bedrock-Journal {:?} ist beschädigt – bitte von Hand prüfen (docs/BEDROCK.md).", self.journal)));
        }
        if running() {
            return Err(AppError::Invalid(RUNNING_MSG.into()));
        }
        if j.phase != Phase::SwappingOut {
            j.phase = Phase::SwappingOut;
            self.save(&j)?;
        }
        let mut report = SwapReport { instance_id: j.instance_id.clone(), rescued: Vec::new() };
        let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
        // 1. Alles im echten Ordner, was nicht nachweislich Nutzerdaten sind, gehört der Instanz
        for s in self.layout.slots(&self.target) {
            let home_in_place = j.home_slots.contains(&s) && !slot_path(&self.park, &s).exists();
            if home_in_place {
                continue;
            }
            let mut dest = slot_path(&j.profile, &s);
            if dest.exists() {
                if is_empty_dir(&dest) {
                    std::fs::remove_dir(&dest)?;
                } else {
                    dest = slot_path(&self.rescue.join(&stamp).join(&j.instance_id), &s);
                    report.rescued.push(dest.clone());
                }
            }
            mv(&slot_path(&self.target, &s), &dest)?;
        }
        // 2. Geparkte Nutzerdaten zurück
        for s in &j.home_slots {
            let parked = slot_path(&self.park, s);
            if !parked.exists() {
                continue;
            }
            let dest = slot_path(&self.target, s);
            if dest.exists() {
                // Nur möglich, wenn währenddessen etwas den Ordner neu angelegt hat (Spiel gestartet?)
                return Err(AppError::msg(format!("{dest:?} wurde während des Zurücktauschens neu angelegt. Bitte das Spiel schließen und erneut versuchen.")));
            }
            mv(&parked, &dest)?;
        }
        // 3. Unerwartete Reste im Parkplatz retten (sollte nie vorkommen)
        for s in self.layout.slots(&self.park) {
            let dest = slot_path(&self.rescue.join(&stamp).join("park"), &s);
            mv(&slot_path(&self.park, &s), &dest)?;
            report.rescued.push(dest);
        }
        remove_empty_dirs(&self.park);
        crash_point()?;
        std::fs::remove_file(&self.journal)?;
        if !report.rescued.is_empty() {
            tracing::warn!("Bedrock-Tausch: unerwartete Ordner gesichert unter {:?}", report.rescued);
        }
        Ok(Some(report))
    }
}

/// Ordner verschieben (gleiches Laufwerk -> atomar). Legt den Elternordner an.
fn mv(from: &Path, to: &Path) -> AppResult<()> {
    crash_point()?;
    if let Some(p) = to.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::rename(from, to).map_err(|e| {
        // 17 = ERROR_NOT_SAME_DEVICE (Windows), 18 = EXDEV (Unix)
        if matches!(e.raw_os_error(), Some(17) | Some(18)) {
            AppError::msg("Der Launcher-Datenordner liegt auf einem anderen Laufwerk als Minecraft Bedrock. Für eigene Profile müssen beide auf demselben Laufwerk liegen – oder nutze „Gemeinsames Profil“.")
        } else {
            AppError::msg(format!("{from:?} -> {to:?} verschieben: {e}"))
        }
    })
}

fn is_empty_dir(p: &Path) -> bool {
    std::fs::read_dir(p).map(|mut r| r.next().is_none()).unwrap_or(false)
}

/// Leere Ordner unter `root` (inkl. `root`) entfernen – nur wirklich leere, nie Dateien.
fn remove_empty_dirs(root: &Path) {
    let dirs: Vec<PathBuf> = walkdir::WalkDir::new(root).contents_first(true).into_iter().flatten().filter(|e| e.file_type().is_dir()).map(|e| e.into_path()).collect();
    for d in dirs {
        let _ = std::fs::remove_dir(&d); // schlägt bei nicht leeren Ordnern fehl – gewollt
    }
}

/// Nächster vorhandener Vorfahr (für Laufwerksvergleich noch nicht angelegter Ordner).
fn existing_ancestor(p: &Path) -> Option<PathBuf> {
    let mut cur = Some(p);
    while let Some(c) = cur {
        if c.exists() {
            return c.canonicalize().ok();
        }
        cur = c.parent();
    }
    None
}

#[cfg(windows)]
fn volume_of(p: &Path) -> Option<String> {
    let c = existing_ancestor(p)?;
    c.components().next().map(|c| c.as_os_str().to_string_lossy().to_lowercase())
}

#[cfg(unix)]
fn volume_of(p: &Path) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    let c = existing_ancestor(p)?;
    std::fs::metadata(c).ok().map(|m| m.dev().to_string())
}

/// Beide Orte müssen auf demselben Laufwerk liegen, sonst wäre `rename` kein atomares Verschieben.
pub fn check_same_volume(a: &Path, b: &Path) -> AppResult<()> {
    match (volume_of(a), volume_of(b)) {
        (Some(x), Some(y)) if x != y => Err(AppError::Invalid(
            "Der Launcher-Datenordner liegt auf einem anderen Laufwerk als Minecraft Bedrock. Für eigene Profile müssen beide auf demselben Laufwerk liegen – oder nutze „Gemeinsames Profil“.".into(),
        )),
        _ => Ok(()),
    }
}

// ------------------------------------------------------------------ Kopieren (Sicherung, Übernahme)

/// Marker der allerersten Sicherung eines Kanals.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupMarker {
    pub path: PathBuf,
    pub created: i64,
    pub size: u64,
    pub slots: Vec<String>,
}

/// Ordner rekursiv kopieren, Fortschritt in Bytes, abbrechbar.
pub fn copy_tree(src: &Path, dst: &Path, on_bytes: &dyn Fn(u64), cancelled: &dyn Fn() -> bool) -> AppResult<()> {
    std::fs::create_dir_all(dst)?;
    for entry in walkdir::WalkDir::new(src).min_depth(1) {
        if cancelled() {
            return Err(AppError::Cancelled);
        }
        let entry = entry.map_err(|e| AppError::msg(e.to_string()))?;
        let rel = entry.path().strip_prefix(src).map_err(|e| AppError::msg(e.to_string()))?;
        let to = dst.join(rel);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&to)?;
        } else if entry.file_type().is_file() {
            if let Some(p) = to.parent() {
                std::fs::create_dir_all(p)?;
            }
            let n = std::fs::copy(entry.path(), &to)?;
            on_bytes(n);
        }
    }
    Ok(())
}

/// Alle Slots von `base` nach `dest` kopieren: erst nach `<dest>.partial`, dann umbenennen –
/// ein halb fertiges Ergebnis ist so immer als solches erkennbar.
pub fn copy_slots(base: &Path, layout: Layout, dest: &Path, on_bytes: &dyn Fn(u64), cancelled: &dyn Fn() -> bool) -> AppResult<Vec<String>> {
    let slots = layout.slots(base);
    let partial = dest.with_extension("partial");
    if partial.exists() {
        std::fs::remove_dir_all(&partial)?;
    }
    let r = (|| {
        for s in &slots {
            copy_tree(&slot_path(base, s), &slot_path(&partial, s), on_bytes, cancelled)?;
        }
        Ok::<_, AppError>(())
    })();
    if let Err(e) = r {
        let _ = std::fs::remove_dir_all(&partial);
        return Err(e);
    }
    std::fs::create_dir_all(&partial)?;
    if let Some(p) = dest.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::rename(&partial, dest)?;
    Ok(slots)
}

/// Vollständige Sicherung der Nutzerdaten vor dem allerersten Tausch eines Kanals (einmalig).
/// Gibt den Sicherungsordner zurück, falls jetzt eine angelegt wurde.
pub fn ensure_initial_backup(
    base: &Path,
    layout: Layout,
    backups: &Path,
    marker: &Path,
    on_bytes: &dyn Fn(u64),
    cancelled: &dyn Fn() -> bool,
) -> AppResult<Option<PathBuf>> {
    if marker.exists() {
        return Ok(None);
    }
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let dest = backups.join(format!("erste-sicherung-{stamp}"));
    let slots = copy_slots(base, layout, &dest, on_bytes, cancelled)?;
    let m = BackupMarker { size: super::dir_size(&dest), path: dest.clone(), created: crate::util::now_ms(), slots };
    crate::util::write_json_atomic(marker, &m)?;
    Ok(Some(dest))
}

// ------------------------------------------------------------------ Absturz-Simulation (Tests)

#[cfg(test)]
thread_local! {
    /// Nach so vielen Schritten (rename/Journal) „stürzt“ der Ablauf ab: Fehler ohne Aufräumen.
    static CRASH_AT: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
}

const CRASH_MSG: &str = "simulierter Absturz";

fn crash_point() -> AppResult<()> {
    #[cfg(test)]
    {
        let hit = CRASH_AT.with(|c| match c.get() {
            Some(0) => true,
            Some(n) => {
                c.set(Some(n - 1));
                false
            }
            None => false,
        });
        if hit {
            return Err(AppError::msg(CRASH_MSG));
        }
    }
    Ok(())
}

fn is_crash(e: &AppError) -> bool {
    cfg!(test) && matches!(e, AppError::Msg(m) if m == CRASH_MSG)
}

#[cfg(test)]
pub(crate) fn set_crash(at: Option<usize>) {
    CRASH_AT.with(|c| c.set(at));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    /// Alle Dateien unter `root` mit Inhalt (relativ, `/`).
    fn snapshot(root: &Path) -> BTreeMap<String, String> {
        let mut m = BTreeMap::new();
        for e in walkdir::WalkDir::new(root).into_iter().flatten().filter(|e| e.file_type().is_file()) {
            let rel = e.path().strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            m.insert(rel, std::fs::read_to_string(e.path()).unwrap_or_default());
        }
        m
    }

    fn write(p: &Path, s: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, s).unwrap();
    }

    struct Env {
        tmp: PathBuf,
        sw: Swapper,
        profile: PathBuf,
    }

    impl Env {
        fn new(tag: &str) -> Env {
            let tmp = super::super::tempdir(tag);
            let target = tmp.join("Minecraft Bedrock");
            let launcher = tmp.join("VibeLauncher");
            let sw = Swapper {
                target: target.clone(),
                layout: Layout::Gdk,
                park: launcher.join("bedrock/park/release"),
                journal: launcher.join("bedrock/swap-release.json"),
                rescue: launcher.join("bedrock/rescue"),
            };
            // Nutzerdaten: eine Welt, ein Pack, Einstellungen; zusätzlich Datei außerhalb von com.mojang
            write(&target.join("Users/111/games/com.mojang/minecraftWorlds/abc/levelname.txt"), "Meine Welt");
            write(&target.join("Users/111/games/com.mojang/minecraftpe/options.txt"), "gfx=fancy");
            write(&target.join("Users/Shared/games/com.mojang/resource_packs/rp/manifest.json"), "{home}");
            write(&target.join("logs/game.log"), "log");
            // Instanz: eigene Welt, kein Shared-Slot
            let profile = launcher.join("instances/test/bedrock");
            write(&profile.join("Users/111/games/com.mojang/minecraftWorlds/xyz/levelname.txt"), "Instanzwelt");
            Env { tmp, sw, profile }
        }
        fn all(&self) -> BTreeMap<String, String> {
            snapshot(&self.tmp)
        }
        fn home(&self) -> BTreeMap<String, String> {
            snapshot(&self.sw.target)
        }
    }

    impl Drop for Env {
        fn drop(&mut self) {
            set_crash(None);
            let _ = std::fs::remove_dir_all(&self.tmp);
        }
    }

    const NOT_RUNNING: &dyn Fn() -> bool = &|| false;

    #[test]
    fn swap_roundtrip_keeps_everything() {
        let env = Env::new("roundtrip");
        let home_before = env.home();
        let prof_before = snapshot(&env.profile);
        env.sw.swap_in("test", &env.profile, NOT_RUNNING).unwrap();
        // Spiel sieht die Instanz-Daten, Nutzerdaten sind geparkt
        let live = env.home();
        assert_eq!(live.get("Users/111/games/com.mojang/minecraftWorlds/xyz/levelname.txt").map(String::as_str), Some("Instanzwelt"));
        assert!(!live.contains_key("Users/111/games/com.mojang/minecraftWorlds/abc/levelname.txt"));
        assert!(!live.contains_key("Users/Shared/games/com.mojang/resource_packs/rp/manifest.json"));
        assert_eq!(live.get("logs/game.log").map(String::as_str), Some("log"), "Dateien außerhalb von com.mojang bleiben");
        assert_eq!(env.sw.load_journal().unwrap().phase, Phase::Active);
        // Spiel legt während der Sitzung neue Daten an (Shared-Packs, neue Welt)
        write(&env.sw.target.join("Users/Shared/games/com.mojang/behavior_packs/bp/manifest.json"), "{inst}");
        write(&env.sw.target.join("Users/111/games/com.mojang/minecraftWorlds/neu/levelname.txt"), "Neue Welt");
        let rep = env.sw.swap_out(NOT_RUNNING).unwrap().unwrap();
        assert!(rep.rescued.is_empty());
        assert_eq!(env.home(), home_before, "Nutzerdaten exakt wiederhergestellt");
        let prof = snapshot(&env.profile);
        assert_eq!(prof.len(), prof_before.len() + 2);
        assert_eq!(prof.get("Users/Shared/games/com.mojang/behavior_packs/bp/manifest.json").map(String::as_str), Some("{inst}"));
        assert!(env.sw.load_journal().is_none());
        assert!(!env.sw.park.exists() || snapshot(&env.sw.park).is_empty());
        // Zweites Zurücktauschen: nichts offen
        assert!(env.sw.swap_out(NOT_RUNNING).unwrap().is_none());
    }

    #[test]
    fn never_swaps_while_running() {
        let env = Env::new("running");
        let before = env.all();
        let e = env.sw.swap_in("test", &env.profile, &|| true).unwrap_err();
        assert!(e.to_string().contains("läuft"));
        assert_eq!(env.all(), before);
        env.sw.swap_in("test", &env.profile, NOT_RUNNING).unwrap();
        let during = env.all();
        assert!(env.sw.swap_out(&|| true).is_err());
        assert_eq!(env.all(), during, "kein Zurücktauschen solange das Spiel läuft");
        // Zweiter Eintausch bei offenem Journal wird abgelehnt
        assert!(env.sw.swap_in("andere", &env.profile, NOT_RUNNING).is_err());
        env.sw.swap_out(NOT_RUNNING).unwrap();
    }

    /// Absturz nach jedem einzelnen Schritt des Ein- und Austauschens: Wiederaufnahme stellt immer
    /// alles her, nichts geht verloren.
    #[test]
    fn crash_at_every_step_recovers() {
        // Schritte beim Eintauschen: Journal, 2 Nutzer-Slots, 1 Instanz-Slot, Journal(active) = 5
        for at in 0..8 {
            let env = Env::new(&format!("crash-in-{at}"));
            let home_before = env.home();
            let prof_before = snapshot(&env.profile);
            set_crash(Some(at));
            let r = env.sw.swap_in("test", &env.profile, NOT_RUNNING);
            set_crash(None);
            if r.is_ok() {
                assert_eq!(env.sw.load_journal().unwrap().phase, Phase::Active);
            }
            // „Neustart“: Wiederaufnahme
            env.sw.swap_out(NOT_RUNNING).unwrap();
            assert_eq!(env.home(), home_before, "Absturz bei Schritt {at}: Nutzerdaten");
            assert_eq!(snapshot(&env.profile), prof_before, "Absturz bei Schritt {at}: Instanzdaten");
            assert!(env.sw.load_journal().is_none());
        }
        // Absturz beim Zurücktauschen
        for at in 0..8 {
            let env = Env::new(&format!("crash-out-{at}"));
            let home_before = env.home();
            env.sw.swap_in("test", &env.profile, NOT_RUNNING).unwrap();
            write(&env.sw.target.join("Users/222/games/com.mojang/minecraftpe/options.txt"), "zweites Konto");
            let mut prof_expected = snapshot(&env.profile);
            for (k, v) in env.home() {
                if k.starts_with("Users/") {
                    prof_expected.insert(k, v);
                }
            }
            set_crash(Some(at));
            let r = env.sw.swap_out(NOT_RUNNING);
            set_crash(None);
            if r.is_err() {
                assert!(env.sw.load_journal().is_some(), "Journal bleibt bis zum Ende");
                env.sw.swap_out(NOT_RUNNING).unwrap();
            }
            assert_eq!(env.home(), home_before, "Absturz beim Zurücktauschen (Schritt {at})");
            assert_eq!(snapshot(&env.profile), prof_expected);
            assert!(env.sw.load_journal().is_none());
        }
    }

    #[test]
    fn unexpected_data_is_rescued_not_overwritten() {
        let env = Env::new("rescue");
        env.sw.swap_in("test", &env.profile, NOT_RUNNING).unwrap();
        // Jemand legt während des Spiels im Profilordner denselben Slot neu an
        write(&env.profile.join("Users/111/games/com.mojang/x.txt"), "fremd");
        let rep = env.sw.swap_out(NOT_RUNNING).unwrap().unwrap();
        assert_eq!(rep.rescued.len(), 1);
        assert!(rep.rescued[0].join("minecraftWorlds/xyz/levelname.txt").exists(), "Sitzungsdaten gerettet");
        assert_eq!(std::fs::read_to_string(env.profile.join("Users/111/games/com.mojang/x.txt")).unwrap(), "fremd");
    }

    #[test]
    fn leftover_park_blocks_swap() {
        let env = Env::new("park");
        write(&env.sw.park.join("Users/9/games/com.mojang/a.txt"), "?");
        let before = env.all();
        assert!(env.sw.swap_in("test", &env.profile, NOT_RUNNING).is_err());
        assert_eq!(env.all(), before);
    }

    #[test]
    fn initial_backup_once_and_adoption_copy() {
        let env = Env::new("backup");
        let base = env.sw.target.clone();
        let backups = env.tmp.join("VibeLauncher/bedrock/backups");
        let marker = env.tmp.join("VibeLauncher/bedrock/initial-backup-release.json");
        let bytes = std::sync::atomic::AtomicU64::new(0);
        let add = |n: u64| {
            bytes.fetch_add(n, std::sync::atomic::Ordering::Relaxed);
        };
        let dest = ensure_initial_backup(&base, Layout::Gdk, &backups, &marker, &add, &|| false).unwrap().unwrap();
        assert!(bytes.load(std::sync::atomic::Ordering::Relaxed) > 0);
        let copy = snapshot(&dest);
        let home: BTreeMap<_, _> = env.home().into_iter().filter(|(k, _)| k.starts_with("Users/")).collect();
        assert_eq!(copy, home, "Sicherung enthält alle com.mojang-Daten");
        assert!(ensure_initial_backup(&base, Layout::Gdk, &backups, &marker, &add, &|| false).unwrap().is_none(), "nur einmal");
        // Übernahme in ein neues Profil = Kopie, Original unverändert
        let before = env.home();
        let prof = env.tmp.join("VibeLauncher/instances/adopt/bedrock");
        copy_slots(&base, Layout::Gdk, &prof, &|_| {}, &|| false).unwrap();
        assert_eq!(snapshot(&prof), home);
        assert_eq!(env.home(), before);
        // Abbruch hinterlässt nichts Halbes
        let prof2 = env.tmp.join("VibeLauncher/instances/adopt2/bedrock");
        assert!(copy_slots(&base, Layout::Gdk, &prof2, &|_| {}, &|| true).is_err());
        assert!(!prof2.exists() && !prof2.with_extension("partial").exists());
    }
}
