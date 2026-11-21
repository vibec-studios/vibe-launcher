use super::place::{self, Manifest, STAGING};
use super::read::{self, Configs, EntrySrc, Plan};
use super::snapshot::{self, SnapMeta};
use super::{ApplyTarget, PackApplied, PackApply, PackInput, PackOptions, PackPreview, TargetDiff};
use crate::error::{AppError, AppResult};
use crate::net::DownloadItem;
use crate::server::{self, server_dir, Server, ServerCreate};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use crate::util::safe_join;
use std::path::Path;

fn software_differs(s: &Server, plan: &Plan) -> bool {
    s.platform.is_some()
        || s.mc_version != plan.mc_version
        || s.loader.kind != plan.loader.kind
        || (plan.loader.version.is_some() && s.loader.version != plan.loader.version)
}

fn worlds(game: &Path) -> Vec<String> {
    let mut out: Vec<String> = std::fs::read_dir(game.join("saves"))
        .map(|rd| rd.flatten().filter(|e| e.path().join("level.dat").is_file()).map(|e| e.file_name().to_string_lossy().to_string()).collect())
        .unwrap_or_default();
    out.sort();
    out
}

pub async fn preview(state: &AppState, input: &PackInput, server_id: Option<&str>) -> AppResult<PackPreview> {
    let plan = read::read(state, input).await?;
    let (config_files, config_dirs) = match &plan.configs {
        Configs::None => (0, vec![]),
        Configs::Zip(prefixes) => {
            let zp = plan.archive.clone().unwrap_or_default();
            let pf = prefixes.clone();
            let list = tokio::task::spawn_blocking(move || place::zip_configs(&zp, &pf)).await??;
            let rels: Vec<String> = list.into_iter().map(|(r, _)| r).collect();
            (rels.len() as u32, place::top_dirs(&rels))
        }
        Configs::Dir(root) => {
            let rels = place::dir_configs(root);
            (rels.len() as u32, place::top_dirs(&rels))
        }
    };
    let target = match server_id {
        Some(id) => {
            let s = state.servers.get(id)?;
            let dir = server_dir(&state.paths, id);
            let manifest = place::load_manifest(&dir);
            Some(TargetDiff {
                server_id: s.id.clone(),
                name: s.name.clone(),
                mc_from: s.mc_version.clone(),
                loader_from: s.loader.clone(),
                platform: s.platform.as_ref().map(|p| p.kind.as_str().to_string()),
                changes_software: software_differs(&s, &plan),
                running: state.server_mgr.is_active(id),
                removes: place::removals(&dir, manifest.as_ref()),
                managed: manifest.map(|m| m.name),
            })
        }
        None => None,
    };
    let worlds = match &plan.instance {
        Some(id) => worlds(&state.paths.game_dir(id)),
        None => vec![],
    };
    Ok(PackPreview {
        name: plan.name,
        version_name: plan.version_name,
        format: plan.format,
        mc_version: plan.mc_version,
        loader: plan.loader,
        entries: plan.entries.into_iter().map(|e| e.info).collect(),
        config_files,
        config_dirs,
        client_skipped: plan.client_skipped,
        missing: plan.missing,
        warnings: plan.warnings,
        worlds,
        target,
    })
}

pub async fn stage(state: &AppState, plan: &Plan, opts: &PackOptions, staging: &Path, sp: &crate::tasks::SubProgress) -> AppResult<Vec<String>> {
    let _ = tokio::fs::remove_dir_all(staging).await;
    tokio::fs::create_dir_all(staging).await?;
    let chosen = plan.selected(opts.selected.as_deref());
    let mut downloads = Vec::new();
    let mut rels = Vec::new();
    for e in &chosen {
        let dst = safe_join(staging, &e.info.path).ok_or_else(|| AppError::Invalid(format!("Ungültiger Pfad: {}", e.info.path)))?;
        if let Some(p) = dst.parent() {
            tokio::fs::create_dir_all(p).await?;
        }
        match &e.src {
            EntrySrc::Url { url, sha1, .. } => downloads.push(DownloadItem::new(url, &dst).sha1(sha1.clone()).size(e.info.size)),
            EntrySrc::File(src) => {
                tokio::fs::copy(src, &dst).await?;
            }
            EntrySrc::Zip(name) => {
                let zp = plan.archive.clone().ok_or_else(|| AppError::msg("Archiv fehlt"))?;
                let n = name.clone();
                let d = dst.clone();
                tokio::task::spawn_blocking(move || place::extract_entry(&zp, &n, &d)).await??;
            }
        }
        rels.push(e.info.path.clone());
    }
    if !downloads.is_empty() {
        sp.message(format!("{} Mods werden geladen …", downloads.len()));
        state.net.download_all(downloads, Some(sp)).await?;
    }
    Ok(rels)
}

async fn apply(state: AppState, task: TaskHandle, plan: Plan, id: String, opts: PackOptions, new: bool) -> AppResult<()> {
    let dir = server_dir(&state.paths, &id);
    let before = state.servers.get(&id)?;
    if !new {
        task.stage("Snapshot von Mods und Configs …", Some(0.02));
        let meta = SnapMeta {
            mc_version: before.mc_version.clone(),
            loader: before.loader.clone(),
            platform: before.platform.clone(),
            label: Some(format!("Vor „{}“", plan.name)),
            created: crate::util::now_ms(),
        };
        let d = dir.clone();
        tokio::task::spawn_blocking(move || snapshot::create(&d, &meta)).await??;
    }
    task.check()?;
    task.stage("Server-Mods werden vorbereitet …", Some(0.05));
    let staging = dir.join(STAGING);
    let rels = stage(&state, &plan, &opts, &staging, &task.sub(0.05, 0.55)).await?;
    task.check()?;
    task.stage("Mods und Configs werden übernommen …", Some(0.56));
    let d = dir.clone();
    let st = staging.clone();
    let r2 = rels.clone();
    let configs = if opts.configs { plan.configs.clone() } else { Configs::None };
    let archive = plan.archive.clone();
    let world = if new { opts.world.clone().filter(|w| !w.trim().is_empty()).zip(plan.instance.clone()) } else { None };
    let game = plan.instance.as_ref().map(|i| state.paths.game_dir(i));
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        let manifest = place::load_manifest(&d);
        let old = place::removals(&d, manifest.as_ref());
        place::remove_all(&d, &old);
        place::install_staged(&st, &d, &r2)?;
        match configs {
            Configs::None => {}
            Configs::Zip(prefixes) => {
                if let Some(zp) = &archive {
                    place::copy_zip_configs(zp, &prefixes, &d)?;
                }
            }
            Configs::Dir(root) => {
                place::copy_dir_configs(&root, &d)?;
            }
        }
        if let (Some((w, _)), Some(game)) = (world, game) {
            let from = safe_join(&game.join("saves"), &w).ok_or_else(|| AppError::Invalid("Ungültiger Weltname".into()))?;
            if from.is_dir() {
                crate::util::copy_dir_all(&from, &d.join("world"))?;
                let _ = std::fs::remove_file(d.join("world").join("session.lock"));
            }
        }
        let _ = std::fs::remove_dir_all(&st);
        Ok(())
    })
    .await??;
    place::save_manifest(
        &dir,
        &Manifest {
            name: plan.name.clone(),
            version_name: plan.version_name.clone(),
            format: plan.format.to_string(),
            mc_version: plan.mc_version.clone(),
            loader: Some(plan.loader.clone()),
            files: rels,
            applied_at: crate::util::now_ms(),
        },
    )?;
    let changed = software_differs(&before, &plan);
    if changed {
        let mc = plan.mc_version.clone();
        let loader = plan.loader.clone();
        state.servers.modify(&id, |s| {
            s.mc_version = mc;
            s.loader = loader;
            s.platform = None;
            s.launch = None;
        })?;
    }
    if new || changed {
        task.stage("Server-Software wird installiert …", Some(0.6));
        server::install::install(&state, &id, changed && !new, &task.sub(0.6, 1.0)).await?;
    }
    task.progress(1.0);
    Ok(())
}

pub async fn start(state: &AppState, req: PackApply) -> AppResult<PackApplied> {
    let plan = read::read(state, &req.input).await?;
    if plan.mc_version.trim().is_empty() {
        return Err(AppError::Invalid("Das Modpack nennt keine Minecraft-Version.".into()));
    }
    let (id, new, title) = match &req.target {
        ApplyTarget::New { name, port, memory_mb } => {
            let s = state.servers.create(&ServerCreate {
                name: if name.trim().is_empty() { plan.name.clone() } else { name.clone() },
                mc_version: plan.mc_version.clone(),
                loader: plan.loader.clone(),
                platform: None,
                from_instance: plan.instance.clone(),
                mods: None,
                copy_configs: None,
                world: None,
                port: *port,
                memory_mb: *memory_mb,
            })?;
            (s.id.clone(), true, format!("Server „{}“ wird aus „{}“ erstellt", s.name, plan.name))
        }
        ApplyTarget::Existing { id } => {
            let s = state.servers.get(id)?;
            if state.server_mgr.is_active(id) {
                return Err(AppError::Invalid("Bitte den Server zuerst stoppen.".into()));
            }
            (s.id.clone(), false, format!("„{}“ wird auf „{}“ aufgespielt", plan.name, s.name))
        }
    };
    let st = state.clone();
    let id2 = id.clone();
    let opts = req.options.clone();
    let task_id = state.tasks.spawn("server", title, Some(format!("server:{id}")), move |task| apply(st, task, plan, id2, opts, new));
    Ok(PackApplied { server_id: id, task_id })
}

pub fn restore(state: &AppState, id: &str, name: &str) -> AppResult<String> {
    let s = state.servers.get(id)?;
    if state.server_mgr.is_active(id) {
        return Err(AppError::Invalid("Bitte den Server zuerst stoppen.".into()));
    }
    let st = state.clone();
    let id2 = id.to_string();
    let name = name.to_string();
    Ok(state.tasks.spawn("server", format!("Modpack-Snapshot für „{}“ wird wiederhergestellt", s.name), Some(format!("server:{id}")), move |task| async move {
        task.stage("Mods und Configs werden zurückgesetzt …", Some(0.1));
        let dir = server_dir(&st.paths, &id2);
        let meta = tokio::task::spawn_blocking(move || snapshot::restore(&dir, &name)).await??;
        let cur = st.servers.get(&id2)?;
        let changed = cur.mc_version != meta.mc_version || cur.loader != meta.loader || cur.platform != meta.platform;
        if changed {
            st.servers.modify(&id2, |s| {
                s.mc_version = meta.mc_version.clone();
                s.loader = meta.loader.clone();
                s.platform = meta.platform.clone();
                s.launch = None;
            })?;
            task.stage("Server-Software wird installiert …", Some(0.4));
            server::install::install(&st, &id2, true, &task.sub(0.4, 1.0)).await?;
        }
        task.progress(1.0);
        Ok(())
    }))
}
