use super::*;

// ------------------------------------------------------------------ Beliebiger Ordner

pub(super) fn looks_like_game_dir(p: &Path) -> bool {
    ["mods", "saves", "options.txt", "config", "resourcepacks"].iter().any(|n| p.join(n).exists())
}

pub(super) fn folder_one(dir: &Path) -> Option<Found> {
    let game = if dir.join(".minecraft").is_dir() { dir.join(".minecraft") } else { dir.to_path_buf() };
    if !looks_like_game_dir(&game) {
        return None;
    }
    let name = dir.file_name().map(|n| n.to_string_lossy().trim_start_matches('.').to_string()).filter(|n| !n.is_empty()).unwrap_or_else(|| "Import".into());
    let name = if name.eq_ignore_ascii_case("minecraft") { "Minecraft".to_string() } else { name };
    let icon = ["icon.png", "instance.png"].iter().map(|n| dir.join(n)).find(|p| p.is_file());
    let mut f = with_guess(found(name, game, dir, String::new(), vanilla(), icon));
    let has_mods = f.info.mod_count > 0;
    if let Some(g) = crate::content::vanilla::guess(&f.game_dir, f.info.loader.kind) {
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
