use super::*;

// ------------------------------------------------------------------ Öffentliche Abläufe

pub(super) fn sort(v: &mut [Found]) {
    v.sort_by(|a, b| b.info.last_played.unwrap_or(0).cmp(&a.info.last_played.unwrap_or(0)).then(a.info.name.to_lowercase().cmp(&b.info.name.to_lowercase())));
}

pub(super) fn launcher(id: LauncherKind, path: &Path, mut found: Vec<Found>) -> (ExternalLauncher, Vec<Found>) {
    sort(&mut found);
    (ExternalLauncher { id, name: source_name(id, path).into(), path: s(path), instances: found.iter().map(info_of).collect() }, found)
}

/// Anzeige-Daten einer Instanz inkl. gefundener Einstellungen.
pub(super) fn info_of(f: &Found) -> ExternalInstance {
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
    for (carbon, r) in crate::content::gdlauncher::roots() {
        out.push(launcher(LauncherKind::Gdlauncher, &r, crate::content::gdlauncher::scan(&r, carbon)));
    }
    for r in crate::content::norisk::roots() {
        out.push(launcher(LauncherKind::Norisk, &r, crate::content::norisk::scan(&r, tmp, &icons_of(tmp))));
    }
    if let Some((r, f)) = official_root().and_then(|r| folder_one(&r).map(|f| (r, f))) {
        out.push(launcher(LauncherKind::Folder, &r, vec![f]));
    }
    out
}

pub(super) const OFFICIAL: &str = "Minecraft Launcher";

pub(super) fn is_official(dir: &Path) -> bool {
    let game = if dir.join(".minecraft").is_dir() { dir.join(".minecraft") } else { dir.to_path_buf() };
    game.join("versions").is_dir() && ["launcher_profiles.json", "launcher_settings.json", "launcher_profiles_microsoft_store.json"].iter().any(|f| game.join(f).is_file())
}

pub(super) fn source_name(kind: LauncherKind, path: &Path) -> &'static str {
    if kind == LauncherKind::Folder && is_official(path) {
        OFFICIAL
    } else {
        launcher_name(kind)
    }
}

pub(super) fn official_root() -> Option<PathBuf> {
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
    if crate::content::norisk::is_root(path) {
        return Ok(launcher(LauncherKind::Norisk, path, crate::content::norisk::scan(path, tmp, &icons_of(tmp))));
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
        if let Some(f) = crate::content::gdlauncher::one(path) {
            return Ok(launcher(LauncherKind::Gdlauncher, path, vec![f]));
        }
    }
    for (inst, carbon) in [(crate::content::gdlauncher::carbon_instances(path), true), (crate::content::gdlauncher::legacy_instances(path), false), (path.to_path_buf(), true), (path.to_path_buf(), false)] {
        let list = crate::content::gdlauncher::scan(&inst, carbon);
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
pub(super) fn describe_blocking(kind: LauncherKind, source: &Path, tmp: &Path) -> AppResult<Found> {
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
        LauncherKind::Gdlauncher => crate::content::gdlauncher::one(source),
        LauncherKind::Norisk => crate::content::norisk::describe(&s(source), tmp, &icons_of(tmp)),
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
                LauncherKind::Norisk => crate::content::norisk::roots_for(source)
                    .iter()
                    .find_map(|r| from(cache.entry(format!("nr|{}", norm(&s(r)))).or_insert_with(|| crate::content::norisk::scan(r, tmp, &icons_of(tmp))))),
                k => describe_blocking(*k, Path::new(source), tmp).ok(),
            }
        })
        .collect()
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
