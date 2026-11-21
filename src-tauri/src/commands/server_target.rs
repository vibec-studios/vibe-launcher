use crate::content::{http, modrinth as mr};
use crate::error::AppResult;
use crate::server::plugins::{self, AddonSource, AddonTarget};
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

const HANGAR: &str = "https://hangar.papermc.io/api/v1";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AddonCheck {
    pub ok: bool,
    pub reason: Option<&'static str>,
    pub version: Option<String>,
    pub installed: bool,
    pub deps: u32,
    pub message: Option<String>,
}

impl AddonCheck {
    fn no(reason: &'static str) -> Self {
        AddonCheck { ok: false, reason: Some(reason), version: None, installed: false, deps: 0, message: None }
    }
}

pub fn side_blocks(t: &AddonTarget, server_side: Option<&str>) -> bool {
    !t.plugins && server_side == Some("unsupported")
}

pub fn loader_fits(t: &AddonTarget, loaders: &[String]) -> bool {
    loaders.iter().any(|l| t.loaders.contains(l))
}

async fn check_modrinth(state: &AppState, t: &AddonTarget, project: &str) -> AppResult<AddonCheck> {
    let p = mr::raw_project(state, project).await?;
    if side_blocks(t, p.server_side.as_deref()) {
        return Ok(AddonCheck::no("client_only"));
    }
    if !p.loaders.is_empty() && !loader_fits(t, &p.loaders) {
        return Ok(AddonCheck::no(if t.plugins { "not_plugin" } else { "loader" }));
    }
    let url = format!(
        "{}/project/{}/version?loaders={}",
        mr::API,
        urlencoding::encode(&p.id),
        urlencoding::encode(&serde_json::to_string(&t.loaders)?)
    );
    let b = http::cached(state, url.clone(), state.net.client.get(&url), "Modrinth").await?;
    let versions: Vec<mr::MrVersion> = http::parse(&b, "Modrinth")?;
    match plugins::pick_modrinth(&versions, t) {
        Some(v) => Ok(AddonCheck {
            ok: true,
            reason: None,
            deps: v.dependencies.iter().filter(|d| d.dependency_type == "required").count() as u32,
            version: Some(v.version_number),
            installed: false,
            message: None,
        }),
        None => Ok(AddonCheck::no(if versions.is_empty() { "loader" } else { "version" })),
    }
}

async fn check_hangar(state: &AppState, t: &AddonTarget, project: &str) -> AppResult<AddonCheck> {
    let Some(platform) = t.hangar else { return Ok(AddonCheck::no("hangar")) };
    let slug = project.rsplit('/').next().unwrap_or(project);
    let url = format!(
        "{HANGAR}/projects/{}/versions?limit=25&offset=0&platform={platform}&platformVersion={}",
        urlencoding::encode(slug),
        urlencoding::encode(&t.mc)
    );
    let b = http::cached(state, url.clone(), state.net.client.get(&url), "Hangar").await?;
    Ok(match plugins::pick_hangar(&b, platform) {
        Ok(Some((name, ..))) => AddonCheck { ok: true, reason: None, version: Some(name), installed: false, deps: 0, message: None },
        Ok(None) => AddonCheck::no("version"),
        Err(e) => AddonCheck { message: Some(e.to_string()), ..AddonCheck::no("external") },
    })
}

#[tauri::command]
pub async fn server_addon_check(state: State<'_, AppState>, id: String, source: AddonSource, project: String) -> AppResult<AddonCheck> {
    let s = state.servers.get(&id)?;
    let Some(t) = plugins::target(&s) else { return Ok(AddonCheck::no("vanilla")) };
    let installed = plugins::list(&state, &s).await.map(|l| l.items.iter().any(|a| a.project_id.as_deref() == Some(project.as_str()) || a.slug.as_deref() == Some(project.as_str()))).unwrap_or(false);
    let mut c = match source {
        AddonSource::Modrinth => check_modrinth(&state, &t, &project).await?,
        AddonSource::Hangar => check_hangar(&state, &t, &project).await?,
    };
    c.installed = installed;
    Ok(c)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(plugins: bool, loaders: &[&str]) -> AddonTarget {
        AddonTarget { folder: if plugins { "plugins" } else { "mods" }, plugins, loaders: loaders.iter().map(|s| s.to_string()).collect(), mc: "1.21.1".into(), hangar: plugins.then_some("PAPER") }
    }

    #[test]
    fn compat_rules() {
        let mods = target(false, &["fabric"]);
        assert!(side_blocks(&mods, Some("unsupported")));
        assert!(!side_blocks(&mods, Some("optional")));
        assert!(!side_blocks(&target(true, &["paper"]), Some("unsupported")));
        assert!(loader_fits(&mods, &["fabric".into(), "quilt".into()]));
        assert!(!loader_fits(&mods, &["forge".into()]));
        assert!(loader_fits(&target(true, &["paper", "spigot", "bukkit"]), &["bukkit".into()]));
    }
}
