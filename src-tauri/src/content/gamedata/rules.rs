use super::*;

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

pub(super) fn is_vanilla_launcher(name: &str) -> bool {
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
        LauncherKind::Gdlauncher => crate::content::gdlauncher::LEGACY_SKIP,
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

pub(super) fn is_runtime(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    RUNTIME.iter().any(|s| s.eq_ignore_ascii_case(name)) || (l.starts_with("hs_err_pid") && l.ends_with(".log")) || l.ends_with(".dat_old") || l.ends_with(".tmp")
}

/// Wird dieser Eintrag (oberste Ebene des Spielordners) übersprungen?
pub fn skip_top(kind: LauncherKind, purpose: Purpose, name: &str) -> bool {
    if is_secret(name) || is_runtime(name) || is_vanilla_launcher(name) || (kind == LauncherKind::Gdlauncher && crate::content::gdlauncher::skip_top(name)) || launcher_skip(kind).iter().any(|s| s.eq_ignore_ascii_case(name)) {
        return true;
    }
    purpose == Purpose::Reimport && (name.eq_ignore_ascii_case("mods") || name.eq_ignore_ascii_case("custom_mods"))
}

/// Wird eine Datei/ein Ordner unterhalb der obersten Ebene übersprungen? (Nur Konten/Tokens.)
pub fn skip_inner(name: &str) -> bool {
    is_secret(name)
}
