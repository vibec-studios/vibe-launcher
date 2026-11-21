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
