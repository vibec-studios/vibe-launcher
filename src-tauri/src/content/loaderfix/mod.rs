//! Loader-Diagnose für „Probleme beheben“: Ist der Mod-Loader (Fabric, Quilt, Forge, NeoForge) vollständig
//! installiert, und passt seine Version zu den Anforderungen der Mods?
//!
//! - [`inspect`] (nur Dateisystem, kein Netz): Versions-JSON-Kette lesbar, Libraries vorhanden und nicht leer bzw.
//!   in der erwarteten Größe, letzte Installation nicht fehlgeschlagen.
//! - [`loader_needs`] (rein, getestet): Zustand + Anforderungen der Mods + verfügbare Loader-Versionen -> Bedarf:
//!   Loader auf eine passende Version umstellen, neu installieren oder (nicht lösbar) nur melden.
//! - [`pick_version`]: neueste (stabile) Loader-Version, die **alle** Anforderungen erfüllt.

use super::deps::{satisfies, LoaderReq};
use crate::instance::{Instance, InstallState, LoaderKind};
use crate::minecraft::{loaders, meta, LoaderVersion};
use crate::paths::Paths;

#[cfg(test)]
mod tests;

/// Zustand der Loader-Installation einer Instanz.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoaderFiles {
    /// Vollständig (oder nichts zu prüfen, z. B. Vanilla)
    Ok,
    /// Noch nicht installiert – passiert beim nächsten Start automatisch
    NotInstalled,
    /// Letzte Installation ist fehlgeschlagen
    Failed,
    /// Dateien fehlen (Versions-JSON oder Libraries)
    Missing { files: u32 },
    /// Dateien sind beschädigt (Versions-JSON unlesbar, Library leer oder falsche Größe)
    Broken { files: u32 },
}

/// Loader-Installation prüfen (schnell: nur Dateien lesen bzw. Größe vergleichen, keine Hashes).
pub fn inspect(paths: &Paths, inst: &Instance) -> LoaderFiles {
    if inst.loader.kind == LoaderKind::Vanilla {
        return LoaderFiles::Ok;
    }
    match inst.install_state {
        InstallState::Failed => return LoaderFiles::Failed,
        InstallState::NotInstalled | InstallState::Installing => return LoaderFiles::NotInstalled,
        InstallState::Installed => {}
    }
    // Alte Instanzen ohne gemerkte Versions-ID: nichts Sicheres zu prüfen
    let Some(id) = inst.version_id.as_deref().filter(|v| !v.trim().is_empty()) else { return LoaderFiles::Ok };
    let mut chain = Vec::new();
    let mut cur = id.to_string();
    loop {
        if chain.len() > 8 {
            return LoaderFiles::Broken { files: 1 };
        }
        let p = paths.version_json(&cur);
        if !p.is_file() {
            return LoaderFiles::Missing { files: 1 };
        }
        let Ok(v) = meta::read_version_file(&p) else { return LoaderFiles::Broken { files: 1 } };
        let parent = v.inherits_from.clone().filter(|p| !p.is_empty());
        chain.push(v);
        match parent {
            Some(p) => cur = p,
            None => break,
        }
    }
    let r = meta::merge(&chain, &meta::Env::current());
    if r.base_id != inst.mc_version.trim() {
        return LoaderFiles::Broken { files: 1 };
    }
    let libs = paths.libraries();
    let (mut missing, mut broken) = (0u32, 0u32);
    for l in &r.libraries {
        let Some(a) = l.artifact(&libs) else { continue };
        match a.path.metadata() {
            Err(_) => missing += 1,
            Ok(m) if m.len() == 0 || a.size.is_some_and(|s| s > 0 && s != m.len()) => broken += 1,
            Ok(_) => {}
        }
    }
    if broken > 0 {
        LoaderFiles::Broken { files: broken + missing }
    } else if missing > 0 {
        LoaderFiles::Missing { files: missing }
    } else {
        LoaderFiles::Ok
    }
}

/// Neueste Loader-Version, die alle Bereiche erfüllt (nicht auswertbare Bereiche gelten als erfüllt);
/// stabile Versionen zuerst.
pub fn pick_version(available: &[LoaderVersion], ranges: &[&str]) -> Option<String> {
    let ok = |v: &str| ranges.iter().all(|r| satisfies(r, v) != Some(false));
    let mut c: Vec<&LoaderVersion> = available.iter().filter(|l| ok(&l.version)).collect();
    c.sort_by(|a, b| b.stable.cmp(&a.stable).then_with(|| loaders::cmp_version(&b.version, &a.version)));
    c.first().map(|l| l.version.clone())
}

#[derive(Debug, Clone, PartialEq)]
pub enum LoaderNeed {
    /// Loader-Version wechseln (und installieren). `reason`: loader_too_old | loader_too_new | loader_unknown
    Set { from: Option<String>, to: String, reason: &'static str, required_by: Vec<String>, detail: Option<String> },
    /// Gleiche Version neu installieren (Dateien prüfen und neu laden).
    /// `reason`: loader_files_missing | loader_files_broken | loader_install_failed
    Repair { version: Option<String>, reason: &'static str, detail: Option<String> },
    /// Erkannt, aber nicht automatisch lösbar. `reason`: loader_version | loader_offline
    Unfixable { reason: &'static str, detail: Option<String> },
}

/// Bedarf für den Loader. `reqs`: Anforderungen der Mods, die aktiv bleiben (deaktivierte/getauschte schon
/// herausgefiltert). `available`: Loader-Versionen für die Minecraft-Version (`None` = nicht geladen/offline).
pub fn loader_needs(inst: &Instance, files: &LoaderFiles, reqs: &[LoaderReq], available: Option<&[LoaderVersion]>) -> Vec<LoaderNeed> {
    if inst.loader.kind == LoaderKind::Vanilla {
        return vec![];
    }
    let current = inst.loader.version.clone().filter(|v| !v.trim().is_empty());
    let ranges: Vec<&str> = reqs.iter().map(|r| r.range.as_str()).collect();
    let unmet: Vec<&LoaderReq> = match current.as_deref() {
        Some(cur) => reqs.iter().filter(|r| satisfies(&r.range, cur) == Some(false)).collect(),
        None => vec![],
    };
    if !unmet.is_empty() {
        let mut by: Vec<String> = vec![];
        for r in &unmet {
            if !by.contains(&r.mod_name) {
                by.push(r.mod_name.clone());
            }
        }
        let detail = unmet.iter().map(|r| format!("{} {}", r.mod_name, r.range)).collect::<Vec<_>>().join(", ");
        let Some(list) = available else {
            return vec![LoaderNeed::Unfixable { reason: "loader_offline", detail: Some(detail) }];
        };
        return match pick_version(list, &ranges) {
            Some(to) if Some(&to) != current.as_ref() => {
                let older = current.as_deref().is_some_and(|c| loaders::cmp_version(&to, c) == std::cmp::Ordering::Less);
                vec![LoaderNeed::Set { from: current, to, reason: if older { "loader_too_new" } else { "loader_too_old" }, required_by: by, detail: Some(detail) }]
            }
            _ => vec![LoaderNeed::Unfixable { reason: "loader_version", detail: Some(detail) }],
        };
    }
    match files {
        LoaderFiles::Failed => {
            // Eingestellte Version gibt es (für diese Minecraft-Version) nicht -> passende wählen
            let unknown = match (current.as_deref(), available) {
                (Some(cur), Some(list)) if !list.is_empty() => !list.iter().any(|l| l.version == cur),
                _ => false,
            };
            if unknown {
                if let Some(to) = available.and_then(|l| pick_version(l, &ranges)) {
                    return vec![LoaderNeed::Set { from: current, to, reason: "loader_unknown", required_by: vec![], detail: None }];
                }
            }
            vec![LoaderNeed::Repair { version: current, reason: "loader_install_failed", detail: None }]
        }
        LoaderFiles::Missing { files } => vec![LoaderNeed::Repair { version: current, reason: "loader_files_missing", detail: Some(files.to_string()) }],
        LoaderFiles::Broken { files } => vec![LoaderNeed::Repair { version: current, reason: "loader_files_broken", detail: Some(files.to_string()) }],
        LoaderFiles::Ok | LoaderFiles::NotInstalled => vec![],
    }
}

/// Muss für den Bedarf die Liste der Loader-Versionen geladen werden?
pub fn needs_versions(inst: &Instance, files: &LoaderFiles, reqs: &[LoaderReq]) -> bool {
    if inst.loader.kind == LoaderKind::Vanilla {
        return false;
    }
    let unmet = match inst.loader.version.as_deref().filter(|v| !v.trim().is_empty()) {
        Some(cur) => reqs.iter().any(|r| satisfies(&r.range, cur) == Some(false)),
        None => false,
    };
    unmet || *files == LoaderFiles::Failed
}
