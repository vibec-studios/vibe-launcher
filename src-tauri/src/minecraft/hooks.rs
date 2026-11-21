//! Start-Hooks je Instanz: Befehl vor dem Start (Abbruch bei Fehler) und nach dem Beenden.
//!
//! Läuft in der System-Shell (`cmd /C` bzw. `sh -c`) im Spielordner. Umgebungsvariablen wie bei Prism:
//! `INST_ID`, `INST_NAME`, `INST_DIR` (Instanzordner), `INST_MC_DIR` (Spielordner), `INST_MC_VER`,
//! `INST_LOADER`, `INST_JAVA` (falls bekannt). Ausgabe landet im Spiel-Log.
use super::LogLevel;
use crate::error::{AppError, AppResult};
use crate::instance::Instance;
use crate::state::AppState;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};

/// Höchstdauer eines Hooks (danach wird er beendet)
const TIMEOUT: Duration = Duration::from_secs(10 * 60);

pub fn env_vars(state: &AppState, inst: &Instance, java: Option<&str>) -> Vec<(String, String)> {
    let mut v = vec![
        ("INST_ID".to_string(), inst.id.clone()),
        ("INST_NAME".to_string(), inst.name.clone()),
        ("INST_DIR".to_string(), state.paths.instance_dir(&inst.id).to_string_lossy().to_string()),
        ("INST_MC_DIR".to_string(), state.paths.game_dir(&inst.id).to_string_lossy().to_string()),
        ("INST_MC_VER".to_string(), inst.mc_version.clone()),
        ("INST_LOADER".to_string(), inst.loader.kind.as_str().to_string()),
    ];
    if let Some(j) = java {
        v.push(("INST_JAVA".to_string(), j.to_string()));
    }
    v
}

fn shell(cmd: &str) -> tokio::process::Command {
    #[cfg(windows)]
    {
        let mut c = tokio::process::Command::new("cmd");
        c.arg("/D").arg("/C").raw_arg(cmd);
        c.creation_flags(super::java::CREATE_NO_WINDOW);
        c
    }
    #[cfg(not(windows))]
    {
        let mut c = tokio::process::Command::new("sh");
        c.arg("-c").arg(cmd);
        c
    }
}

/// Hook ausführen und abwarten. Fehler (Exit-Code ≠ 0, Zeitlimit) werden zurückgegeben.
pub async fn run(state: &AppState, inst: &Instance, log_key: &str, what: &str, cmd: &str, java: Option<&str>) -> AppResult<()> {
    let cmd = cmd.trim();
    if cmd.is_empty() {
        return Ok(());
    }
    let gm = state.game.clone();
    let dir = state.paths.game_dir(&inst.id);
    tokio::fs::create_dir_all(&dir).await?;
    gm.launcher_line(log_key, LogLevel::Launcher, format!("{what}: {cmd}"));
    let mut c = shell(cmd);
    c.current_dir(&dir)
        .envs(env_vars(state, inst, java))
        .envs(inst.java.env.iter().filter(|(k, _)| !k.trim().is_empty()))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let mut child = c.spawn().map_err(|e| AppError::msg(format!("{what} konnte nicht gestartet werden: {e}")))?;
    let pipe = |r: Option<Box<dyn tokio::io::AsyncRead + Unpin + Send>>, level: LogLevel| {
        let gm = gm.clone();
        let id = log_key.to_string();
        tokio::spawn(async move {
            let Some(r) = r else { return };
            let mut lines = BufReader::new(r).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                gm.launcher_line(&id, level, l);
            }
        })
    };
    let a = pipe(child.stdout.take().map(|s| Box::new(s) as _), LogLevel::Stdout);
    let b = pipe(child.stderr.take().map(|s| Box::new(s) as _), LogLevel::Stderr);
    let status = match tokio::time::timeout(TIMEOUT, child.wait()).await {
        Ok(s) => s?,
        Err(_) => {
            let _ = child.kill().await;
            return Err(AppError::msg(format!("{what}: Zeitlimit überschritten")));
        }
    };
    let _ = tokio::time::timeout(Duration::from_secs(2), async {
        let _ = a.await;
        let _ = b.await;
    })
    .await;
    if !status.success() {
        return Err(AppError::msg(format!("{what} ist fehlgeschlagen (Exit-Code {}).", status.code().map(|c| c.to_string()).unwrap_or_else(|| "?".into()))));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn shell_exit_codes() {
        let ok = super::shell("exit 0").status().await.unwrap();
        assert!(ok.success());
        let bad = super::shell("exit 3").status().await.unwrap();
        assert_eq!(bad.code(), Some(3));
    }
}
