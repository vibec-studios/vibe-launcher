use crate::state::AgentState;
use serde::Deserialize;
use vibe_server_core::error::{AppError, AppResult};

pub const REPO: &str = "vibec-studios/vibe-launcher";
pub const RESTART_EXIT_CODE: i32 = 75;

#[derive(Debug, Clone, Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GhRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

#[derive(Debug, Clone)]
pub struct Available {
    pub version: semver::Version,
    pub html_url: String,
    assets: Vec<GhAsset>,
}

pub fn asset_name() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Some("vibe-agent-x86_64-unknown-linux-musl"),
        ("linux", "aarch64") => Some("vibe-agent-aarch64-unknown-linux-musl"),
        ("windows", "x86_64") => Some("vibe-agent-x86_64-pc-windows-msvc.exe"),
        _ => None,
    }
}

pub fn newest(tags: &[(String, bool)], current: &semver::Version) -> Option<(usize, semver::Version)> {
    tags.iter()
        .enumerate()
        .filter(|(_, (_, draft))| !draft)
        .filter_map(|(i, (t, _))| t.strip_prefix("agent-v").and_then(|v| semver::Version::parse(v).ok()).map(|v| (i, v)))
        .filter(|(_, v)| v > current)
        .max_by(|a, b| a.1.cmp(&b.1))
}

pub async fn check(client: &reqwest::Client) -> AppResult<Option<Available>> {
    let url = format!("https://api.github.com/repos/{REPO}/releases?per_page=40");
    let r = client.get(&url).header("accept", "application/vnd.github+json").send().await?;
    if !r.status().is_success() {
        return Err(AppError::Unreachable(format!("GitHub antwortet mit HTTP {}", r.status())));
    }
    let list: Vec<GhRelease> = r.json().await?;
    let current = semver::Version::parse(env!("CARGO_PKG_VERSION")).unwrap_or(semver::Version::new(0, 0, 0));
    let tags: Vec<(String, bool)> = list.iter().map(|r| (r.tag_name.clone(), r.draft)).collect();
    Ok(newest(&tags, &current).map(|(i, version)| Available { version, html_url: list[i].html_url.clone(), assets: list[i].assets.clone() }))
}

fn expected_sha(sums: &str, name: &str) -> Option<String> {
    sums.lines().find_map(|l| {
        let mut it = l.split_whitespace();
        let h = it.next()?;
        let n = it.next()?.trim_start_matches('*');
        (n == name).then(|| h.to_ascii_lowercase())
    })
}

async fn apply(ctx: &AgentState, sp: &vibe_server_core::tasks::SubProgress) -> AppResult<()> {
    let client = &ctx.core.net.client;
    let avail = check(client).await?.ok_or_else(|| AppError::Invalid("Der Agent ist schon aktuell.".into()))?;
    let name = asset_name().ok_or_else(|| AppError::NotConfigured("Für diese Plattform gibt es kein Agent-Binary.".into()))?;
    let bin = avail.assets.iter().find(|a| a.name == name).ok_or_else(|| AppError::NotFound(format!("Release-Datei {name}")))?;
    let sums = avail.assets.iter().find(|a| a.name == "SHA256SUMS").ok_or_else(|| AppError::NotFound("SHA256SUMS".into()))?;
    let sums_text = client.get(&sums.browser_download_url).send().await?.error_for_status()?.text().await?;
    let want = expected_sha(&sums_text, name).ok_or_else(|| AppError::msg(format!("{name} fehlt in SHA256SUMS")))?;
    let exe = std::env::current_exe()?;
    let tmp = exe.with_extension("download");
    sp.message(format!("Agent {} wird geladen …", avail.version));
    ctx.core.net.download_all(vec![vibe_server_core::net::DownloadItem::new(&bin.browser_download_url, &tmp)], Some(sp)).await?;
    let t2 = tmp.clone();
    let got = tokio::task::spawn_blocking(move || vibe_server_core::net::sha256_file(&t2)).await??;
    if !got.eq_ignore_ascii_case(&want) {
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::msg("Prüfsumme des Updates stimmt nicht – abgebrochen."));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
    }
    let old = exe.with_extension("old");
    let _ = std::fs::remove_file(&old);
    std::fs::rename(&exe, &old)?;
    if let Err(e) = std::fs::rename(&tmp, &exe) {
        let _ = std::fs::rename(&old, &exe);
        return Err(e.into());
    }
    sp.message("Update installiert – Agent startet neu …");
    let core = ctx.core.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        core.server_mgr.stop_all().await;
        std::process::exit(RESTART_EXIT_CODE);
    });
    Ok(())
}

pub fn spawn_apply(ctx: &std::sync::Arc<AgentState>) -> String {
    let c = ctx.clone();
    ctx.core.tasks.spawn("update", "Agent-Update", None, move |task| async move { apply(&c, &task.sub(0.0, 1.0)).await })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_newest_agent_tag() {
        let tags = vec![("v1.0.0".to_string(), false), ("agent-v0.2.0".into(), false), ("agent-v0.3.0".into(), true), ("agent-v0.1.5".into(), false)];
        let cur = semver::Version::new(0, 1, 0);
        assert_eq!(newest(&tags, &cur).map(|(_, v)| v.to_string()), Some("0.2.0".into()));
        assert!(newest(&tags, &semver::Version::new(0, 2, 0)).is_none());
        let sums = "abc123  vibe-agent-x86_64-unknown-linux-musl\nDEF *vibe-agent-x86_64-pc-windows-msvc.exe\n";
        assert_eq!(expected_sha(sums, "vibe-agent-x86_64-pc-windows-msvc.exe").as_deref(), Some("def"));
    }
}
