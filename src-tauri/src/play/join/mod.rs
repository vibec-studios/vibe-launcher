//! Beitreten über einen Spiel-Link: Details laden, Vorschau (was wird installiert, wie groß), Instanz einrichten.
//! Den Start (Quick Play in `relay_host`) übernimmt danach das Frontend über den normalen Start-Weg.
use super::{find_match, find_vibe_update, missing_mods, valid_code, LinkMod, LinkPack, PlayLink};
use crate::content::index::ContentIndex;
use crate::content::{curseforge as cf, import, install, local, modrinth as mr, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{CreateInstance, Loader, LoaderKind};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use serde::Serialize;
use std::time::Duration;

mod preview;
mod setup;

pub use preview::*;
pub use setup::*;

/// Link vom Backend laden. Unbekannt/abgelaufen -> `NotFound("play_link_expired")`.
pub async fn fetch(state: &AppState, code: &str) -> AppResult<PlayLink> {
    let code = code.trim().to_ascii_lowercase();
    if !valid_code(&code) {
        return Err(AppError::NotFound("play_link_expired".into()));
    }
    let base = crate::vibe::ensure(state, crate::vibe::Feature::Any)?;
    let r = state.net.client.get(format!("{base}/api/v1/play-links/{code}")).timeout(Duration::from_secs(15)).send().await?;
    let status = r.status().as_u16();
    let body = r.text().await?;
    match status {
        200 => {
            let link: PlayLink = serde_json::from_str(&body).map_err(|e| AppError::msg(format!("Antwort des Vibe-Servers ist ungültig: {e}")))?;
            crate::platform::servers::parse_address(&link.relay_host).map_err(|_| AppError::Invalid("Ungültige Adresse im Spiel-Link".into()))?;
            Ok(link)
        }
        404 => Err(AppError::NotFound("play_link_expired".into())),
        _ => Err(crate::vibe::api_error(status, &body)),
    }
}

#[cfg(test)]
mod tests;
