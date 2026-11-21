use super::files::{self, AfkFile, Mode};
use super::registry::{self, AgentState, Run};
use super::{agent, overlay};
use crate::minecraft::install::Prepared;
use crate::minecraft::launch::LaunchPlan;
use crate::minecraft::LogLevel;
use crate::state::AppState;

pub fn insert_agent_arg(plan: &mut LaunchPlan, main_class: &str, arg: String) -> bool {
    let Some(i) = plan.args.iter().position(|a| a == main_class) else { return false };
    plan.display = plan.display.replacen(&format!(" {main_class}"), &format!(" \"{arg}\" {main_class}"), 1);
    plan.args.insert(i, arg);
    true
}

pub async fn prepare(state: &AppState, id: &str, run: &str, prep: &Prepared, plan: &mut LaunchPlan) {
    let requested = registry::take_request(run);
    let cfg = state.settings().afk;
    if !cfg.enabled || (!requested && !cfg.always_ready) {
        return;
    }
    let gm = &state.game;
    let line = |level: LogLevel, text: String| gm.launcher_line(run, level, text);
    let now = crate::util::now_ms();
    let game_dir = plan.cwd.clone();
    let vibe = game_dir.join(".vibe");
    let alone = gm.others_active(id, run) == 0;
    let shared = registry::with(|r| r.values().any(|x| x.instance_id == id && !x.ended && x.run_id != run));
    if alone && overlay::pending(&game_dir) {
        if let Err(e) = overlay::restore(&game_dir) {
            line(LogLevel::Warn, format!("AFK: alte Spieleinstellungen konnten nicht wiederhergestellt werden: {e}"));
        }
    }
    let mode = if requested { Mode::Background } else { Mode::Foreground };
    let mut entry = Run::new(run, id, game_dir.clone(), mode, now);
    entry.player = gm.state_of(run).and_then(|g| g.account_name);
    if requested {
        line(LogLevel::Launcher, "AFK: Start im Hintergrund. Viele Server haben AFK-Kicks oder verbieten AFK – bitte halte dich an die Serverregeln.".into());
    }
    let mut loaded = false;
    if shared {
        line(LogLevel::Warn, "AFK: Diese Instanz läuft schon mit dem AFK-Helfer – für diese weitere Sitzung gibt es nur das Ausblenden des Fensters.".into());
    } else {
        match agent::ensure(state).await {
            Ok(jar) => {
                if insert_agent_arg(plan, &prep.resolved.main_class, agent::agent_arg(&jar.path, &vibe)) {
                    loaded = true;
                    entry.agent = AgentState::Pending;
                    entry.agent_version = Some(jar.version.clone());
                    line(LogLevel::Launcher, format!("AFK: Helfer {} wird geladen.", jar.version));
                }
            }
            Err(e) => line(LogLevel::Warn, format!("AFK: Helfer nicht verfügbar ({e}) – Rückfall auf Fenster ausblenden und niedrige Spieleinstellungen.")),
        }
        let mappings = if loaded { agent::mappings(state, &prep.resolved.base_id).await } else { None };
        let file = AfkFile::new(run, mode, cfg.auto_reconnect, mappings.map(|p| p.to_string_lossy().to_string()), now);
        files::reset(&vibe);
        match files::write_afk(&vibe, &file) {
            Ok(()) => entry.files = true,
            Err(e) => line(LogLevel::Warn, format!("AFK: .vibe/afk.json nicht geschrieben: {e}")),
        }
        entry.file = Some(file);
    }
    if requested && alone {
        let full = !loaded && cfg.options_fallback;
        match overlay::apply(&game_dir, run, if full { overlay::OVERLAY } else { overlay::NO_PAUSE }) {
            Ok(_) if full => {
                entry.overlay = true;
                line(LogLevel::Launcher, "AFK: Spieleinstellungen vorübergehend gesenkt (10 FPS, Sichtweite 2, Ton aus, keine Pause ohne Fokus). Nach dem Beenden stellt der Launcher sie wieder her.".into());
            }
            Ok(_) => line(LogLevel::Launcher, "AFK: „Pause ohne Fokus“ vorübergehend aus, damit Einzelspieler-Welten im Hintergrund weiterlaufen.".into()),
            Err(e) => line(LogLevel::Warn, format!("AFK: Spieleinstellungen nicht anpassbar: {e}")),
        }
    }
    registry::with(|r| r.insert(run.to_string(), entry));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::PathBuf;

    #[test]
    fn agent_arg_goes_before_main_class() {
        let mut plan = LaunchPlan {
            program: PathBuf::from("java"),
            args: vec!["-Xmx2G".into(), "-cp".into(), "a;b".into(), "net.minecraft.client.main.Main".into(), "--version".into(), "1.21".into()],
            env: HashMap::new(),
            cwd: PathBuf::from("g"),
            display: "java -Xmx2G -cp <2 Einträge> net.minecraft.client.main.Main --version 1.21".into(),
        };
        let arg = agent::agent_arg(std::path::Path::new("C:/a b/agent.jar"), std::path::Path::new("C:/i x/.vibe"));
        assert!(insert_agent_arg(&mut plan, "net.minecraft.client.main.Main", arg));
        assert_eq!(plan.args[3], "-javaagent:C:/a b/agent.jar=C:/i x/.vibe");
        assert_eq!(plan.args[4], "net.minecraft.client.main.Main");
        assert_eq!(plan.args.len(), 7);
        assert!(plan.display.contains("\"-javaagent:C:/a b/agent.jar=C:/i x/.vibe\" net.minecraft.client.main.Main"));
        assert!(!insert_agent_arg(&mut plan, "missing.Main", "x".into()));
    }
}
