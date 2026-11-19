//! Beitreten über einen Spiel-Link: Details laden, Vorschau (was wird installiert, wie groß), Instanz einrichten.
//! Den Start (Quick Play in `relay_host`) übernimmt danach das Frontend über den normalen Start-Weg.
use super::{find_match, missing_mods, valid_code, LinkMod, LinkPack, PlayLink};
use crate::content::index::ContentIndex;
use crate::content::{curseforge as cf, import, install, local, modrinth as mr, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{CreateInstance, Loader, LoaderKind};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use serde::Serialize;
use std::time::Duration;

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

fn loader_kind(s: &str) -> AppResult<LoaderKind> {
    serde_json::from_value(serde_json::Value::String(s.to_string())).map_err(|_| AppError::Invalid(format!("Unbekannter Loader: {s}")))
}

fn source_of(s: &str) -> Option<Source> {
    Source::parse(s).filter(|s| matches!(s, Source::Modrinth | Source::Curseforge))
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct JoinPreview {
    /// Vorhandene passende Instanz
    pub instance_id: Option<String>,
    pub instance_name: Option<String>,
    /// Neue Instanz wird angelegt
    pub create: bool,
    pub pack_title: Option<String>,
    pub pack_icon: Option<String>,
    pub pack_version: Option<String>,
    /// Zu installierende Inhalte (ohne die des Modpacks)
    pub mods: usize,
    /// Dateien des Modpacks
    pub pack_files: usize,
    /// Client-Pack, das noch installiert wird (ID)
    pub client_pack: Option<String>,
    /// Ungefähre Downloadgröße (ohne Minecraft selbst); None = unbekannt
    pub download_bytes: Option<u64>,
    /// Minecraft selbst muss noch geladen werden
    pub game_download: bool,
    /// Gesperrte CurseForge-Dateien (Titel), die man selbst herunterladen muss
    pub manual: Vec<String>,
    /// Problem, das das Beitreten verhindert: version_unavailable | pack_unavailable | curseforge_unavailable | loader_unsupported
    pub problem: Option<String>,
    pub problem_detail: Option<String>,
}

fn problem(p: &mut JoinPreview, kind: &str, detail: impl Into<String>) {
    p.problem = Some(kind.into());
    p.problem_detail = Some(detail.into());
}

/// Was passiert beim Beitreten? Prüft Versionen und schätzt die Größe.
pub async fn preview(state: &AppState, link: &PlayLink) -> AppResult<JoinPreview> {
    let mut p = JoinPreview::default();
    let kind = match loader_kind(&link.loader.kind) {
        Ok(k) => k,
        Err(e) => {
            problem(&mut p, "loader_unsupported", e.to_string());
            return Ok(p);
        }
    };
    let matched = find_match(state, link);
    let idx = matched.as_ref().map(|i| ContentIndex::load(&state.paths, &i.id)).unwrap_or_default();
    p.instance_id = matched.as_ref().map(|i| i.id.clone());
    p.instance_name = matched.as_ref().map(|i| i.name.clone());
    p.create = matched.is_none();
    p.game_download = matched.as_ref().map_or(true, |i| i.install_state != crate::instance::InstallState::Installed);
    let needs_cf = link.pack.as_ref().is_some_and(|x| x.source == "curseforge") || link.mods.iter().any(|m| m.source == "curseforge");
    if needs_cf && !cf::available(state) {
        problem(&mut p, "curseforge_unavailable", "CurseForge ist in diesem Launcher nicht eingerichtet.");
        return Ok(p);
    }

    // Minecraft- und Loader-Version vorhanden?
    let manifest = crate::minecraft::meta::manifest(state, false).await?;
    if !manifest.versions.iter().any(|v| v.id == link.mc_version) {
        problem(&mut p, "version_unavailable", format!("Minecraft {} ist nicht verfügbar.", link.mc_version));
        return Ok(p);
    }
    if kind != LoaderKind::Vanilla && link.pack.is_none() && matched.is_none() {
        let list = crate::minecraft::loaders::loader_versions(state, kind, &link.mc_version).await.unwrap_or_default();
        if list.is_empty() {
            problem(&mut p, "version_unavailable", format!("{} gibt es nicht für Minecraft {}.", link.loader.kind, link.mc_version));
            return Ok(p);
        }
    }

    let mut bytes: u64 = 0;
    let mut known = true;
    // Modpack
    if let (Some(pack), true) = (&link.pack, matched.is_none()) {
        match pack_preview(state, pack).await {
            Ok(pp) => {
                p.pack_title = pp.title;
                p.pack_icon = pp.icon;
                p.pack_version = pp.version;
                p.pack_files = pp.files;
                p.manual.extend(pp.manual);
                match pp.bytes {
                    Some(b) => bytes += b,
                    None => known = false,
                }
            }
            Err(e) => {
                problem(&mut p, "pack_unavailable", e.to_string());
                return Ok(p);
            }
        }
    } else if let Some(pack) = &link.pack {
        p.pack_title = pack.title.clone();
    }
    // Zusätzliche Inhalte (bei Modpack-Instanzen: was über das Pack hinausgeht – nach der Installation geprüft)
    let wanted: Vec<&LinkMod> = if link.pack.is_some() && matched.is_none() { link.mods.iter().collect() } else { missing_mods(link, &idx) };
    if link.pack.is_none() || matched.is_some() {
        p.mods = wanted.len();
        let (b, k, manual) = mods_size(state, &wanted).await;
        bytes += b;
        known &= k;
        p.manual.extend(manual);
    }
    // Client-Pack
    if let Some(cp) = link.client_pack.as_deref().filter(|c| crate::client_packs::def(c).is_some_and(|d| d.loaders.contains(&kind))) {
        let has = matched.as_ref().is_some_and(|i| crate::client_packs::installed_ids(state, &i.id).iter().any(|x| x == cp));
        if !has {
            p.client_pack = Some(cp.to_string());
        }
    }
    p.download_bytes = known.then_some(bytes);
    Ok(p)
}

struct PackPreview {
    title: Option<String>,
    icon: Option<String>,
    version: Option<String>,
    files: usize,
    bytes: Option<u64>,
    manual: Vec<String>,
}

async fn pack_preview(state: &AppState, pack: &LinkPack) -> AppResult<PackPreview> {
    let src = source_of(&pack.source).ok_or_else(|| AppError::Invalid("Unbekannte Modpack-Quelle".into()))?;
    let brief = crate::content::provider::brief(state, src, &pack.project_id).await?;
    let mut out = PackPreview { title: Some(brief.title.clone()), icon: brief.icon_url.clone(), version: None, files: 0, bytes: None, manual: vec![] };
    match src {
        Source::Modrinth => {
            let v = mr::raw_version(state, &pack.version_id).await.map_err(|_| AppError::NotFound(format!("Die Modpack-Version von {} ist nicht mehr verfügbar.", brief.title)))?;
            out.version = Some(v.version_number.clone());
            let file = v.files.iter().find(|f| f.primary && f.filename.ends_with(".mrpack")).or_else(|| v.files.iter().find(|f| f.filename.ends_with(".mrpack")));
            if let Some(f) = file.filter(|f| f.size < 64 * 1024 * 1024) {
                let data = state.net.get_bytes(&f.url).await?;
                let l = import::pack_listing(&data)?;
                out.files = l.mr_sizes.len();
                out.bytes = l.mr_sizes.iter().all(Option::is_some).then(|| l.mr_sizes.iter().flatten().sum::<u64>() + l.overrides_bytes);
            }
        }
        Source::Curseforge => {
            let f = cf::raw_file(state, &pack.project_id, &pack.version_id).await.map_err(|_| AppError::NotFound(format!("Die Modpack-Version von {} ist nicht mehr verfügbar.", brief.title)))?;
            out.version = Some(f.display_name.clone());
            let Some(url) = f.download_url.clone().filter(|_| f.file_length < 128 * 1024 * 1024) else {
                return Err(AppError::msg(format!("Der Autor von {} erlaubt keine Downloads über andere Launcher.", brief.title)));
            };
            let data = state.net.get_bytes(&url).await?;
            let l = import::pack_listing(&data)?;
            out.files = l.cf_files.len();
            let ids: Vec<u64> = l.cf_files.iter().map(|x| x.1).collect();
            let files = cf::raw_files_by_id(state, &ids).await.unwrap_or_default();
            let (bytes, manual) = cf_sizes(state, &files).await;
            out.bytes = Some(bytes + l.overrides_bytes);
            out.manual = manual;
        }
        Source::Store(_) => {}
    }
    Ok(out)
}

/// Größe der CurseForge-Dateien; gesperrte ohne Modrinth-Spiegel -> Titel für „selbst herunterladen“.
async fn cf_sizes(state: &AppState, files: &[cf::CfFile]) -> (u64, Vec<String>) {
    let bytes = files.iter().map(|f| f.file_length).sum();
    let locked: Vec<&cf::CfFile> = files.iter().filter(|f| f.locked()).collect();
    if locked.is_empty() {
        return (bytes, vec![]);
    }
    let sha1s: Vec<String> = locked.iter().filter_map(|f| f.sha1()).collect();
    let mirrors = mr::mirrors(state, &sha1s).await;
    let still: Vec<&cf::CfFile> = locked.into_iter().filter(|f| !f.sha1().is_some_and(|h| mirrors.contains_key(&h))).collect();
    let ids: Vec<u64> = still.iter().map(|f| f.mod_id).collect();
    let names = cf::raw_mods(state, &ids).await.unwrap_or_default();
    let manual = still
        .iter()
        .map(|f| names.iter().find(|m| m.id == f.mod_id).map(|m| m.name.clone()).unwrap_or_else(|| f.display_name.clone()))
        .collect();
    (bytes, manual)
}

/// Größe der Inhalte aus dem Link (nur mit Versions-ID bekannt) -> (Bytes, alles bekannt, manuelle Downloads).
async fn mods_size(state: &AppState, mods: &[&LinkMod]) -> (u64, bool, Vec<String>) {
    let mut known = true;
    let mut bytes = 0;
    let mr_ids: Vec<String> = mods.iter().filter(|m| m.source == "modrinth").filter_map(|m| m.version_id.clone()).collect();
    if mods.iter().any(|m| m.version_id.is_none()) {
        known = false;
    }
    if !mr_ids.is_empty() {
        match mr::raw_versions_batch(state, &mr_ids).await {
            Ok(list) => {
                if list.len() < mr_ids.len() {
                    known = false;
                }
                bytes += list.iter().filter_map(|v| v.files.iter().find(|f| f.primary).or(v.files.first())).map(|f| f.size).sum::<u64>();
            }
            Err(_) => known = false,
        }
    }
    let cf_ids: Vec<u64> = mods.iter().filter(|m| m.source == "curseforge").filter_map(|m| m.version_id.as_deref()?.parse().ok()).collect();
    let mut manual = vec![];
    if !cf_ids.is_empty() && cf::available(state) {
        let files = cf::raw_files_by_id(state, &cf_ids).await.unwrap_or_default();
        if files.len() < cf_ids.len() {
            known = false;
        }
        let (b, m) = cf_sizes(state, &files).await;
        bytes += b;
        manual = m;
    }
    (bytes, known, manual)
}

/// Name einer neuen Instanz: Modpack-Titel bzw. „<Welt> (<Host>)“.
pub fn new_instance_name(link: &PlayLink) -> String {
    if let Some(t) = link.pack.as_ref().and_then(|p| p.title.clone()).filter(|t| !t.trim().is_empty()) {
        return t;
    }
    match link.world_name.as_deref().map(str::trim).filter(|w| !w.is_empty()) {
        Some(w) => format!("{w} ({})", link.host.name),
        None => format!("Welt von {}", link.host.name),
    }
}

/// Task-Körper: passende Instanz nehmen oder anlegen, Inhalte und Client-Pack installieren.
/// Setzt die Instanz der Aufgabe (`task.instance_id`), damit das Frontend danach starten kann.
pub async fn run_setup(state: AppState, task: TaskHandle, link: PlayLink, instance_id: Option<String>) -> AppResult<()> {
    let kind = loader_kind(&link.loader.kind)?;
    let inst = match instance_id {
        Some(id) => state.instances.get(&id)?,
        None => match &link.pack {
            Some(pack) => {
                let src = source_of(&pack.source).ok_or_else(|| AppError::Invalid("Unbekannte Modpack-Quelle".into()))?;
                let before: std::collections::HashSet<String> = state.instances.list().into_iter().map(|i| i.id).collect();
                import::run_modpack_install(state.clone(), task.clone(), src, pack.project_id.clone(), Some(pack.version_id.clone())).await?;
                let created = state
                    .instances
                    .list()
                    .into_iter()
                    .filter(|i| !before.contains(&i.id))
                    .max_by_key(|i| i.created_at)
                    .ok_or_else(|| AppError::msg("Die neue Instanz wurde nicht gefunden"))?;
                created
            }
            None => {
                task.stage("Lege das Spiel an …", None);
                let loader_version = match (&link.loader.version, kind) {
                    (_, LoaderKind::Vanilla) => None,
                    (Some(v), _) => Some(v.clone()),
                    (None, k) => Some(crate::minecraft::loaders::default_loader_version(&state, k, &link.mc_version).await?),
                };
                state.instances.create(CreateInstance {
                    name: new_instance_name(&link),
                    mc_version: link.mc_version.clone(),
                    loader: Loader { kind, version: loader_version },
                    icon: None,
                    accent: None,
                    group: None,
                })?
            }
        },
    };
    task.set_instance(inst.id.clone());
    task.set_title(format!("Einladung von {}: {}", link.host.name, inst.name));
    crate::events::emit(&state.app, crate::events::INSTANCE_CHANGED, &inst);
    task.check()?;

    // Fehlende Inhalte aus der Liste
    let (_, idx) = local::refresh(&state, &inst.id, crate::content::ContentKind::Mod).await?;
    let missing: Vec<(Source, String, Option<String>)> = missing_mods(&link, &idx)
        .into_iter()
        .filter_map(|m| Some((source_of(&m.source)?, m.project_id.clone(), m.version_id.clone())))
        .collect();
    let mut warnings = vec![];
    let mut manual = 0;
    if !missing.is_empty() {
        let n = missing.len();
        let chunks: Vec<_> = missing.chunks(100).map(|c| c.to_vec()).collect();
        let steps = chunks.len() as f64;
        for (i, roots) in chunks.into_iter().enumerate() {
            task.check()?;
            task.stage(format!("Installiere Inhalte ({}/{n}) …", (i * 100).min(n)), Some(0.1 + 0.8 * i as f64 / steps));
            let idx = ContentIndex::load(&state.paths, &inst.id);
            let planned = install::plan(&state, &inst, &idx, roots, &mut warnings).await?;
            let sub = task.sub(0.1 + 0.8 * i as f64 / steps, 0.1 + 0.8 * (i + 1) as f64 / steps);
            manual += install::apply(&state, &inst, planned, &sub).await?.len();
        }
        if manual > 0 {
            crate::content::missing::watch(&state, &inst.id, crate::content::missing::WATCH_FOR);
        }
    }
    for w in &warnings {
        tracing::warn!("Spiel-Link {}: {w}", link.code);
    }

    // Client-Pack (z. B. Vibey Client) – nicht kritisch
    if let Some(cp) = link.client_pack.as_deref() {
        let installed = crate::client_packs::installed_ids(&state, &inst.id);
        if !installed.iter().any(|x| x == cp) {
            match crate::client_packs::precheck(&state, &inst.id, cp, true) {
                Ok((_, _, others)) => {
                    task.stage(format!("Installiere {} …", crate::client_packs::pretty(cp)), Some(0.92));
                    if let Err(e) = crate::client_packs::install(state.clone(), task.clone(), inst.id.clone(), cp.to_string(), others).await {
                        tracing::warn!("Client-Pack {cp} für Spiel-Link nicht installiert: {e}");
                        warnings.push(format!("{}: {e}", crate::client_packs::pretty(cp)));
                    }
                }
                Err(e) => tracing::info!("Client-Pack {cp} passt nicht zu {}: {e}", inst.id),
            }
        }
    }
    task.set_title(format!("Einladung von {}: {}", link.host.name, inst.name));
    task.message(if manual > 0 { format!("Bereit – {manual} Datei(en) musst du noch selbst herunterladen") } else { "Bereit zum Beitreten".to_string() });
    crate::events::emit(&state.app, crate::events::INSTANCE_CHANGED, &inst);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        let mut l: PlayLink = serde_json::from_value(serde_json::json!({
            "code": "k3x9q2", "url": "u", "host": { "uuid": "u", "name": "Henny" }, "relay_host": "a.axolite.cc",
            "mc_version": "1.21.1", "loader": { "kind": "fabric" }, "world_name": "Neue Welt", "expires_at": "x"
        }))
        .unwrap();
        assert_eq!(new_instance_name(&l), "Neue Welt (Henny)");
        l.world_name = None;
        assert_eq!(new_instance_name(&l), "Welt von Henny");
        l.pack = Some(LinkPack { source: "modrinth".into(), project_id: "a".into(), version_id: "b".into(), title: Some("Cobblemon".into()) });
        assert_eq!(new_instance_name(&l), "Cobblemon");
        assert!(loader_kind("neoforge").is_ok());
        assert!(loader_kind("rift").is_err());
    }
}
