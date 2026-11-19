//! „Neu prüfen“ auf der Instanzseite: Inhaltsordner neu einlesen, Updates ohne Cache prüfen (Mods, Packs,
//! Shader, Modpack) und die Probleme (Abhängigkeiten, Konflikte, Loader) neu berechnen – in einem Aufruf.
//! Teilfehler (z. B. offline) brechen nicht ab: Ordner und Probleme werden trotzdem aktualisiert.
use super::deps::{self, DepIssue};
use super::modpack::{self, ModpackUpdate};
use super::{install, ContentUpdate};
use crate::error::AppResult;
use crate::instance::LoaderKind;
use crate::state::AppState;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct RefreshReport {
    /// Anzahl eingelesener Inhalte (alle Arten)
    pub items: u32,
    /// Verfügbare Updates; `None`, wenn die Prüfung fehlgeschlagen ist (siehe `update_error`)
    pub updates: Option<Vec<ContentUpdate>>,
    pub update_error: Option<String>,
    /// Neuere Modpack-Version (nur Modpack-Instanzen)
    pub modpack: Option<ModpackUpdate>,
    /// Probleme (Abhängigkeits-Check inkl. Loader)
    pub issues: Vec<DepIssue>,
    pub checked_at: i64,
}

pub async fn run(state: &AppState, instance_id: &str) -> AppResult<RefreshReport> {
    let inst = state.instances.get(instance_id)?;
    // Bewusst frisch: API-Antworten (CurseForge, Stores) nicht aus dem Kurzzeit-Cache
    state.content.clear_api_cache();
    let (all, _) = install::refresh_all(state, instance_id).await?;
    let modded = inst.loader.kind != LoaderKind::Vanilla;
    let (updates, pack, issues) = tokio::join!(install::check_updates(state, instance_id), modpack::check(state, instance_id), async {
        if modded {
            deps::check(state, instance_id, true).await
        } else {
            Ok(vec![])
        }
    });
    let modpack = pack.unwrap_or_else(|e| {
        tracing::debug!("Neu prüfen {instance_id}: Modpack-Prüfung fehlgeschlagen: {e}");
        None
    });
    let (updates, update_error) = match updates {
        Ok(u) => (Some(u), None),
        Err(e) => {
            tracing::warn!("Neu prüfen {instance_id}: Update-Prüfung fehlgeschlagen: {e}");
            (None, Some(e.to_string()))
        }
    };
    if let Some(u) = &updates {
        state.content.update_counts.lock().insert(instance_id.to_string(), u.len() as u32 + modpack.is_some() as u32);
    }
    Ok(RefreshReport { items: all.len() as u32, updates, update_error, modpack, issues: issues?, checked_at: crate::util::now_ms() })
}
