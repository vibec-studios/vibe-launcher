use super::*;

pub(super) async fn do_install(state: &Core, id: &str, force: bool, sp: &SubProgress) -> AppResult<LaunchSpec> {
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
        let (min, flags) = crate::server::platform::java_info(state, p.kind, &mc).await;
        (major, component) = crate::server::platform::java_requirement(major, component, min);
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
        let builds = crate::server::platform::builds(state, p.kind, &mc).await.map_err(|e| {
            AppError::msg(format!("{} für Minecraft {mc}: Build-Liste nicht ladbar: {e}", p.kind.name()))
        })?;
        let b = crate::server::platform::pick_build(&builds, p.build.as_deref())
            .ok_or_else(|| match &p.build {
                Some(b) => AppError::msg(format!("{} Build {b} für Minecraft {mc} gibt es nicht (mehr).", p.kind.name())),
                None => AppError::msg(format!("Für Minecraft {mc} gibt es keinen {}-Build.", p.kind.name())),
            })?
            .clone();
        let cached = crate::server::platform::download(state, p.kind, &mc, &b, force, &sp.sub(0.2, 0.95)).await?;
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
        crate::server::props::set(&props, &crate::server::props::defaults(s.port, &s.name))?;
    }
    if s.eula {
        std::fs::write(dir.join("eula.txt"), "eula=true\n")?;
    }
    sp.progress(1.0);
    Ok(spec)
}
