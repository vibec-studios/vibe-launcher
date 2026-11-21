use super::*;

pub(super) fn extract(archive: &Path, info: &PackInfo, dest: &Path) -> AppResult<usize> {
    let f = std::fs::File::open(archive)?;
    let mut zip = zip::ZipArchive::new(f)?;
    let mut n = 0;
    for i in 0..zip.len() {
        let mut e = zip.by_index(i)?;
        if e.is_dir() {
            continue;
        }
        let mut name = e.name().replace('\\', "/");
        if let Some(p) = &info.strip_prefix {
            match name.strip_prefix(&format!("{p}/")) {
                Some(r) => name = r.to_string(),
                None => continue,
            }
        }
        let rel = info.override_dirs.iter().find_map(|d| if d.is_empty() { Some(name.clone()) } else { name.strip_prefix(&format!("{d}/")).map(str::to_string) });
        let Some(rel) = rel.filter(|r| !r.is_empty()) else { continue };
        if is_client_only(&rel) || rel == "vibe-server.json" || rel == "modrinth.index.json" || rel == "vlpack.json" {
            continue;
        }
        let Some(out) = crate::util::safe_join(dest, &rel) else { continue };
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p)?;
        }
        let mut w = std::fs::File::create(&out)?;
        std::io::copy(&mut e, &mut w)?;
        n += 1;
    }
    Ok(n)
}

pub(super) fn drop_client_mods(dir: &Path) -> Vec<String> {
    let mods = dir.join("mods");
    let mut removed = Vec::new();
    for c in sides::candidates(&mods) {
        if c.side == ModSide::Client {
            if std::fs::remove_file(mods.join(&c.file_name)).is_ok() {
                removed.push(c.file_name);
            }
        }
    }
    removed
}

pub(super) fn clear_mods(dir: &Path) {
    let mods = dir.join("mods");
    if let Ok(rd) = std::fs::read_dir(&mods) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_lowercase();
            if e.path().is_file() && (n.ends_with(".jar") || n.ends_with(".jar.disabled")) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

pub(super) async fn apply(core: &Core, archive: PathBuf, info: PackInfo, id: String, update: bool, sp: &SubProgress) -> AppResult<()> {
    let dir = server_dir(&core.paths, &id);
    std::fs::create_dir_all(&dir)?;
    if update {
        clear_mods(&dir);
    }
    sp.message("Dateien des Modpacks werden geladen …");
    let mut items = Vec::new();
    for f in info.files.iter().filter(|f| !is_client_only(&f.path)) {
        let Some(out) = crate::util::safe_join(&dir, &f.path) else {
            return Err(AppError::Invalid(format!("Ungültiger Pfad im Modpack: {}", f.path)));
        };
        items.push(DownloadItem::new(&f.url, out).sha1(f.sha1.clone()).size(f.size));
    }
    core.net.download_all(items, Some(&sp.sub(0.0, 0.5))).await?;
    sp.message("Configs werden übernommen …");
    let (a2, i2, d2) = (archive.clone(), info.clone(), dir.clone());
    tokio::task::spawn_blocking(move || extract(&a2, &i2, &d2)).await??;
    let d3 = dir.clone();
    let removed = tokio::task::spawn_blocking(move || drop_client_mods(&d3)).await?;
    if !removed.is_empty() {
        tracing::info!("Modpack: {} Client-Mods ausgelassen: {}", removed.len(), removed.join(", "));
    }
    let _ = std::fs::remove_file(&archive);
    crate::server::install::install(core, &id, false, &sp.sub(0.5, 1.0)).await
}

pub fn spawn_import(core: &Core, archive: PathBuf, format: PackFormat, opts: ImportOptions) -> AppResult<(Server, String)> {
    let info = inspect(&archive, format)?;
    let (server, update) = match &opts.server {
        Some(id) => {
            let s = core.servers.get(id)?;
            if core.server_mgr.is_active(id) {
                return Err(AppError::Invalid("Bitte den Server zuerst stoppen.".into()));
            }
            if let (Some(mc), Some(l)) = (&info.mc_version, &info.loader) {
                if *mc != s.mc_version || l.kind != s.loader.kind {
                    let s2 = core.servers.modify(id, |x| {
                        x.mc_version = mc.clone();
                        x.loader = l.clone();
                        x.platform = None;
                        x.launch = None;
                        x.install_state = crate::model::InstallState::NotInstalled;
                    })?;
                    (s2, true)
                } else {
                    (s, true)
                }
            } else {
                (s, true)
            }
        }
        None => {
            let mc = info.mc_version.clone().or(opts.mc_version.clone()).ok_or_else(|| AppError::Invalid("Minecraft-Version fehlt (mc_version).".into()))?;
            let loader = info.loader.clone().or(opts.loader.clone()).unwrap_or(Loader { kind: LoaderKind::Vanilla, version: None });
            let name = opts.name.clone().filter(|n| !n.trim().is_empty()).or(info.name.clone()).unwrap_or_else(|| "Modpack-Server".into());
            let req = ServerCreate { name, mc_version: mc, loader, platform: None, from_instance: None, mods: None, copy_configs: None, world: None, port: None, memory_mb: opts.memory_mb };
            (core.servers.create(&req)?, false)
        }
    };
    let st = core.clone();
    let id = server.id.clone();
    let title = format!("Modpack wird auf „{}“ übertragen", server.name);
    let task_id = core.tasks.spawn("server", title, crate::server::ops::task_ref(&id), move |task| async move { apply(&st, archive, info, id, update, &task.sub(0.0, 1.0)).await });
    Ok((server, task_id))
}
