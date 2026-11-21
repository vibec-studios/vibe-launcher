use super::*;

#[allow(clippy::too_many_arguments)]
pub(super) async fn run_install(
    state: &Core,
    spec: &ForgeSpec<'_>,
    profile: &InstallProfile,
    version_bytes: &[u8],
    installer: &Path,
    tmp_root: &Path,
    java: &Path,
    sp: &SubProgress,
) -> AppResult<(String, Vec<String>)> {
    let env = crate::minecraft::meta::Env::current();
    let libs_dir = state.paths.libraries();
    let mut version: serde_json::Value = serde_json::from_slice(version_bytes).ctx("version.json im Installer ungültig")?;
    let parsed: VersionJson = serde_json::from_value(version.clone()).ctx("version.json im Installer ungültig")?;
    let id = if parsed.id.is_empty() { profile.version.clone().unwrap_or_default() } else { parsed.id.clone() };
    if id.is_empty() {
        return Err(AppError::msg("Installer enthält keine Versions-ID"));
    }
    if parsed.inherits_from.is_none() {
        version["inheritsFrom"] = serde_json::Value::String(spec.mc.to_string());
    }
    // Legacy-Forge: alte Maven-URLs korrigieren, die eigentliche Forge-Library als lokal markieren
    if profile.version_info.is_some() {
        if let Some(libs) = version["libraries"].as_array_mut() {
            for l in libs.iter_mut() {
                let name = l["name"].as_str().unwrap_or_default().to_string();
                let is_forge = profile.install.as_ref().and_then(|i| i.path.as_deref()) == Some(name.as_str());
                if is_forge {
                    // Lokal vorhanden (aus dem Installer)
                    if let Some(rel) = maven_path(&name) {
                        l["downloads"] = serde_json::json!({ "artifact": { "path": rel.to_string_lossy().replace('\\', "/"), "url": "" } });
                    }
                } else if let Some(u) = l["url"].as_str() {
                    let fixed = u.replace("http://files.minecraftforge.net/maven", "https://maven.minecraftforge.net");
                    l["url"] = serde_json::Value::String(fixed);
                }
            }
        }
    }
    let path = state.paths.version_json(&id);
    crate::util::write_json_atomic(&path, &version)?;
    let parsed: VersionJson = crate::minecraft::meta::read_version_file(&path)?;

    // Libraries (Profil + Version) laden
    sp.message("Loader-Bibliotheken werden geladen …");
    let mut all_libs = profile.libraries.clone();
    all_libs.extend(parsed.libraries.iter().cloned());
    let (items, _local) = lib_download_items(&all_libs, &libs_dir, &env);
    state.net.download_all(items, Some(&sp.sub(0.0, 0.4))).await?;
    sp.check()?;

    // Processors
    let procs: Vec<&Processor> = profile
        .processors
        .iter()
        .filter(|p| p.sides.as_ref().map_or(true, |s| s.iter().any(|x| x == "client")))
        .collect();
    let mut produced = Vec::new();
    if !procs.is_empty() {
        let mc = profile.minecraft.clone().unwrap_or_else(|| spec.mc.to_string());
        let mc_jar = state.paths.version_jar(&mc);
        if !mc_jar.is_file() {
            return Err(AppError::msg("Minecraft-JAR fehlt für den Forge-Installer"));
        }
        let mut data: HashMap<String, String> = HashMap::new();
        for (k, v) in &profile.data {
            let Some(c) = &v.client else { continue };
            let val = if c.starts_with('[') && c.ends_with(']') {
                libs_dir.join(maven_path(&c[1..c.len() - 1]).ctx("Maven-Pfad")?).to_string_lossy().to_string()
            } else if c.starts_with('\'') && c.ends_with('\'') && c.len() >= 2 {
                c[1..c.len() - 1].to_string()
            } else if c.starts_with('/') {
                crate::util::safe_join(tmp_root, c).ctx("Pfad")?.to_string_lossy().to_string()
            } else {
                c.clone()
            };
            data.insert(k.clone(), val);
        }
        data.insert("SIDE".into(), "client".into());
        data.insert("MINECRAFT_JAR".into(), mc_jar.to_string_lossy().to_string());
        data.insert("MINECRAFT_VERSION".into(), mc.clone());
        data.insert("ROOT".into(), state.paths.meta().to_string_lossy().to_string());
        data.insert("INSTALLER".into(), installer.to_string_lossy().to_string());
        data.insert("LIBRARY_DIR".into(), libs_dir.to_string_lossy().to_string());

        let n = procs.len();
        for (i, p) in procs.into_iter().enumerate() {
            sp.check()?;
            sp.sub(0.4, 1.0).progress(i as f64 / n as f64);
            let task_name = p.args.iter().position(|a| a == "--task").and_then(|i| p.args.get(i + 1)).cloned().unwrap_or_else(|| {
                p.jar.split(':').nth(1).unwrap_or("processor").to_string()
            });
            sp.message(format!("Loader wird eingerichtet ({}/{n}: {task_name}) …", i + 1));
            // Outputs schon korrekt? Dann überspringen
            let outputs: Vec<(PathBuf, String)> = p
                .outputs
                .iter()
                .map(|(k, v)| (PathBuf::from(replace_tokens(k, &data, &libs_dir)), replace_tokens(v, &data, &libs_dir)))
                .collect();
            if !outputs.is_empty() && outputs_valid(&outputs).await {
                produced.extend(outputs.iter().map(|(p, _)| p.to_string_lossy().to_string()));
                continue;
            }
            run_processor(p, &data, &libs_dir, java).await?;
            if !outputs.is_empty() && !outputs_valid(&outputs).await {
                return Err(AppError::msg(format!("Forge-Installer: Ergebnis von {task_name} ist fehlerhaft (Prüfsumme). Bitte erneut versuchen.")));
            }
            produced.extend(outputs.iter().map(|(p, _)| p.to_string_lossy().to_string()));
        }
    }
    // Lokale Libraries (ohne URL) müssen jetzt existieren
    let (_, local) = lib_download_items(&parsed.libraries, &libs_dir, &env);
    for l in &local {
        if !l.is_file() {
            return Err(AppError::msg(format!("Loader-Datei fehlt nach der Installation: {}", l.display())));
        }
    }
    produced.extend(local.iter().map(|p| p.to_string_lossy().to_string()));
    sp.progress(1.0);
    Ok((id, produced))
}

pub(super) async fn outputs_valid(outputs: &[(PathBuf, String)]) -> bool {
    for (path, sha) in outputs {
        let p = path.clone();
        let ok = tokio::task::spawn_blocking(move || crate::net::sha1_file(&p)).await.ok().and_then(|r| r.ok());
        match ok {
            Some(h) if h.eq_ignore_ascii_case(sha.trim()) => {}
            _ => return false,
        }
    }
    true
}

/// `{KEY}` durch Daten ersetzen, `[maven]` zu Library-Pfad, `'literal'` zu literal.
pub fn replace_tokens(s: &str, data: &HashMap<String, String>, libs: &Path) -> String {
    if s.starts_with('[') && s.ends_with(']') && s.len() > 2 {
        if let Some(rel) = maven_path(&s[1..s.len() - 1]) {
            return libs.join(rel).to_string_lossy().to_string();
        }
    }
    if s.starts_with('\'') && s.ends_with('\'') && s.len() >= 2 {
        return s[1..s.len() - 1].to_string();
    }
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(n) = chars.next() {
                out.push(n);
            }
        } else if c == '{' {
            let mut key = String::new();
            let mut closed = false;
            for n in chars.by_ref() {
                if n == '}' {
                    closed = true;
                    break;
                }
                key.push(n);
            }
            match (closed, data.get(&key)) {
                (true, Some(v)) => out.push_str(v),
                _ => {
                    out.push('{');
                    out.push_str(&key);
                    if closed {
                        out.push('}');
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

pub(super) fn jar_main_class(jar: &Path) -> AppResult<String> {
    let f = std::fs::File::open(jar).map_err(|_| AppError::msg(format!("Processor fehlt: {}", jar.display())))?;
    let mut z = zip::ZipArchive::new(f)?;
    let mut e = z.by_name("META-INF/MANIFEST.MF")?;
    let mut s = String::new();
    e.read_to_string(&mut s)?;
    for line in s.lines() {
        if let Some(v) = line.strip_prefix("Main-Class:") {
            return Ok(v.trim().to_string());
        }
    }
    Err(AppError::msg(format!("Processor ohne Main-Class: {}", jar.display())))
}

pub(super) async fn run_processor(p: &Processor, data: &HashMap<String, String>, libs: &Path, java: &Path) -> AppResult<()> {
    let jar = libs.join(maven_path(&p.jar).ctx("Processor-Pfad")?);
    let jar2 = jar.clone();
    let main = tokio::task::spawn_blocking(move || jar_main_class(&jar2)).await??;
    let sep = if cfg!(windows) { ";" } else { ":" };
    let mut cp = vec![jar.to_string_lossy().to_string()];
    for c in &p.classpath {
        cp.push(libs.join(maven_path(c).ctx("Classpath")?).to_string_lossy().to_string());
    }
    let args: Vec<String> = p.args.iter().map(|a| replace_tokens(a, data, libs)).collect();
    let java = crate::minecraft::java::console_java(java);
    let mut cmd = tokio::process::Command::new(&java);
    cmd.arg("-cp").arg(cp.join(sep)).arg(&main).args(&args);
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    cmd.current_dir(libs);
    #[cfg(windows)]
    cmd.creation_flags(crate::minecraft::java::CREATE_NO_WINDOW);
    tracing::info!("Forge-Processor: {main} {}", args.join(" "));
    let out = cmd.output().await.map_err(|e| AppError::msg(format!("Java für den Forge-Installer nicht startbar: {e}")))?;
    if !out.status.success() {
        let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        let tail: Vec<&str> = text.lines().rev().take(12).collect::<Vec<_>>().into_iter().rev().collect();
        tracing::error!("Processor {main} fehlgeschlagen:\n{text}");
        return Err(AppError::msg(format!("Forge-Installer-Schritt fehlgeschlagen ({main}):\n{}", tail.join("\n"))));
    }
    Ok(())
}
