//! HTTP-Helfer für die Plattform-APIs (GET/POST mit Retries, Fehlerzuordnung, Cache).
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::de::DeserializeOwned;
use std::time::Duration;

/// Anfrage senden (mit bis zu 3 Versuchen bei 429/5xx/Netzwerkfehlern) und Body liefern.
/// `service` erscheint in Fehlermeldungen ("Modrinth", "CurseForge").
pub async fn send(rb: reqwest::RequestBuilder, service: &str) -> AppResult<bytes::Bytes> {
    let mut last_err: Option<AppError> = None;
    for attempt in 0..4u64 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(400 * attempt * attempt)).await;
        }
        let Some(req) = rb.try_clone() else {
            return Err(AppError::msg("Anfrage konnte nicht wiederholt werden"));
        };
        match req.send().await {
            Ok(r) => {
                let status = r.status();
                if status.is_success() {
                    return Ok(r.bytes().await?);
                }
                let code = status.as_u16();
                match code {
                    404 => return Err(AppError::NotFound(format!("{service}: Eintrag nicht gefunden"))),
                    401 if service == "CurseForge" => {
                        return Err(AppError::NotConfigured("CurseForge-API-Key ist ungültig".into()));
                    }
                    // CurseForge antwortet bei Drosselung (v. a. /mods/search) sporadisch mit 403 -> wiederholen
                    403 if service == "CurseForge" => {
                        last_err = Some(AppError::NotConfigured(
                            "CurseForge hat die Anfrage mit diesem API-Key abgelehnt (Key ungültig, ohne Berechtigung oder gedrosselt) – bitte später erneut versuchen".into(),
                        ))
                    }
                    429 => last_err = Some(AppError::msg(format!("{service}: Zu viele Anfragen – bitte kurz warten"))),
                    c if c >= 500 => last_err = Some(AppError::msg(format!("{service} ist gerade nicht erreichbar (HTTP {c})"))),
                    c => {
                        let body = r.text().await.unwrap_or_default();
                        let body: String = body.chars().take(200).collect();
                        tracing::warn!("{service} HTTP {c}: {body}");
                        return Err(AppError::msg(format!("{service}: Anfrage abgelehnt (HTTP {c})")));
                    }
                }
            }
            Err(e) => {
                last_err = Some(AppError::msg(format!("{service} nicht erreichbar – Internetverbindung prüfen ({e})")))
            }
        }
    }
    Err(last_err.unwrap_or_else(|| AppError::msg(format!("{service} nicht erreichbar"))))
}

pub fn parse<T: DeserializeOwned>(bytes: &[u8], service: &str) -> AppResult<T> {
    serde_json::from_slice(bytes).map_err(|e| {
        tracing::warn!("{service}: unerwartete Antwort: {e}");
        AppError::msg(format!("{service}: unerwartete Antwort ({e})"))
    })
}

/// Anfrage mit Cache (Schlüssel = `key`, z. B. URL oder URL + Body).
pub async fn cached(state: &AppState, key: String, rb: reqwest::RequestBuilder, service: &str) -> AppResult<bytes::Bytes> {
    if let Some(b) = state.content.cache_get(&key) {
        return Ok(b);
    }
    let b = send(rb, service).await?;
    state.content.cache_put(key, b.clone());
    Ok(b)
}
