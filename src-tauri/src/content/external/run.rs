use super::*;

pub(super) fn fmt_size(b: u64) -> String {
    let mb = b as f64 / 1024.0 / 1024.0;
    if mb >= 1024.0 {
        format!("{:.1} GB", mb / 1024.0).replace('.', ",")
    } else {
        format!("{mb:.0} MB")
    }
}

/// Zu kopierende Dateien + Gesamtgröße nach den gemeinsamen Regeln ([`crate::content::gamedata::skip_top`]: ohne Logs,
/// Caches, Launcher-Interna; Konten/Tokens auf keiner Ebene).
/// Verlinkte Dateien (z. B. eine geteilte `options.txt`) werden mit ihrem Inhalt kopiert, verlinkte Ordner nur
/// auf oberster Ebene (z. B. `config`, `saves`) – darin wird keinen weiteren Ordner-Links gefolgt (keine Schleifen).
/// ATLauncher: deaktivierte Mods (`disabledmods/*.jar`) kommen als `mods/<name>.disabled`.
pub(super) fn plan_copy(src: &Path, kind: LauncherKind) -> (Vec<(PathBuf, PathBuf, u64)>, u64) {
    use crate::content::gamedata::{skip_inner, skip_top, Purpose};
    let mut files = Vec::new();
    let mut total = 0;
    let mut add = |path: &Path, rel: &Path, ft: std::fs::FileType, top: bool, files: &mut Vec<(PathBuf, PathBuf, u64)>| {
        if ft.is_dir() {
            files.push((path.to_path_buf(), rel.to_path_buf(), u64::MAX));
            return false;
        }
        let meta = if ft.is_symlink() { std::fs::metadata(path) } else { path.symlink_metadata() };
        match meta {
            Ok(m) if m.is_file() => {
                total += m.len();
                files.push((path.to_path_buf(), rel.to_path_buf(), m.len()));
                false
            }
            // verlinkter Ordner auf oberster Ebene -> Inhalt übernehmen
            Ok(m) if m.is_dir() && top => {
                files.push((path.to_path_buf(), rel.to_path_buf(), u64::MAX));
                true
            }
            _ => false,
        }
    };
    let keep = |e: &walkdir::DirEntry| {
        let n = e.file_name().to_string_lossy();
        if e.depth() == 1 {
            !skip_top(kind, Purpose::Import, &n)
        } else {
            e.depth() == 0 || !skip_inner(&n)
        }
    };
    for e in walkdir::WalkDir::new(src).follow_links(false).into_iter().filter_entry(keep).flatten() {
        let Ok(rel) = e.path().strip_prefix(src) else { continue };
        if rel.as_os_str().is_empty() {
            continue;
        }
        if add(e.path(), rel, e.file_type(), e.depth() == 1, &mut files) {
            for w in walkdir::WalkDir::new(e.path()).follow_links(false).min_depth(1).into_iter().filter_entry(|w| !skip_inner(&w.file_name().to_string_lossy())).flatten() {
                let Ok(inner) = w.path().strip_prefix(e.path()) else { continue };
                add(w.path(), &rel.join(inner), w.file_type(), false, &mut files);
            }
        }
    }
    if kind == LauncherKind::Atlauncher {
        if let Ok(rd) = std::fs::read_dir(src.join("disabledmods")) {
            for d in rd.flatten() {
                let n = d.file_name().to_string_lossy().to_string();
                let Ok(m) = d.metadata() else { continue };
                if m.is_file() && n.to_ascii_lowercase().ends_with(".jar") && !src.join("mods").join(&n).exists() {
                    total += m.len();
                    files.push((d.path(), Path::new("mods").join(format!("{n}.disabled")), m.len()));
                }
            }
        }
    }
    (files, total)
}

#[allow(clippy::too_many_arguments)]
pub async fn run_import(
    state: AppState,
    task: TaskHandle,
    kind: LauncherKind,
    source_path: String,
    name: Option<String>,
    mc_version: Option<String>,
    loader: Option<Loader>,
    settings: Option<Vec<String>>,
) -> AppResult<()> {
    task.stage("Lese Instanz …", None);
    let keys: std::collections::HashSet<String> = settings.unwrap_or_else(extsettings::default_keys).into_iter().collect();
    let tmp = state.paths.tmp();
    let sp = PathBuf::from(&source_path);
    let f = tokio::task::spawn_blocking(move || describe_blocking(kind, &sp, &tmp)).await??;
    if kind == LauncherKind::Norisk {
        return crate::content::norisk::run_import(state, task, f, source_path, name, mc_version, loader, keys).await;
    }
    let mc = mc_version.filter(|v| !v.trim().is_empty()).unwrap_or_else(|| f.info.mc_version.clone());
    if mc.trim().is_empty() {
        return Err(AppError::Invalid(format!("{}: Minecraft-Version unbekannt – bitte angeben", f.info.name)));
    }
    let loader = loader.unwrap_or_else(|| f.info.loader.clone());
    let name = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| f.info.name.clone());
    task.set_title(format!("{name} übernehmen"));
    let src_game = f.game_dir.clone();
    task.check()?;
    let (files, total) = tokio::task::spawn_blocking(move || plan_copy(&src_game, kind)).await?;
    let copied = crate::content::gamedata::top_names(files.iter().map(|f| f.1.as_path()));

    let mut inst = Instance {
        id: String::new(),
        name: name.clone(),
        icon: None,
        accent: None,
        group: None,
        mc_version: mc,
        loader,
        java: Default::default(),
        window: Default::default(),
        hooks: Default::default(),
        source: Some(f.pack.clone().unwrap_or(PackSource {
            kind: match kind {
                LauncherKind::Modrinth => PackSourceKind::Modrinth,
                LauncherKind::Curseforge => PackSourceKind::Curseforge,
                LauncherKind::Prism | LauncherKind::Multimc => PackSourceKind::Prism,
                LauncherKind::Atlauncher | LauncherKind::Gdlauncher | LauncherKind::Norisk | LauncherKind::Folder => PackSourceKind::Local,
            },
            project_id: None,
            version_id: None,
            name: Some(source_name(kind, Path::new(&source_path)).to_string()),
            version_name: None,
        })),
        install_state: InstallState::NotInstalled,
        version_id: None,
        created_at: crate::util::now_ms(),
        last_played: f.info.last_played,
        play_time_secs: f.info.play_time_secs.unwrap_or(0),
        notes: None,
        auto_update_content: None,
        bedrock: None,
    };
    let (prepared, java_note) = extsettings::prepare(&state.settings(), &f.settings, &inst.mc_version, keys.contains("java")).await;
    extsettings::apply(&mut inst, &prepared, &keys);
    let inst = state.instances.insert_new(inst)?;
    task.set_instance(inst.id.clone());

    let n_files = files.iter().filter(|f| f.2 != u64::MAX).count();
    let res: AppResult<()> = async {
        write_mark(&state, &inst.id, kind, &source_path, copied)?;
        task.stage(format!("Kopiere {} Dateien …", files.iter().filter(|f| f.2 != u64::MAX).count()), Some(0.0));
        let dst = state.paths.game_dir(&inst.id);
        let t2 = task.clone();
        tokio::task::spawn_blocking(move || -> AppResult<()> {
            let mut done = 0u64;
            for (i, (src, rel, size)) in files.iter().enumerate() {
                if i % 32 == 0 {
                    t2.check()?;
                }
                let target = dst.join(rel);
                if *size == u64::MAX {
                    std::fs::create_dir_all(&target)?;
                    continue;
                }
                if let Some(p) = target.parent() {
                    std::fs::create_dir_all(p)?;
                }
                crate::storage::links::detach(&target);
                std::fs::copy(src, &target).map_err(|e| AppError::msg(format!("{} konnte nicht kopiert werden: {e}", rel.display())))?;
                done += size;
                t2.progress(if total == 0 { 1.0 } else { done as f64 / total as f64 });
            }
            Ok(())
        })
        .await??;
        if let Some(icon) = f.icon_path.as_ref().and_then(|p| std::fs::read(p).ok()) {
            if let Err(e) = crate::content::import::set_icon_bytes(&state, &inst.id, &icon).await {
                tracing::warn!("Icon nicht übernommen: {e}");
            }
        }
        Ok(())
    }
    .await;
    match res {
        Ok(()) => {
            let r = crate::content::importreport::ImportReport {
                launcher: source_name(kind, Path::new(&source_path)).into(),
                at: crate::util::now_ms(),
                files: n_files as u64,
                bytes: total,
                jars: crate::content::importreport::mod_files(&state.paths.game_dir(&inst.id)),
                ..Default::default()
            };
            if let Err(e) = crate::content::importreport::save(&state, &inst.id, &r) {
                tracing::warn!("Import-Bericht nicht gespeichert: {e}");
            }
            task.message(match &java_note {
                Some(n) => format!("{} übernommen · {n}", fmt_size(total)),
                None => format!("{} übernommen", fmt_size(total)),
            });
            state.content.emit_changed(&inst.id);
            Ok(())
        }
        Err(e) => {
            if let Err(de) = state.instances.delete(&inst.id) {
                tracing::warn!("Halb importierte Instanz {} nicht entfernt: {de}", inst.id);
            }
            Err(e)
        }
    }
}
