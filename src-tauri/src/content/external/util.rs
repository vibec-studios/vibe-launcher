use super::*;

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

pub(super) fn s(p: &Path) -> String {
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

pub(super) fn ms(v: i64) -> i64 {
    // Sekunden oder Millisekunden?
    if v > 0 && v < 100_000_000_000 {
        v * 1000
    } else {
        v
    }
}

pub(super) fn icon_data(p: Option<&Path>) -> Option<String> {
    let p = p?;
    let m = std::fs::metadata(p).ok()?;
    if m.len() > 2 * 1024 * 1024 {
        return None;
    }
    crate::content::meta::data_url(&std::fs::read(p).ok()?)
}

pub(super) fn count_mods(game_dir: &Path) -> u32 {
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

pub(super) fn vanilla() -> Loader {
    Loader { kind: LoaderKind::Vanilla, version: None }
}

pub(super) fn parse_loader(kind: &str, version: Option<String>) -> Loader {
    match LoaderKind::parse(kind) {
        Some(LoaderKind::Vanilla) | None => vanilla(),
        Some(k) => Loader { kind: k, version: version.filter(|v| !v.is_empty()) },
    }
}
