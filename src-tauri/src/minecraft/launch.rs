//! Startbefehl bauen (Klassenpfad, Platzhalter, Speicher, JVM-/Spiel-Argumente) und Spiel starten.
use super::install::Prepared;
use super::meta::{eval_args, Env};
use super::LogLevel;
use crate::auth::LaunchAccount;
use crate::error::{AppError, AppResult};
use crate::instance::Instance;
use crate::settings::Settings;
use crate::state::AppState;
use crate::tasks::TaskHandle;
use std::collections::HashMap;
use std::path::PathBuf;

pub const LAUNCHER_NAME: &str = "vibe-launcher";

pub struct LaunchPlan {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub cwd: PathBuf,
    /// Für das Log: ohne Token, Klassenpfad gekürzt
    pub display: String,
}

/// Einfaches Shell-artiges Aufteilen (Leerzeichen, "…" und '…').
pub fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut has = false;
    for c in s.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => cur.push(c),
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                has = true;
            }
            None if c.is_whitespace() => {
                if has || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                    has = false;
                }
            }
            None => cur.push(c),
        }
    }
    if has || !cur.is_empty() {
        out.push(cur);
    }
    out
}

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

fn is_gc_flag(a: &str) -> bool {
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

/// Komplettablauf von `instance_launch` (innerhalb der Aufgabe).
pub async fn launch(
    state: &AppState,
    id: &str,
    account_id: Option<String>,
    world: Option<String>,
    server: Option<String>,
    task: &TaskHandle,
) -> AppResult<()> {
    let gm = state.game.clone();
    let inst = state.instances.get(id)?;
    gm.launcher_line(id, LogLevel::Launcher, format!("Vibe Launcher {} – {} wird vorbereitet", env!("CARGO_PKG_VERSION"), inst.name));
    // Inhalte automatisch aktualisieren (Content-Modul; schlägt nie fehl)
    // Vibey Client (falls für die Instanz eingeschaltet) still aktualisieren
    crate::vibey_client::before_launch(state, id, task).await;
    crate::content::autoupdate::before_launch(state, id, task).await;
    crate::content::worldbackup::before_launch(state, id, task).await;
    task.check()?;
    let prep = super::install::install_instance_opts(state, id, &task.sub(0.0, 0.9), false).await?;
    task.check()?;
    task.stage("Account wird geprüft …", Some(0.92));
    let acc = state.auth.launch_account(state, account_id.as_deref()).await.map_err(|e| match e {
        AppError::NotConfigured(_) => AppError::NotConfigured("Kein Account ausgewählt – bitte unter „Accounts“ anmelden.".into()),
        e => e,
    })?;
    gm.set_secret(id, &acc.access_token);
    task.check()?;
    let inst = state.instances.get(id)?;
    let settings = state.settings();
    let mut plan = build(state, &inst, &prep, &acc, &settings)?;
    // Quick Play (ab 1.20): direkt in eine Einzelspielerwelt starten
    if let Some(w) = world {
        // Der Barrierefreiheits-Willkommensbildschirm beim allerersten Start würde Quick Play blockieren
        skip_onboarding(&plan.cwd);
        plan.args.extend(["--quickPlaySingleplayer".to_string(), w.clone()]);
        plan.display.push_str(&format!(" --quickPlaySingleplayer \"{w}\""));
    } else if let Some(s) = server {
        // Direkt auf einen Server: Quick Play ab 1.20, davor die alten Argumente --server/--port
        skip_onboarding(&plan.cwd);
        let args = if crate::platform::servers::supports_quick_play(&inst.mc_version) {
            vec!["--quickPlayMultiplayer".to_string(), s.clone()]
        } else {
            let (host, port) = crate::platform::servers::parse_address(&s)?;
            vec!["--server".to_string(), host, "--port".to_string(), port.to_string()]
        };
        plan.display.push_str(&format!(" {}", args.join(" ")));
        plan.args.extend(args);
    }
    let j = &prep.java;
    gm.launcher_line(
        id,
        LogLevel::Launcher,
        format!("Java {} ({}, {}): {}", j.version, j.vendor.clone().unwrap_or_else(|| "unbekannt".into()), j.arch, j.path),
    );
    gm.launcher_line(id, LogLevel::Launcher, format!("Version: {} · Spielordner: {}", prep.resolved.id, plan.cwd.display()));
    gm.launcher_line(id, LogLevel::Launcher, format!("Startbefehl: {}", plan.display));
    if let Some(cmd) = inst.hooks.pre_launch.as_deref().filter(|c| !c.trim().is_empty()) {
        task.stage("Pre-Launch-Befehl läuft …", Some(0.95));
        super::hooks::run(state, &inst, "Pre-Launch", cmd, Some(&prep.java.path)).await?;
        task.check()?;
    }
    task.stage("Spiel wird gestartet …", Some(0.97));

    tokio::fs::create_dir_all(&plan.cwd).await?;
    // java.exe statt javaw.exe (CREATE_NO_WINDOW verhindert das Konsolenfenster): Startfehler der
    // JVM landen so im Log statt in einem blockierenden Windows-Dialog.
    let program = super::java::console_java(&plan.program);
    crate::platform::gpupref::apply_for_launch(&state.paths, settings.prefer_dgpu, &program);
    let mut cmd = tokio::process::Command::new(&program);
    cmd.args(&plan.args)
        .current_dir(&plan.cwd)
        .envs(&plan.env)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(super::java::CREATE_NO_WINDOW);
    #[cfg(unix)]
    cmd.process_group(0);
    let child = cmd.spawn().map_err(|e| AppError::msg(format!("Spiel konnte nicht gestartet werden ({}): {e}", program.display())))?;
    gm.attach(state.clone(), id.to_string(), child);
    Ok(())
}

/// `onboardAccessibility:false` in options.txt setzen (nur dieser Schlüssel, Rest bleibt unverändert).
fn skip_onboarding(game_dir: &std::path::Path) {
    let file = game_dir.join("options.txt");
    let text = std::fs::read_to_string(&file).unwrap_or_default();
    if text.lines().any(|l| l.trim() == "onboardAccessibility:false") {
        return;
    }
    let mut out: Vec<String> = text.lines().filter(|l| !l.starts_with("onboardAccessibility:")).map(str::to_string).collect();
    out.push("onboardAccessibility:false".into());
    if let Err(e) = std::fs::create_dir_all(game_dir).and_then(|_| std::fs::write(&file, out.join("
") + "
")) {
        tracing::warn!("options.txt nicht anpassbar: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn subst() {
        let mut v = HashMap::new();
        v.insert("a", "1".to_string());
        v.insert("classpath_separator", ";".to_string());
        assert_eq!(substitute("x${a}y", &v), "x1y");
        assert_eq!(substitute("${a}${classpath_separator}${b}", &v), "1;${b}");
        assert_eq!(substitute("${broken", &v), "${broken");
        assert_eq!(substitute("plain", &v), "plain");
    }
    #[test]
    fn split() {
        assert_eq!(split_args(r#"-Xss2M  -Dfoo="a b" ''"#), vec!["-Xss2M", "-Dfoo=a b", ""]);
        assert!(split_args("   ").is_empty());
    }
}
