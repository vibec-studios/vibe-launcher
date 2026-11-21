use super::*;

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
pub(super) fn prism_instances_dir(root: &Path) -> PathBuf {
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

pub(super) fn prism_icons_dir(root: &Path) -> PathBuf {
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
pub(super) const PRISM_GLOBAL_KEYS: &[&str] =
    &["MinMemAlloc", "MaxMemAlloc", "JvmArgs", "MinecraftWinWidth", "MinecraftWinHeight", "PreLaunchCommand", "WrapperCommand", "PostExitCommand", "Env"];

/// `prismlauncher.cfg`/`polymc.cfg`/`multimc.cfg` der Wurzel (angegeben oder oberhalb des Instanzordners).
pub(super) fn prism_global(dir: &Path, root: Option<&Path>) -> HashMap<String, String> {
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

pub(super) fn prism_one_in(dir: &Path, icons_dir: Option<&Path>, root: Option<&Path>) -> Option<(Found, LauncherKind)> {
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
    let kind = if info.format == crate::content::PackFormat::Multimc { LauncherKind::Multimc } else { LauncherKind::Prism };
    Some((f, kind))
}

pub(super) fn prism_scan(instances: &Path, icons: Option<&Path>, root: Option<&Path>) -> Vec<Found> {
    let Ok(rd) = std::fs::read_dir(instances) else { return vec![] };
    rd.flatten()
        .filter(|e| !e.file_name().to_string_lossy().starts_with('_') && !e.file_name().to_string_lossy().starts_with('.'))
        .filter_map(|e| prism_one_in(&e.path(), icons, root).map(|(f, _)| f))
        .collect()
}
