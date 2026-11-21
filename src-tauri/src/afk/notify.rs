use tauri::AppHandle;

const PS_AUMID: &str = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$t = [Security.SecurityElement]::Escape($env:VIBE_TOAST_TITLE)
$b = [Security.SecurityElement]::Escape($env:VIBE_TOAST_BODY)
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$t</text><text>$b</text></binding></visual></toast>")
$n = New-Object Windows.UI.Notifications.ToastNotification $x
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:VIBE_TOAST_APP).Show($n)
"#;

pub fn app_id(app: &AppHandle) -> String {
    if cfg!(debug_assertions) {
        PS_AUMID.to_string()
    } else {
        app.config().identifier.clone()
    }
}

pub fn clip(s: &str, n: usize) -> String {
    let t: String = s.chars().filter(|c| !c.is_control()).take(n).collect();
    if s.chars().count() > n {
        format!("{t}…")
    } else {
        t
    }
}

#[cfg(windows)]
pub fn toast(app: &AppHandle, title: &str, body: &str) {
    use std::os::windows::process::CommandExt;
    let res = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", SCRIPT])
        .env("VIBE_TOAST_TITLE", clip(title, 80))
        .env("VIBE_TOAST_BODY", clip(body, 240))
        .env("VIBE_TOAST_APP", app_id(app))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(crate::minecraft::java::CREATE_NO_WINDOW)
        .spawn();
    if let Err(e) = res {
        tracing::warn!("AFK-Benachrichtigung nicht möglich: {e}");
    }
}

#[cfg(not(windows))]
pub fn toast(_: &AppHandle, title: &str, body: &str) {
    tracing::info!("AFK: {title} – {body}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clip_strips_control_and_shortens() {
        assert_eq!(clip("a\nb", 10), "ab");
        assert_eq!(clip("abcdef", 3), "abc…");
    }
}
