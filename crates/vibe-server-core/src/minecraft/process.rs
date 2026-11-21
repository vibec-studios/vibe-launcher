//! Prozess-Helfer.

/// Ganzen Prozessbaum beenden.
pub fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(super::java::CREATE_NO_WINDOW)
            .status();
    }
    #[cfg(unix)]
    {
        // Spiel läuft in eigener Prozessgruppe (pgid = pid)
        let _ = std::process::Command::new("kill").args(["-KILL", &format!("-{pid}")]).status();
        let _ = std::process::Command::new("kill").args(["-KILL", &pid.to_string()]).status();
    }
}
