//! Client/Server-Einordnung von Inhalten.
//!
//! Quellen (in dieser Reihenfolge): Index-Eintrag (Modrinth `client_side`/`server_side`, mrpack `env`,
//! CurseForge-Tags „Client“/„Server“, Store-Angaben), danach `environment` aus fabric.mod.json/quilt.mod.json.
//! Resourcepacks/Shader sind immer „nur Client“, Datapacks „nur Server“ (liegen in der Welt).
//!
//! Öffentliche API für andere Module (z. B. „Server aus Profil erstellen“): [`classify`].
use super::index::{self, ContentIndex, IndexEntry, LocalMeta};
use super::{modrinth as mr, ContentKind, Side, Source};
use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

/// Modrinth-Werte ("required" | "optional" | "unsupported" | "unknown") bzw. mrpack-`env`.
pub fn from_sides(client: Option<&str>, server: Option<&str>) -> Side {
    let c = client.unwrap_or("unknown");
    let s = server.unwrap_or("unknown");
    let on = |v: &str| v == "required" || v == "optional";
    match (c, s) {
        ("unsupported", x) if on(x) => Side::Server,
        (x, "unsupported") if on(x) => Side::Client,
        (a, b) if on(a) && on(b) => Side::Both,
        ("unknown", x) if on(x) => Side::Both,
        (x, "unknown") if on(x) => Side::Both,
        _ => Side::Unknown,
    }
}

/// CurseForge-Datei: `gameVersions` enthält oft „Client“ und/oder „Server“.
pub fn from_cf_versions(gv: &[String]) -> Option<Side> {
    let c = gv.iter().any(|v| v.eq_ignore_ascii_case("client"));
    let s = gv.iter().any(|v| v.eq_ignore_ascii_case("server"));
    match (c, s) {
        (true, true) => Some(Side::Both),
        (true, false) => Some(Side::Client),
        (false, true) => Some(Side::Server),
        _ => None,
    }
}

/// `environment` aus den Mod-Metadaten.
pub fn from_meta(meta: &LocalMeta) -> Option<Side> {
    match meta.environment.as_deref()? {
        "client" => Some(Side::Client),
        "server" => Some(Side::Server),
        "*" => Some(Side::Both),
        _ => None,
    }
}

pub fn item_side(kind: ContentKind, entry: Option<&IndexEntry>, meta: &LocalMeta) -> Side {
    match kind {
        ContentKind::Resourcepack | ContentKind::Shader => Side::Client,
        ContentKind::Datapack => Side::Server,
        ContentKind::Mod => entry.and_then(|e| e.side).filter(|s| *s != Side::Unknown).or_else(|| from_meta(meta)).unwrap_or(Side::Unknown),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SideInfo {
    /// Dateiname im Ordner der Art (inkl. `.disabled`)
    pub file_name: String,
    pub kind: ContentKind,
    pub side: Side,
    pub enabled: bool,
    /// Pfad relativ zum Spielordner (z. B. `mods/sodium.jar`)
    pub rel_path: String,
}

/// Fehlende Modrinth-Einordnungen nachladen und im Index speichern. Netzwerkfehler werden ignoriert.
pub async fn fill_modrinth_sides(state: &AppState, instance_id: &str) -> AppResult<bool> {
    let idx = ContentIndex::load(&state.paths, instance_id);
    let ids: Vec<String> = idx
        .files
        .values()
        .filter(|e| e.source == Source::Modrinth && e.side.is_none())
        .map(|e| e.project_id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if ids.is_empty() {
        return Ok(false);
    }
    let Ok(projects) = mr::raw_projects(state, &ids).await else { return Ok(false) };
    let sides: HashMap<String, Side> = projects.iter().map(|p| (p.id.clone(), from_sides(p.client_side.as_deref(), p.server_side.as_deref()))).collect();
    let lock = state.content.lock(instance_id);
    let _g = lock.lock().await;
    let mut idx = ContentIndex::load(&state.paths, instance_id);
    let mut changed = false;
    for e in idx.files.values_mut() {
        if e.source == Source::Modrinth && e.side.is_none() {
            if let Some(s) = sides.get(&e.project_id) {
                e.side = Some(*s);
                changed = true;
            }
        }
    }
    if changed {
        idx.save(&state.paths, instance_id)?;
    }
    Ok(changed)
}

/// Alle Inhalte einer Instanz mit Client/Server-Einordnung (ordnet unbekannte Dateien vorher per Hash zu
/// und lädt fehlende Modrinth-Angaben nach).
pub async fn classify(state: &AppState, instance_id: &str) -> AppResult<Vec<SideInfo>> {
    let mut all = Vec::new();
    for k in ContentKind::ALL {
        let (s, _) = super::local::refresh(state, instance_id, k).await?;
        all.extend(s.into_iter().map(|s| (k, s)));
    }
    let _ = fill_modrinth_sides(state, instance_id).await;
    let idx = ContentIndex::load(&state.paths, instance_id);
    Ok(all
        .into_iter()
        .map(|(kind, s)| SideInfo {
            side: item_side(kind, idx.files.get(&s.key), &s.meta),
            rel_path: format!("{}/{}", kind.folder(), s.file_name),
            enabled: s.enabled,
            file_name: s.file_name,
            kind,
        })
        .collect())
}

/// Schlüssel-Helfer für Aufrufer, die nur Dateinamen kennen.
pub fn key_of(kind: ContentKind, file_name: &str) -> String {
    index::key(kind.folder(), file_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mapping() {
        assert_eq!(from_sides(Some("required"), Some("unsupported")), Side::Client);
        assert_eq!(from_sides(Some("unsupported"), Some("required")), Side::Server);
        assert_eq!(from_sides(Some("required"), Some("optional")), Side::Both);
        assert_eq!(from_sides(Some("optional"), Some("optional")), Side::Both);
        assert_eq!(from_sides(Some("unknown"), Some("unknown")), Side::Unknown);
        assert_eq!(from_cf_versions(&["1.20.1".into(), "Client".into()]), Some(Side::Client));
        assert_eq!(from_cf_versions(&["Server".into(), "Client".into()]), Some(Side::Both));
        assert_eq!(from_cf_versions(&["1.20.1".into()]), None);
        let m = LocalMeta { environment: Some("client".into()), ..Default::default() };
        assert_eq!(item_side(ContentKind::Mod, None, &m), Side::Client);
        assert_eq!(item_side(ContentKind::Shader, None, &LocalMeta::default()), Side::Client);
    }
}
