//! Server-Installation: Vanilla-Server-JAR, Fabric-Server-Launcher, Quilt-/Forge-/NeoForge-Installer,
//! Java, Standarddateien, Übernahme aus einer Instanz.
use super::{server_dir, Server, ServerCreate};
use crate::error::{AppError, AppResult, Ctx};
use crate::model::{InstallState, LoaderKind};
use crate::minecraft::{java, loaders, meta};
use crate::net::DownloadItem;
use crate::Core;
use crate::tasks::SubProgress;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

mod steps;
use steps::*;

/// Wie der Server gestartet wird (relativ zum Server-Ordner).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LaunchSpec {
    /// Argumente nach den Speicher-/JVM-Optionen, vor `nogui` (z. B. `-jar server.jar` oder `@…/win_args.txt`)
    pub args: Vec<String>,
    pub java_major: u32,
    pub java_component: Option<String>,
}

fn link_or_copy(src: &Path, dst: &Path) -> AppResult<()> {
    let len = src.metadata()?.len();
    if dst.metadata().map(|m| m.len() == len).unwrap_or(false) {
        return Ok(());
    }
    let _ = std::fs::remove_file(dst);
    if std::fs::hard_link(src, dst).is_err() {
        std::fs::copy(src, dst)?;
    }
    Ok(())
}

/// Vanilla-Server-JAR (aus `downloads.server`) in den Cache laden und als `server.jar` bereitstellen.
async fn vanilla_server_jar(state: &Core, mc: &str, dir: &Path, force: bool, sp: &SubProgress) -> AppResult<()> {
    let chain = meta::load_chain(&state.paths, mc)?;
    let v = chain.first().ctx("Versionsdaten fehlen")?;
    let dl = v
        .downloads
        .get("server")
        .ok_or_else(|| AppError::msg(format!("Für Minecraft {mc} gibt es keinen offiziellen Server.")))?;
    let cache = state.paths.meta().join("server-jars").join(mc).join("server.jar");
    let item = DownloadItem::new(&dl.url, &cache).sha1(dl.sha1.clone()).size(dl.size);
    if force {
        let _ = tokio::fs::remove_file(&cache).await;
    }
    sp.message("Server-JAR wird geladen …");
    state.net.download_all(vec![item], Some(sp)).await?;
    let dst = dir.join("server.jar");
    tokio::task::spawn_blocking(move || link_or_copy(&cache, &dst)).await??;
    Ok(())
}

/// Hilfsprogramm (Installer) mit Java ausführen; Ausgabe als Statuszeile.
async fn run_java(java: &Path, args: &[String], cwd: &Path, sp: &SubProgress, what: &str) -> AppResult<()> {
    use tokio::io::AsyncBufReadExt;
    let mut cmd = tokio::process::Command::new(java::console_java(java));
    cmd.args(args)
        .current_dir(cwd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(java::CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| AppError::msg(format!("{what} konnte nicht gestartet werden: {e}")))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let tail = std::sync::Arc::new(parking_lot::Mutex::new(std::collections::VecDeque::<String>::new()));
    let t2 = tail.clone();
    let sp2 = sp.clone();
    let what2 = what.to_string();
    let out_task = tokio::spawn(async move {
        let Some(out) = stdout else { return };
        let mut lines = tokio::io::BufReader::new(out).lines();
        let mut n = 0u64;
        while let Ok(Some(l)) = lines.next_line().await {
            n += 1;
            let short: String = l.chars().take(90).collect();
            if n % 5 == 0 || l.contains("Downloading") || l.contains("Processor") || l.contains("Task:") {
                sp2.message(format!("{what2}: {short}"));
            }
            // grob: Fortschritt asymptotisch
            sp2.progress(1.0 - 1.0 / (1.0 + n as f64 / 150.0));
            let mut t = t2.lock();
            t.push_back(l);
            if t.len() > 30 {
                t.pop_front();
            }
        }
    });
    let t3 = tail.clone();
    let err_task = tokio::spawn(async move {
        let Some(err) = stderr else { return };
        let mut lines = tokio::io::BufReader::new(err).lines();
        while let Ok(Some(l)) = lines.next_line().await {
            let mut t = t3.lock();
            t.push_back(l);
            if t.len() > 30 {
                t.pop_front();
            }
        }
    });
    let cancel = sp.task.cancel_token();
    let status = tokio::select! {
        s = child.wait() => s?,
        _ = cancel.cancelled() => {
            let _ = child.kill().await;
            return Err(AppError::Cancelled);
        }
    };
    let _ = out_task.await;
    let _ = err_task.await;
    if !status.success() {
        let t: Vec<String> = tail.lock().iter().rev().take(10).cloned().collect::<Vec<_>>().into_iter().rev().collect();
        tracing::error!("{what} fehlgeschlagen:\n{}", t.join("\n"));
        return Err(AppError::msg(format!("{what} ist fehlgeschlagen:\n{}", t.join("\n"))));
    }
    Ok(())
}

async fn latest_fabric_installer(state: &Core) -> AppResult<String> {
    #[derive(Deserialize)]
    struct I {
        version: String,
        #[serde(default)]
        stable: bool,
    }
    let b = loaders::fetch_cached(state, &format!("{}/versions/installer", loaders::FABRIC_META)).await?;
    let list: Vec<I> = serde_json::from_slice(&b)?;
    list.iter().find(|i| i.stable).or(list.first()).map(|i| i.version.clone()).ctx("Fabric-Installer nicht gefunden")
}

async fn latest_quilt_installer(state: &Core) -> AppResult<String> {
    let b = loaders::fetch_cached(state, "https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/maven-metadata.xml").await?;
    let xml = String::from_utf8_lossy(&b);
    let re = regex::Regex::new(r"<release>([^<]+)</release>").map_err(|e| AppError::msg(e.to_string()))?;
    re.captures(&xml).map(|c| c[1].to_string()).ctx("Quilt-Installer nicht gefunden")
}

/// Startbefehl eines Forge/NeoForge-Servers ermitteln (run.bat/run.sh oder JAR).
pub fn detect_forge_launch(dir: &Path) -> Option<Vec<String>> {
    let script = if cfg!(windows) { "run.bat" } else { "run.sh" };
    if let Ok(text) = std::fs::read_to_string(dir.join(script)) {
        let mut args: Vec<String> = Vec::new();
        for tok in text.split_whitespace() {
            let t = tok.trim_matches('"');
            if t.starts_with('@') && t.ends_with(".txt") && !t.contains("user_jvm_args") {
                args.push(t.to_string());
            }
        }
        if !args.is_empty() {
            let mut v = Vec::new();
            if dir.join("user_jvm_args.txt").is_file() {
                v.push("@user_jvm_args.txt".to_string());
            }
            v.extend(args);
            return Some(v);
        }
    }
    // Ältere Installer: forge-<version>.jar bzw. -universal.jar im Server-Ordner
    let mut jars: Vec<String> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| {
            let l = n.to_ascii_lowercase();
            (l.starts_with("forge-") || l.starts_with("neoforge-")) && l.ends_with(".jar") && !l.contains("installer")
        })
        .collect();
    jars.sort_by_key(|n| n.contains("universal"));
    jars.first().map(|j| vec!["-jar".to_string(), j.clone()])
}

/// Server installieren (bzw. reparieren). Setzt `install_state` und `launch`.
pub async fn install(state: &Core, id: &str, force: bool, sp: &SubProgress) -> AppResult<()> {
    let _lock = {
        let l = state.install_lock.try_lock();
        match l {
            Ok(g) => g,
            Err(_) => {
                sp.message("Warte auf eine andere Installation …");
                state.install_lock.lock().await
            }
        }
    };
    let before = state.servers.get(id)?.install_state;
    state.servers.modify(id, |s| s.install_state = InstallState::Installing)?;
    let res = do_install(state, id, force, sp).await;
    match &res {
        Ok(spec) => {
            let spec = spec.clone();
            state.servers.modify(id, |s| {
                s.install_state = InstallState::Installed;
                s.launch = Some(spec);
            })?;
        }
        Err(AppError::Cancelled) => {
            let restore = if before == InstallState::Installing { InstallState::NotInstalled } else { before };
            let _ = state.servers.modify(id, |s| s.install_state = restore);
        }
        Err(e) => {
            tracing::error!("Server-Installation {id} fehlgeschlagen: {e}");
            let _ = state.servers.modify(id, |s| s.install_state = InstallState::Failed);
        }
    }
    res.map(|_| ())
}

/// Inhalte aus einer Instanz übernehmen (Mods, Configs, Welt). Blockierend.
pub fn copy_from_instance(state: &Core, req: &ServerCreate, server_id: &str) -> AppResult<()> {
    let Some(inst_id) = &req.from_instance else { return Ok(()) };
    let src = state.paths.game_dir(inst_id);
    let dst = server_dir(&state.paths, server_id);
    let mods_src = src.join("mods");
    if mods_src.is_dir() {
        let wanted: Vec<String> = match &req.mods {
            Some(list) => list.clone(),
            None => super::sides::candidates(&mods_src).into_iter().filter(|m| m.server_ok).map(|m| m.file_name).collect(),
        };
        let mods_dst = dst.join("mods");
        std::fs::create_dir_all(&mods_dst)?;
        for f in wanted {
            let Some(from) = crate::util::safe_join(&mods_src, &f) else { continue };
            if !from.is_file() {
                continue;
            }
            let name = f.strip_suffix(".disabled").unwrap_or(&f);
            std::fs::copy(&from, mods_dst.join(name))?;
        }
    }
    if req.copy_configs.unwrap_or(true) {
        for d in ["config", "defaultconfigs", "kubejs"] {
            let p = src.join(d);
            if p.is_dir() {
                crate::util::copy_dir_all(&p, &dst.join(d))?;
            }
        }
    }
    if let Some(w) = req.world.as_ref().filter(|w| !w.trim().is_empty()) {
        let from = crate::util::safe_join(&src.join("saves"), w).ok_or_else(|| AppError::Invalid("Ungültiger Weltname".into()))?;
        if from.is_dir() {
            crate::util::copy_dir_all(&from, &dst.join("world"))?;
            // Spieler-Daten des Einzelspielers nicht übernehmen (gehören zum Host)
            let _ = std::fs::remove_file(dst.join("world").join("session.lock"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
