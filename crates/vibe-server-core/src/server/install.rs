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

async fn do_install(state: &Core, id: &str, force: bool, sp: &SubProgress) -> AppResult<LaunchSpec> {
    let mut s: Server = state.servers.get(id)?;
    let dir = server_dir(&state.paths, id);
    tokio::fs::create_dir_all(&dir).await?;
    let mc = s.mc_version.clone();

    // Loader-Version festlegen
    if s.loader.kind != LoaderKind::Vanilla && s.loader.version.as_deref().map(|v| v.trim().is_empty()).unwrap_or(true) {
        sp.message("Loader-Version wird bestimmt …");
        let v = loaders::default_loader_version(state, s.loader.kind, &mc).await?;
        s = state.servers.modify(id, |x| x.loader.version = Some(v))?;
    }

    sp.message(format!("Minecraft {mc} wird vorbereitet …"));
    meta::ensure_vanilla_json(state, &mc, force).await?;
    let chain = meta::load_chain(&state.paths, &mc)?;
    let resolved = meta::merge(&chain, &meta::Env::current());
    let mut major = meta::required_java(&resolved);
    let mut component = resolved.java.as_ref().and_then(|j| j.component.clone());
    // Plugin-Software: Mindest-Java + empfohlene JVM-Flags von PaperMC
    let mut platform_flags: Vec<String> = Vec::new();
    if let Some(p) = &s.platform {
        let (min, flags) = super::platform::java_info(state, p.kind, &mc).await;
        (major, component) = super::platform::java_requirement(major, component, min);
        platform_flags = flags;
    }
    sp.check()?;

    sp.message("Java wird geprüft …");
    let java_inst = java::resolve_with(state, s.java_path.as_deref(), major, component.as_deref(), false, &sp.sub(0.02, 0.2)).await?;
    let java_path = PathBuf::from(&java_inst.path);
    sp.check()?;

    let mut spec = LaunchSpec { args: vec![], java_major: major, java_component: component.clone() };
    let lv = s.loader.version.clone().unwrap_or_default();
    if let Some(p) = s.platform.clone() {
        let builds = super::platform::builds(state, p.kind, &mc).await.map_err(|e| {
            AppError::msg(format!("{} für Minecraft {mc}: Build-Liste nicht ladbar: {e}", p.kind.name()))
        })?;
        let b = super::platform::pick_build(&builds, p.build.as_deref())
            .ok_or_else(|| match &p.build {
                Some(b) => AppError::msg(format!("{} Build {b} für Minecraft {mc} gibt es nicht (mehr).", p.kind.name())),
                None => AppError::msg(format!("Für Minecraft {mc} gibt es keinen {}-Build.", p.kind.name())),
            })?
            .clone();
        let cached = super::platform::download(state, p.kind, &mc, &b, force, &sp.sub(0.2, 0.95)).await?;
        let jar = format!("{}.jar", p.kind.as_str());
        let dst = dir.join(&jar);
        tokio::task::spawn_blocking(move || -> AppResult<()> {
            let _ = std::fs::remove_file(&dst);
            if std::fs::hard_link(&cached, &dst).is_err() {
                std::fs::copy(&cached, &dst)?;
            }
            Ok(())
        })
        .await??;
        std::fs::create_dir_all(dir.join("plugins"))?;
        // Gewählten Build merken (Anzeige + Updates)
        let build = b.id.clone();
        state.servers.modify(id, |x| {
            if let Some(pl) = x.platform.as_mut() {
                pl.build = Some(build);
            }
        })?;
        spec.args = platform_flags;
        spec.args.extend(["-jar".to_string(), jar]);
    } else {
        match s.loader.kind {
            LoaderKind::Vanilla => {
                vanilla_server_jar(state, &mc, &dir, force, &sp.sub(0.2, 0.95)).await?;
                spec.args = vec!["-jar".into(), "server.jar".into()];
            }
            LoaderKind::Fabric => {
                vanilla_server_jar(state, &mc, &dir, force, &sp.sub(0.2, 0.7)).await?;
                sp.message("Fabric-Server wird eingerichtet …");
                let inst_ver = latest_fabric_installer(state).await?;
                let url = format!(
                    "{}/versions/loader/{}/{}/{}/server/jar",
                    loaders::FABRIC_META,
                    urlencoding::encode(&mc),
                    urlencoding::encode(&lv),
                    urlencoding::encode(&inst_ver)
                );
                let target = dir.join("fabric-server-launch.jar");
                if force {
                    let _ = tokio::fs::remove_file(&target).await;
                }
                state.net.download_all(vec![DownloadItem::new(url, &target)], Some(&sp.sub(0.7, 0.95))).await.map_err(|e| {
                    AppError::msg(format!("Fabric {lv} für Minecraft {mc} konnte nicht geladen werden: {e}"))
                })?;
                std::fs::write(dir.join("fabric-server-launcher.properties"), "serverJar=server.jar\n")?;
                spec.args = vec!["-jar".into(), "fabric-server-launch.jar".into()];
            }
            LoaderKind::Quilt => {
                vanilla_server_jar(state, &mc, &dir, force, &sp.sub(0.2, 0.6)).await?;
                sp.message("Quilt-Installer wird geladen …");
                let iv = latest_quilt_installer(state).await?;
                let url = format!("https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/{iv}/quilt-installer-{iv}.jar");
                let installer = state.paths.libraries().join(format!("org/quiltmc/quilt-installer/{iv}/quilt-installer-{iv}.jar"));
                state.net.download_all(vec![DownloadItem::new(url, &installer)], None).await?;
                let args = vec![
                    "-jar".to_string(),
                    installer.to_string_lossy().to_string(),
                    "install".into(),
                    "server".into(),
                    mc.clone(),
                    lv.clone(),
                    format!("--install-dir={}", dir.to_string_lossy()),
                ];
                run_java(&java_path, &args, &dir, &sp.sub(0.6, 0.95), "Quilt-Installer").await?;
                if !dir.join("quilt-server-launch.jar").is_file() {
                    return Err(AppError::msg("Quilt-Installer hat keinen Server-Starter erzeugt."));
                }
                spec.args = vec!["-jar".into(), "quilt-server-launch.jar".into()];
            }
            LoaderKind::Forge | LoaderKind::Neoforge => {
                let neo = s.loader.kind == LoaderKind::Neoforge;
                let fspec = crate::minecraft::forge::ForgeSpec { neoforge: neo, mc: &mc, version: &lv };
                let (installer, _full) = crate::minecraft::forge::download_installer(state, &fspec, force, &sp.sub(0.2, 0.3)).await?;
                let name = if neo { "NeoForge-Installer" } else { "Forge-Installer" };
                let need = force || detect_forge_launch(&dir).is_none();
                if need {
                    sp.message(format!("{name} läuft (lädt Bibliotheken, dauert etwas) …"));
                    let args = vec!["-jar".to_string(), installer.to_string_lossy().to_string(), "--installServer".into(), dir.to_string_lossy().to_string()];
                    run_java(&java_path, &args, &dir, &sp.sub(0.3, 0.97), name).await?;
                    // Installer-Log im Server-Ordner aufräumen
                    if let Ok(rd) = std::fs::read_dir(&dir) {
                        for e in rd.flatten() {
                            let n = e.file_name().to_string_lossy().to_ascii_lowercase();
                            if n.ends_with("installer.jar.log") || n == "installer.log" {
                                let _ = std::fs::remove_file(e.path());
                            }
                        }
                    }
                }
                spec.args = detect_forge_launch(&dir).ok_or_else(|| AppError::msg(format!("{name}: Startdatei nicht gefunden.")))?;
            }
        }
    }
    sp.check()?;
    // Standarddateien
    let props = dir.join("server.properties");
    if !props.is_file() {
        super::props::set(&props, &super::props::defaults(s.port, &s.name))?;
    }
    if s.eula {
        std::fs::write(dir.join("eula.txt"), "eula=true\n")?;
    }
    sp.progress(1.0);
    Ok(spec)
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
mod tests {
    use super::*;
    #[test]
    fn forge_launch_detection() {
        let dir = std::env::temp_dir().join(format!("vibe-forge-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = if cfg!(windows) { "run.bat" } else { "run.sh" };
        std::fs::write(
            dir.join(script),
            "@echo off\nREM x\njava @user_jvm_args.txt @libraries/net/neoforged/neoforge/21.1.77/win_args.txt %*\npause\n",
        )
        .unwrap();
        std::fs::write(dir.join("user_jvm_args.txt"), "# x\n").unwrap();
        assert_eq!(
            detect_forge_launch(&dir).unwrap(),
            vec!["@user_jvm_args.txt".to_string(), "@libraries/net/neoforged/neoforge/21.1.77/win_args.txt".to_string()]
        );
        std::fs::remove_file(dir.join(script)).unwrap();
        std::fs::write(dir.join("forge-1.12.2-14.23.5.2859.jar"), "x").unwrap();
        std::fs::write(dir.join("forge-1.12.2-14.23.5.2859-installer.jar"), "x").unwrap();
        assert_eq!(detect_forge_launch(&dir).unwrap(), vec!["-jar".to_string(), "forge-1.12.2-14.23.5.2859.jar".to_string()]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
