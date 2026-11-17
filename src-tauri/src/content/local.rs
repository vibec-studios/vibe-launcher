//! Installierte Inhalte: Ordner scannen (mit Metadaten-Cache), Hash-Zuordnung zu Modrinth/CurseForge,
//! Aktivieren/Deaktivieren, Entfernen, Hinzufügen.
use super::index::{self, ContentIndex, IndexEntry, LocalMeta, UnknownHash};
use super::{curseforge as cf, modrinth as mr, *};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use futures::StreamExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Erneute Hash-Abfrage für unbekannte Dateien frühestens nach 3 Tagen.
const UNKNOWN_RECHECK_MS: i64 = 3 * 24 * 3600 * 1000;
const IDENTIFY_BACKOFF: Duration = Duration::from_secs(60);

#[derive(Debug, Clone)]
pub struct Scanned {
    pub file_name: String,
    pub key: String,
    pub enabled: bool,
    pub path: PathBuf,
    pub meta: LocalMeta,
    pub modified: i64,
    pub size: u64,
}

struct RawEntry {
    file_name: String,
    path: PathBuf,
    is_dir: bool,
    size: u64,
    mtime: i64,
}

fn accepts(kind: ContentKind, name: &str, is_dir: bool) -> bool {
    if name.starts_with('.') || name.ends_with(".part") || name.ends_with(".tmp") {
        return false;
    }
    let base = index::strip_disabled(name).to_ascii_lowercase();
    match kind {
        ContentKind::Mod => !is_dir && (base.ends_with(".jar") || base.ends_with(".zip") || base.ends_with(".litemod")),
        _ => is_dir || base.ends_with(".zip"),
    }
}

fn mtime_ms(m: &std::fs::Metadata) -> i64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn dir_size(p: &Path) -> u64 {
    walkdir::WalkDir::new(p).into_iter().flatten().filter(|e| e.file_type().is_file()).filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum()
}

fn list_raw(dir: &Path, kind: ContentKind) -> Vec<RawEntry> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut out = Vec::new();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Ok(m) = e.metadata() else { continue };
        if !accepts(kind, &name, m.is_dir()) {
            continue;
        }
        out.push(RawEntry { file_name: name, path: e.path(), is_dir: m.is_dir(), size: if m.is_dir() { 0 } else { m.len() }, mtime: mtime_ms(&m) });
    }
    out
}

fn meta_valid(m: &LocalMeta, r: &RawEntry) -> bool {
    m.meta_version == super::index::META_VERSION && m.is_dir == r.is_dir && m.mtime == r.mtime && (r.is_dir || m.size == r.size)
}

pub fn icons_dir(state: &AppState) -> PathBuf {
    state.paths.cache().join("icons")
}

/// Ordner einer Art scannen; Metadaten werden bei Bedarf (parallel) gelesen und im Index gecacht.
pub async fn scan(state: &AppState, instance_id: &str, kind: ContentKind) -> AppResult<(Vec<Scanned>, ContentIndex)> {
    state.instances.get(instance_id)?;
    let dir = state.paths.game_dir(instance_id).join(kind.folder());
    let paths = state.paths.clone();
    let id = instance_id.to_string();
    let (raw, idx) = tokio::task::spawn_blocking(move || (list_raw(&dir, kind), ContentIndex::load(&paths, &id))).await?;

    let folder = kind.folder();
    let todo: Vec<(String, PathBuf, bool, u64, i64)> = raw
        .iter()
        .filter(|r| idx.local.get(&index::key(folder, &r.file_name)).map_or(true, |m| !meta_valid(m, r)))
        .map(|r| (index::key(folder, &r.file_name), r.path.clone(), r.is_dir, r.size, r.mtime))
        .collect();

    let icons = icons_dir(state);
    let computed: Vec<(String, LocalMeta)> = futures::stream::iter(todo.into_iter().map(|(key, path, is_dir, size, mtime)| {
        let icons = icons.clone();
        async move {
            let m = tokio::task::spawn_blocking(move || {
                let mut m = super::meta::read_entry(&path, kind, &icons);
                m.mtime = mtime;
                m.size = if is_dir { dir_size(&path) } else { size };
                m
            })
            .await
            .unwrap_or_default();
            (key, m)
        }
    }))
    .buffer_unordered(std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 12))
    .collect()
    .await;

    // Aufräumen: verschwundene Dateien, ersetzte Dateien (SHA-1 passt nicht mehr zum Index)
    let present: HashSet<String> = raw.iter().map(|r| index::key(folder, &r.file_name)).collect();
    let prefix = format!("{folder}/");
    let mut probe = idx.clone();
    for (k, m) in &computed {
        probe.local.insert(k.clone(), m.clone());
    }
    let stale_local: Vec<String> = probe.local.keys().filter(|k| k.starts_with(&prefix) && !present.contains(*k)).cloned().collect();
    let stale_files: Vec<String> = probe
        .files
        .iter()
        .filter(|(k, e)| {
            k.starts_with(&prefix)
                && (!present.contains(*k)
                    || match (&e.sha1, probe.local.get(*k).and_then(|m| m.sha1.as_ref())) {
                        (Some(a), Some(b)) => !a.eq_ignore_ascii_case(b),
                        _ => false,
                    })
        })
        .map(|(k, _)| k.clone())
        .collect();

    let idx = if computed.is_empty() && stale_local.is_empty() && stale_files.is_empty() {
        idx
    } else {
        let lock = state.content.lock(instance_id);
        let _g = lock.lock().await;
        let mut idx = ContentIndex::load(&state.paths, instance_id);
        for (k, m) in computed {
            idx.local.insert(k, m);
        }
        for k in &stale_local {
            idx.local.remove(k);
        }
        for k in &stale_files {
            idx.files.remove(k);
        }
        idx.save(&state.paths, instance_id)?;
        idx
    };

    let mut out: Vec<Scanned> = raw
        .into_iter()
        .map(|r| {
            let key = index::key(folder, &r.file_name);
            let meta = idx.local.get(&key).cloned().unwrap_or_default();
            Scanned {
                enabled: !r.file_name.ends_with(".disabled"),
                size: if r.is_dir { meta.size } else { r.size },
                modified: r.mtime,
                file_name: r.file_name,
                key,
                path: r.path,
                meta,
            }
        })
        .collect();
    out.sort_by_key(|s| s.file_name.to_lowercase());
    Ok((out, idx))
}

fn display_stem(file_name: &str) -> String {
    let base = index::strip_disabled(file_name);
    for ext in [".jar", ".zip", ".litemod"] {
        if base.to_ascii_lowercase().ends_with(ext) {
            return base[..base.len() - ext.len()].to_string();
        }
    }
    base.to_string()
}

pub fn to_item(s: &Scanned, idx: &ContentIndex, kind: ContentKind, icons: &Path) -> ContentItem {
    let entry = idx.files.get(&s.key);
    let icon = entry
        .and_then(|e| e.icon_url.clone())
        .or_else(|| s.meta.icon.as_deref().and_then(|i| super::meta::icon_data_url(icons, i)));
    ContentItem {
        file_name: s.file_name.clone(),
        kind,
        enabled: s.enabled,
        name: s.meta.name.clone().or_else(|| entry.and_then(|e| e.title.clone())).unwrap_or_else(|| display_stem(&s.file_name)),
        version: s.meta.version.clone().filter(|v| !v.starts_with("${")).or_else(|| entry.and_then(|e| e.version_number.clone())),
        description: s.meta.description.clone(),
        authors: s.meta.authors.clone(),
        icon,
        source: entry.map(|e| e.source),
        project_id: entry.map(|e| e.project_id.clone()),
        version_id: entry.map(|e| e.version_id.clone()),
        size: s.size,
        modified: s.modified,
        side: super::sides::item_side(kind, entry, &s.meta),
        pinned: idx.pinned.contains(&s.key),
    }
}

pub async fn items(state: &AppState, scanned: &[Scanned], idx: &ContentIndex, kind: ContentKind) -> AppResult<Vec<ContentItem>> {
    let icons = icons_dir(state);
    let scanned = scanned.to_vec();
    let idx = idx.clone();
    let mut v = tokio::task::spawn_blocking(move || scanned.iter().map(|s| to_item(s, &idx, kind, &icons)).collect::<Vec<_>>()).await?;
    v.sort_by_key(|i| i.name.to_lowercase());
    Ok(v)
}

// ------------------------------------------------------------------ Hash-Zuordnung

#[derive(Debug, Clone)]
pub struct Pending {
    pub key: String,
    pub sha1: String,
    pub sha256: Option<String>,
    pub murmur: Option<u32>,
}

/// Dateien ohne bekannte Herkunft, die (noch) nicht als unbekannt markiert sind, und Index-Einträge ohne Titel.
pub fn pending(scanned: &[Scanned], idx: &ContentIndex, cf_available: bool) -> (Vec<Pending>, Vec<String>) {
    let now = crate::util::now_ms();
    let mut p = Vec::new();
    let mut enrich = Vec::new();
    for s in scanned {
        if let Some(e) = idx.files.get(&s.key) {
            if e.title.is_none() || (e.source == Source::Modrinth && e.side.is_none()) {
                enrich.push(s.key.clone());
            }
            continue;
        }
        let Some(sha1) = &s.meta.sha1 else { continue };
        let need = match idx.unknown.get(sha1) {
            None => true,
            Some(u) => now - u.checked_at > UNKNOWN_RECHECK_MS || (cf_available && !u.curseforge && s.meta.murmur2.is_some()),
        };
        if need {
            p.push(Pending { key: s.key.clone(), sha1: sha1.clone(), sha256: s.meta.sha256.clone(), murmur: s.meta.murmur2 });
        }
    }
    (p, enrich)
}

fn entry_from_mr(v: &mr::MrVersion, sha1: &str, project: Option<&mr::MrProject>) -> IndexEntry {
    let file = v.files.iter().find(|f| f.hashes.sha1.as_deref().is_some_and(|h| h.eq_ignore_ascii_case(sha1)));
    IndexEntry {
        source: Source::Modrinth,
        project_id: v.project_id.clone(),
        version_id: v.id.clone(),
        sha1: Some(sha1.to_ascii_lowercase()),
        sha512: file.and_then(|f| f.hashes.sha512.clone()),
        title: project.map(|p| p.title.clone()),
        icon_url: project.and_then(|p| p.icon_url.clone()).filter(|u| !u.is_empty()),
        version_number: Some(v.version_number.clone()),
        url: file.map(|f| f.url.clone()),
        size: file.map(|f| f.size),
        date: Some(v.date_published.clone()),
        release_type: Some(v.version_type.clone()),
        side: project.map(|p| super::sides::from_sides(p.client_side.as_deref(), p.server_side.as_deref())),
    }
}

fn entry_from_cf(f: &cf::CfFile, sha1: Option<String>, m: Option<&cf::CfMod>) -> IndexEntry {
    let v = cf::convert_file(f);
    IndexEntry {
        source: Source::Curseforge,
        project_id: f.mod_id.to_string(),
        version_id: f.id.to_string(),
        sha1: sha1.or_else(|| f.sha1()),
        sha512: None,
        title: m.map(|m| m.name.clone()),
        icon_url: m.and_then(|m| cf::mod_to_hit(m).icon_url),
        version_number: Some(v.version_number),
        url: f.download_url.clone(),
        size: Some(f.file_length),
        date: Some(f.file_date.clone()),
        release_type: Some(v.release_type),
        side: super::sides::from_cf_versions(&f.game_versions),
    }
}

/// Unbekannte Dateien per Hash zuordnen (Modrinth sha1, CurseForge Murmur2) und fehlende Titel nachladen.
/// Gibt zurück, ob sich der Index geändert hat.
pub async fn identify(state: &AppState, instance_id: &str, pending: Vec<Pending>, enrich: Vec<String>) -> AppResult<bool> {
    if pending.is_empty() && enrich.is_empty() {
        return Ok(false);
    }
    let mut found: HashMap<String, IndexEntry> = HashMap::new();
    let mut cf_checked = false;

    if !pending.is_empty() {
        // Modrinth
        let sha1s: Vec<String> = pending.iter().map(|p| p.sha1.clone()).collect();
        let by_hash = mr::versions_by_hash(state, &sha1s).await?;
        let pids: Vec<String> = by_hash.values().map(|v| v.project_id.clone()).collect::<HashSet<_>>().into_iter().collect();
        let projects: HashMap<String, mr::MrProject> = if pids.is_empty() {
            HashMap::new()
        } else {
            mr::raw_projects(state, &pids).await.unwrap_or_default().into_iter().map(|p| (p.id.clone(), p)).collect()
        };
        for p in &pending {
            if let Some(v) = by_hash.get(&p.sha1.to_ascii_lowercase()) {
                found.insert(p.key.clone(), entry_from_mr(v, &p.sha1, projects.get(&v.project_id)));
            }
        }
        // CurseForge (nur Rest)
        let rest: Vec<&Pending> = pending.iter().filter(|p| !found.contains_key(&p.key) && p.murmur.is_some()).collect();
        if !rest.is_empty() && cf::available(state) {
            let fps: Vec<u32> = rest.iter().filter_map(|p| p.murmur).collect();
            match cf::fingerprints(state, &fps).await {
                Ok(matches) => {
                    cf_checked = true;
                    let mod_ids: Vec<u64> = matches.iter().map(|m| m.file.mod_id).collect::<HashSet<_>>().into_iter().collect();
                    let mods: HashMap<u64, cf::CfMod> =
                        if mod_ids.is_empty() { HashMap::new() } else { cf::raw_mods(state, &mod_ids).await.unwrap_or_default().into_iter().map(|m| (m.id, m)).collect() };
                    for p in rest {
                        if let Some(m) = matches.iter().find(|m| Some(m.file.file_fingerprint as u32) == p.murmur && m.file.file_fingerprint <= u32::MAX as u64) {
                            found.insert(p.key.clone(), entry_from_cf(&m.file, Some(p.sha1.clone()), mods.get(&m.file.mod_id)));
                        }
                    }
                }
                Err(e) => tracing::warn!("CurseForge-Fingerprint-Abfrage fehlgeschlagen: {e}"),
            }
        }
        // Eigene Stores (sha1/sha256)
        let rest: Vec<(String, Option<String>)> = pending.iter().filter(|p| !found.contains_key(&p.key)).map(|p| (p.sha1.clone(), p.sha256.clone())).collect();
        if !rest.is_empty() {
            let hits = super::store::by_hash(state, &rest).await;
            for p in &pending {
                if let Some(h) = hits.get(&p.sha1) {
                    found.insert(
                        p.key.clone(),
                        IndexEntry {
                            source: Source::Store(h.key),
                            project_id: h.version.project_id.clone(),
                            version_id: h.version.id.clone(),
                            sha1: Some(p.sha1.to_ascii_lowercase()),
                            sha512: None,
                            title: Some(h.title.clone()),
                            icon_url: h.icon.clone(),
                            version_number: Some(h.version.version_number.clone()),
                            url: Some(h.url.clone()),
                            size: Some(h.size),
                            date: Some(h.version.date.clone()),
                            release_type: Some(h.version.release_type.clone()),
                            side: h.side,
                        },
                    );
                }
            }
        }
    }

    // Titel/Icons für bekannte Einträge ohne Titel nachladen
    let idx_now = ContentIndex::load(&state.paths, instance_id);
    let mut enriched: HashMap<String, (String, Option<String>, Option<Side>)> = HashMap::new();
    let mr_ids: Vec<String> = enrich
        .iter()
        .filter_map(|k| idx_now.files.get(k))
        .filter(|e| e.source == Source::Modrinth)
        .map(|e| e.project_id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if !mr_ids.is_empty() {
        for p in mr::raw_projects(state, &mr_ids).await.unwrap_or_default() {
            let side = super::sides::from_sides(p.client_side.as_deref(), p.server_side.as_deref());
            enriched.insert(format!("mr:{}", p.id), (p.title.clone(), p.icon_url.clone().filter(|u| !u.is_empty()), Some(side)));
        }
    }
    let cf_ids: Vec<u64> = enrich
        .iter()
        .filter_map(|k| idx_now.files.get(k))
        .filter(|e| e.source == Source::Curseforge)
        .filter_map(|e| e.project_id.parse().ok())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if !cf_ids.is_empty() && cf::available(state) {
        for m in cf::raw_mods(state, &cf_ids).await.unwrap_or_default() {
            enriched.insert(format!("cf:{}", m.id), (m.name.clone(), cf::mod_to_hit(&m).icon_url, None));
        }
    }

    let lock = state.content.lock(instance_id);
    let _g = lock.lock().await;
    let mut idx = ContentIndex::load(&state.paths, instance_id);
    let mut changed = false;
    let now = crate::util::now_ms();
    for p in &pending {
        // Datei inzwischen geändert/entfernt?
        if idx.local.get(&p.key).and_then(|m| m.sha1.as_ref()) != Some(&p.sha1) {
            continue;
        }
        if let Some(e) = found.remove(&p.key) {
            idx.files.insert(p.key.clone(), e);
            idx.unknown.remove(&p.sha1);
        } else {
            idx.unknown.insert(p.sha1.clone(), UnknownHash { modrinth: true, curseforge: cf_checked, checked_at: now });
        }
        changed = true;
    }
    for k in &enrich {
        if let Some(e) = idx.files.get_mut(k) {
            let tag = match e.source {
                Source::Modrinth => format!("mr:{}", e.project_id),
                Source::Curseforge => format!("cf:{}", e.project_id),
                Source::Store(_) => continue,
            };
            if let Some((title, icon, side)) = enriched.get(&tag) {
                e.title = Some(title.clone());
                if e.side.is_none() {
                    e.side = *side;
                }
                if e.icon_url.is_none() {
                    e.icon_url = icon.clone();
                }
                changed = true;
            }
        }
    }
    if changed {
        idx.save(&state.paths, instance_id)?;
    }
    Ok(changed)
}

/// Zuordnung im Hintergrund starten (höchstens eine je Instanz, Pause nach Netzwerkfehlern).
pub fn identify_in_background(state: &AppState, instance_id: &str, pending: Vec<Pending>, enrich: Vec<String>) {
    if pending.is_empty() && enrich.is_empty() {
        return;
    }
    if let Some(t) = state.content.identify_backoff.lock().get(instance_id) {
        if t.elapsed() < IDENTIFY_BACKOFF {
            return;
        }
    }
    if !state.content.identifying.lock().insert(instance_id.to_string()) {
        return;
    }
    let state = state.clone();
    let id = instance_id.to_string();
    tauri::async_runtime::spawn(async move {
        let res = identify(&state, &id, pending, enrich).await;
        state.content.identifying.lock().remove(&id);
        match res {
            Ok(true) => state.content.emit_changed(&id),
            Ok(false) => {}
            Err(e) => {
                tracing::warn!("Hash-Zuordnung für {id} fehlgeschlagen: {e}");
                state.content.identify_backoff.lock().insert(id, std::time::Instant::now());
            }
        }
    });
}

/// Liste für das Frontend (Zuordnung unbekannter Dateien läuft im Hintergrund weiter).
pub async fn list(state: &AppState, instance_id: &str, kind: ContentKind) -> AppResult<Vec<ContentItem>> {
    let (scanned, idx) = scan(state, instance_id, kind).await?;
    let (p, e) = pending(&scanned, &idx, cf::available(state));
    identify_in_background(state, instance_id, p, e);
    items(state, &scanned, &idx, kind).await
}

/// Scannen + Zuordnung abwarten (vor Installationen/Updates/Exporten, damit der Index aktuell ist).
pub async fn refresh(state: &AppState, instance_id: &str, kind: ContentKind) -> AppResult<(Vec<Scanned>, ContentIndex)> {
    let (scanned, idx) = scan(state, instance_id, kind).await?;
    let (p, e) = pending(&scanned, &idx, cf::available(state));
    if p.is_empty() && e.is_empty() {
        return Ok((scanned, idx));
    }
    match identify(state, instance_id, p, e).await {
        Ok(_) => {}
        Err(err) => tracing::warn!("Hash-Zuordnung fehlgeschlagen: {err}"),
    }
    let idx = ContentIndex::load(&state.paths, instance_id);
    Ok((scanned, idx))
}

fn check_file_name(name: &str) -> AppResult<()> {
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." || name.contains(':') {
        return Err(AppError::Invalid(format!("Ungültiger Dateiname: {name}")));
    }
    Ok(())
}

pub async fn set_enabled(state: &AppState, instance_id: &str, kind: ContentKind, file_name: &str, enabled: bool) -> AppResult<ContentItem> {
    check_file_name(file_name)?;
    let dir = state.paths.game_dir(instance_id).join(kind.folder());
    let src = dir.join(file_name);
    if !src.exists() {
        return Err(AppError::NotFound(format!("Datei {file_name}")));
    }
    let base = index::strip_disabled(file_name).to_string();
    let new_name = if enabled { base.clone() } else { format!("{base}.disabled") };
    if new_name != file_name {
        let dst = dir.join(&new_name);
        if dst.exists() {
            return Err(AppError::Invalid(format!("{new_name} existiert bereits")));
        }
        tokio::fs::rename(&src, &dst).await?;
    }
    let (scanned, idx) = scan(state, instance_id, kind).await?;
    state.content.emit_changed(instance_id);
    let s = scanned.iter().find(|s| s.file_name == new_name).ok_or_else(|| AppError::NotFound(new_name.clone()))?;
    Ok(to_item(s, &idx, kind, &icons_dir(state)))
}

pub async fn remove(state: &AppState, instance_id: &str, kind: ContentKind, file_names: &[String]) -> AppResult<()> {
    state.instances.get(instance_id)?;
    let dir = state.paths.game_dir(instance_id).join(kind.folder());
    for n in file_names {
        check_file_name(n)?;
        let p = dir.join(n);
        if p.is_dir() {
            tokio::fs::remove_dir_all(&p).await?;
        } else if p.exists() {
            tokio::fs::remove_file(&p).await?;
        }
    }
    {
        let lock = state.content.lock(instance_id);
        let _g = lock.lock().await;
        let mut idx = ContentIndex::load(&state.paths, instance_id);
        for n in file_names {
            let k = index::key(kind.folder(), n);
            // Nur entfernen, wenn keine aktivierte/deaktivierte Variante mehr existiert
            let base = index::strip_disabled(n);
            if !dir.join(base).exists() && !dir.join(format!("{base}.disabled")).exists() {
                idx.files.remove(&k);
                idx.local.remove(&k);
            }
        }
        idx.save(&state.paths, instance_id)?;
    }
    state.content.emit_changed(instance_id);
    Ok(())
}

pub async fn add_files(state: &AppState, instance_id: &str, kind: ContentKind, paths: &[String]) -> AppResult<Vec<ContentItem>> {
    state.instances.get(instance_id)?;
    let dir = state.paths.game_dir(instance_id).join(kind.folder());
    let mut added: Vec<String> = Vec::new();
    for p in paths {
        let src = PathBuf::from(p);
        let name = src.file_name().map(|n| n.to_string_lossy().to_string()).ok_or_else(|| AppError::Invalid(format!("Ungültiger Pfad: {p}")))?;
        let is_dir = src.is_dir();
        if !src.exists() {
            return Err(AppError::NotFound(p.clone()));
        }
        if !accepts(kind, &name, is_dir) {
            let hint = match kind {
                ContentKind::Mod => "Mods müssen .jar-Dateien sein",
                _ => "Erwartet wird eine .zip-Datei oder ein Ordner",
            };
            return Err(AppError::Invalid(format!("{name}: {hint}")));
        }
        let dst = dir.join(&name);
        if dst == src {
            added.push(name);
            continue;
        }
        let dir2 = dir.clone();
        tokio::task::spawn_blocking(move || -> std::io::Result<()> {
            std::fs::create_dir_all(&dir2)?;
            if is_dir {
                if dst.exists() {
                    std::fs::remove_dir_all(&dst)?;
                }
                crate::util::copy_dir_all(&src, &dst)
            } else {
                let tmp = dst.with_extension("part");
                std::fs::copy(&src, &tmp)?;
                std::fs::rename(&tmp, &dst)
            }
        })
        .await??;
        added.push(name);
    }
    let (scanned, idx) = refresh(state, instance_id, kind).await?;
    state.content.emit_changed(instance_id);
    let icons = icons_dir(state);
    Ok(scanned.iter().filter(|s| added.contains(&s.file_name)).map(|s| to_item(s, &idx, kind, &icons)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accept_rules() {
        assert!(accepts(ContentKind::Mod, "a.jar", false));
        assert!(accepts(ContentKind::Mod, "a.jar.disabled", false));
        assert!(!accepts(ContentKind::Mod, "a.jar.part", false));
        assert!(!accepts(ContentKind::Mod, "notes.txt", false));
        assert!(!accepts(ContentKind::Mod, "folder", true));
        assert!(accepts(ContentKind::Resourcepack, "Pack", true));
        assert!(accepts(ContentKind::Shader, "BSL.zip", false));
        assert!(!accepts(ContentKind::Shader, "BSL.zip.txt", false));
        assert_eq!(display_stem("sodium-0.5.jar.disabled"), "sodium-0.5");
    }
}
