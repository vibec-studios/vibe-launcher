use super::*;

/// `${name}` ersetzen; unbekannte Platzhalter bleiben stehen.
pub fn substitute(s: &str, vars: &HashMap<&str, String>) -> String {
    if !s.contains("${") {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find("${") {
        out.push_str(&rest[..i]);
        let after = &rest[i + 2..];
        match after.find('}') {
            Some(j) => {
                let key = &after[..j];
                match vars.get(key) {
                    Some(v) => out.push_str(v),
                    None => {
                        out.push_str("${");
                        out.push_str(key);
                        out.push('}');
                    }
                }
                rest = &after[j + 1..];
            }
            None => {
                out.push_str(&rest[i..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

pub(super) fn is_gc_flag(a: &str) -> bool {
    a.starts_with("-XX:+Use") && a.ends_with("GC")
}

pub fn build(state: &AppState, inst: &Instance, prep: &Prepared, acc: &LaunchAccount, settings: &Settings) -> AppResult<LaunchPlan> {
    let paths = &state.paths;
    let r = &prep.resolved;
    let env = Env::current().with_feature("has_custom_resolution", true);
    let sep = if cfg!(windows) { ";" } else { ":" };
    let game_dir = paths.game_dir(&inst.id);

    // Klassenpfad
    let libs_dir = paths.libraries();
    let mut cp: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for l in &r.libraries {
        if let Some(a) = l.artifact(&libs_dir) {
            let s = a.path.to_string_lossy().to_string();
            if seen.insert(s.clone()) {
                cp.push(s);
            }
        }
    }
    let client = prep.client_jar.to_string_lossy().to_string();
    if seen.insert(client.clone()) {
        cp.push(client.clone());
    }

    let width = inst.window.width.unwrap_or(settings.game_width).max(320);
    let height = inst.window.height.unwrap_or(settings.game_height).max(240);
    let fullscreen = inst.window.fullscreen.unwrap_or(settings.fullscreen);
    let max_mem = inst.java.max_memory_mb.unwrap_or(settings.max_memory_mb).max(512);
    let min_mem = inst.java.min_memory_mb.unwrap_or(settings.min_memory_mb).clamp(128, max_mem);
    let asset_index = r.asset_index.as_ref().map(|a| a.id.clone()).or_else(|| r.assets.clone()).unwrap_or_else(|| "legacy".into());
    let uuid = acc.uuid.replace('-', "");

    let mut vars: HashMap<&str, String> = HashMap::new();
    vars.insert("auth_player_name", acc.username.clone());
    vars.insert("auth_uuid", uuid.clone());
    vars.insert("auth_access_token", acc.access_token.clone());
    vars.insert("auth_session", format!("token:{}:{}", acc.access_token, uuid));
    vars.insert("auth_xuid", acc.xuid.clone().filter(|x| !x.is_empty()).unwrap_or_else(|| "0".into()));
    vars.insert("clientid", acc.client_id.clone().filter(|x| !x.is_empty()).unwrap_or_else(|| "0".into()));
    vars.insert("user_type", if acc.user_type.is_empty() { "msa".into() } else { acc.user_type.clone() });
    vars.insert("user_properties", "{}".into());
    vars.insert("version_name", r.id.clone());
    vars.insert("version_type", if r.kind.is_empty() { "release".into() } else { r.kind.clone() });
    vars.insert("game_directory", game_dir.to_string_lossy().to_string());
    vars.insert("assets_root", paths.assets().to_string_lossy().to_string());
    vars.insert("game_assets", prep.game_assets.to_string_lossy().to_string());
    vars.insert("assets_index_name", asset_index);
    vars.insert("natives_directory", prep.natives_dir.to_string_lossy().to_string());
    vars.insert("library_directory", libs_dir.to_string_lossy().to_string());
    vars.insert("libraries_directory", libs_dir.to_string_lossy().to_string());
    vars.insert("classpath_separator", sep.to_string());
    vars.insert("classpath", cp.join(sep));
    vars.insert("primary_jar", client.clone());
    vars.insert("launcher_name", LAUNCHER_NAME.into());
    vars.insert("launcher_version", env!("CARGO_PKG_VERSION").into());
    vars.insert("resolution_width", width.to_string());
    vars.insert("resolution_height", height.to_string());

    // Nutzer-JVM-Argumente
    let mut user_jvm = split_args(&settings.jvm_args);
    if let Some(a) = &inst.java.jvm_args {
        user_jvm.extend(split_args(a));
    }
    let user_sets_gc = user_jvm.iter().any(|a| is_gc_flag(a));
    let user_sets_mem = |p: &str| user_jvm.iter().any(|a| a.starts_with(p));

    // JVM
    let mut jvm: Vec<String> = Vec::new();
    if !user_sets_mem("-Xms") {
        jvm.push(format!("-Xms{min_mem}M"));
    }
    if !user_sets_mem("-Xmx") {
        jvm.push(format!("-Xmx{max_mem}M"));
    }
    let mut json_jvm = eval_args(&r.jvm_args, &env);
    if !json_jvm.iter().any(|a| a.contains("-Djava.library.path")) {
        json_jvm.insert(0, "-Djava.library.path=${natives_directory}".into());
        if cfg!(windows) {
            json_jvm.insert(0, "-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump".into());
        }
    }
    if !json_jvm.iter().any(|a| a.contains("minecraft.launcher.brand")) {
        json_jvm.push("-Dminecraft.launcher.brand=${launcher_name}".into());
        json_jvm.push("-Dminecraft.launcher.version=${launcher_version}".into());
    }
    if !json_jvm.iter().any(|a| a == "${classpath}") {
        json_jvm.push("-cp".into());
        json_jvm.push("${classpath}".into());
    }
    jvm.extend(json_jvm.iter().map(|a| substitute(a, &vars)));
    // Mojangs Standard-Optionen (GC usw.), außer Speicher; nur wenn der Nutzer keinen GC wählt
    if !user_sets_gc {
        for a in eval_args(&r.default_user_jvm, &env) {
            if !a.starts_with("-Xmx") && !a.starts_with("-Xms") && !jvm.contains(&a) {
                jvm.push(a);
            }
        }
    }
    if let (Some(l), Some(p)) = (&r.logging, &prep.log_config) {
        let mut v = HashMap::new();
        v.insert("path", p.to_string_lossy().to_string());
        jvm.push(substitute(&l.argument, &v));
    }
    jvm.extend(user_jvm.iter().map(|a| substitute(a, &vars)));
    // Log4Shell: zusätzlich zu Mojangs Log-Konfiguration immer Lookups abschalten (Defense in depth)
    if !jvm.iter().any(|a| a.starts_with("-Dlog4j2.formatMsgNoLookups")) {
        jvm.push(super::super::log4shell::NO_LOOKUPS.into());
    }

    // Spiel
    let mut game: Vec<String> = Vec::new();
    if let Some(ma) = &r.minecraft_arguments {
        game.extend(split_args(ma));
    }
    game.extend(eval_args(&r.game_args, &env));
    let has_res = game.iter().any(|a| a.contains("${resolution_width}"));
    let mut game: Vec<String> = game.iter().map(|a| substitute(a, &vars)).collect();
    if !has_res {
        game.extend(["--width".into(), width.to_string(), "--height".into(), height.to_string()]);
    }
    if fullscreen && !game.iter().any(|a| a == "--fullscreen") {
        game.push("--fullscreen".into());
    }
    if r.main_class.is_empty() {
        return Err(AppError::msg("Versionsdaten ohne mainClass – bitte Instanz reparieren."));
    }

    let java = PathBuf::from(&prep.java.path);
    let mut args: Vec<String> = Vec::new();
    args.extend(jvm);
    args.push(r.main_class.clone());
    args.extend(game);

    // Wrapper der Instanz ersetzt den globalen
    let wrapper = inst.hooks.wrapper.as_deref().filter(|w| !w.trim().is_empty()).or(settings.wrapper_command.as_deref());
    let (program, args) = match wrapper.map(split_args).filter(|w| !w.is_empty()) {
        Some(mut w) => {
            let prog = PathBuf::from(w.remove(0));
            let mut a = w;
            a.push(java.to_string_lossy().to_string());
            a.extend(args);
            (prog, a)
        }
        None => (java, args),
    };

    // Anzeige: Token maskieren, Klassenpfad kürzen
    let cp_full = cp.join(sep);
    let display_args: Vec<String> = args
        .iter()
        .map(|a| {
            if *a == cp_full {
                format!("<{} Einträge>", cp.len())
            } else if !acc.access_token.is_empty() && *a == acc.access_token {
                "••••••".to_string()
            } else if acc.access_token.len() >= 8 && a.contains(&acc.access_token) {
                a.replace(&acc.access_token, "••••••")
            } else {
                a.clone()
            }
        })
        .map(|a| if a.contains(' ') { format!("\"{a}\"") } else { a })
        .collect();
    let display = format!("{} {}", program.display(), display_args.join(" "));

    let mut envs = HashMap::new();
    for (k, v) in &inst.java.env {
        if !k.trim().is_empty() {
            envs.insert(k.clone(), v.clone());
        }
    }
    Ok(LaunchPlan { program, args, env: envs, cwd: game_dir, display })
}
