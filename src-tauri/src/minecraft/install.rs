//! Installation einer Instanz: Vanilla (Versions-JSON, Client, Libraries, Natives, Assets, Logging),
//! Java, Mod-Loader. Bereits vorhandene Dateien werden schnell übersprungen.
use super::meta::{self, Env, Resolved};
use super::JavaInstall;
use crate::error::{AppError, AppResult, Ctx};
use crate::instance::{InstallState, LoaderKind};
use crate::net::DownloadItem;
use crate::state::AppState;
use crate::tasks::SubProgress;
use futures::StreamExt;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Ergebnis der Installation – alles, was der Start braucht.
#[derive(Debug, Clone)]
pub struct Prepared {
    pub resolved: Resolved,
    pub java: JavaInstall,
    /// Wert für `${game_assets}`
    pub game_assets: PathBuf,
    /// Client-JAR für den Klassenpfad
    pub client_jar: PathBuf,
    /// Pfad zur Log4j-Konfiguration (falls vorhanden)
    pub log_config: Option<PathBuf>,
    pub natives_dir: PathBuf,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct AssetIndex {
    objects: HashMap<String, AssetObject>,
    map_to_resources: bool,
    #[serde(rename = "virtual")]
    is_virtual: bool,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct AssetObject {
    hash: String,
    size: u64,
}

/// Bei `force`: vorhandene Dateien mit falschem Hash löschen, damit sie neu geladen werden.
async fn verify_hashes(items: &[DownloadItem]) {
    let todo: Vec<DownloadItem> = items.iter().filter(|i| i.sha1.is_some() && i.path.is_file()).cloned().collect();
    let checks = futures::stream::iter(todo.into_iter().map(|i| async move {
        let p = i.path.clone();
        let h = tokio::task::spawn_blocking(move || crate::net::sha1_file(&p)).await.ok().and_then(|r| r.ok());
        let ok = h.is_some_and(|h| i.sha1.as_deref().is_some_and(|e| e.eq_ignore_ascii_case(&h)));
        if !ok {
            tracing::info!("Beschädigte Datei wird neu geladen: {}", i.path.display());
            let _ = tokio::fs::remove_file(&i.path).await;
        }
    }))
    .buffer_unordered(16)
    .collect::<Vec<_>>();
    checks.await;
}

async fn download(state: &AppState, items: Vec<DownloadItem>, force: bool, sp: &SubProgress) -> AppResult<()> {
    if force {
        verify_hashes(&items).await;
    }
    state.net.download_all(items, Some(sp)).await
}

/// Libraries + Natives eines aufgelösten Profils als Download-Liste.
fn library_items(r: &Resolved, libs_dir: &Path, env: &Env) -> Vec<DownloadItem> {
    let mut items = Vec::new();
    for l in &r.libraries {
        if let Some(a) = l.artifact(libs_dir) {
            if let Some(d) = a.download_item() {
                items.push(d);
            }
        }
        if let Some(n) = l.native_artifact(libs_dir, env) {
            if let Some(d) = n.download_item() {
                items.push(d);
            }
        }
    }
    items
}

/// Vanilla-Dateien: Client-JAR, Libraries, Logging-Config, Asset-Index + Objekte.
async fn install_vanilla_files(state: &AppState, r: &Resolved, game_dir: &Path, force: bool, sp: &SubProgress) -> AppResult<(PathBuf, Option<PathBuf>)> {
    let env = Env::current();
    let paths = &state.paths;
    let mut items = library_items(r, &paths.libraries(), &env);
    if let Some(c) = &r.client {
        items.push(DownloadItem::new(&c.url, paths.version_jar(&r.base_id)).sha1(c.sha1.clone()).size(c.size));
    }
    let mut log_config = None;
    if let Some(l) = &r.logging {
        let p = paths.assets().join("log_configs").join(crate::paths::sanitize_file_name(&l.file.id));
        items.push(DownloadItem::new(&l.file.url, &p).sha1(l.file.sha1.clone()).size(l.file.size));
        log_config = Some(p);
    }
    let index_path = r.asset_index.as_ref().map(|a| paths.assets().join("indexes").join(format!("{}.json", crate::paths::sanitize_file_name(&a.id))));
    if let (Some(a), Some(p)) = (&r.asset_index, &index_path) {
        items.push(DownloadItem::new(&a.url, p).sha1(a.sha1.clone()).size(a.size));
    }
    sp.message("Spieldateien werden geladen …");
    download(state, items, force, &sp.sub(0.0, 0.35)).await?;
    sp.check()?;

    // Assets
    let mut game_assets = paths.assets();
    if let (Some(a), Some(p)) = (&r.asset_index, &index_path) {
        let bytes = tokio::fs::read(p).await?;
        let idx: AssetIndex = serde_json::from_slice(&bytes).ctx("Asset-Index ungültig")?;
        let objects = paths.assets().join("objects");
        let mut items = Vec::with_capacity(idx.objects.len());
        for o in idx.objects.values() {
            if o.hash.len() < 2 {
                continue;
            }
            let pre = &o.hash[..2];
            items.push(
                DownloadItem::new(format!("{}{pre}/{}", meta::RESOURCES_URL, o.hash), objects.join(pre).join(&o.hash))
                    .sha1(Some(o.hash.clone()))
                    .size(Some(o.size)),
            );
        }
        sp.message("Assets werden geladen …");
        download(state, items, force, &sp.sub(0.35, 0.95)).await?;
        sp.check()?;
        if idx.is_virtual || idx.map_to_resources {
            let target = if idx.map_to_resources { game_dir.join("resources") } else { paths.assets().join("virtual").join(&a.id) };
            let objs = objects.clone();
            let t2 = target.clone();
            let entries: Vec<(String, String, u64)> = idx.objects.iter().map(|(k, v)| (k.clone(), v.hash.clone(), v.size)).collect();
            tokio::task::spawn_blocking(move || -> AppResult<()> {
                for (name, hash, size) in entries {
                    let Some(out) = crate::util::safe_join(&t2, &name) else { continue };
                    if out.metadata().map(|m| m.len() == size).unwrap_or(false) {
                        continue;
                    }
                    if let Some(p) = out.parent() {
                        std::fs::create_dir_all(p)?;
                    }
                    if hash.len() >= 2 {
                        std::fs::copy(objs.join(&hash[..2]).join(&hash), &out)?;
                    }
                }
                Ok(())
            })
            .await??;
            game_assets = target;
        }
    }
    sp.progress(1.0);
    Ok((game_assets, log_config))
}

/// Alte Natives (`natives`-Klassifizierer) entpacken.
fn extract_natives(r: &Resolved, libs_dir: &Path, dir: &Path, force: bool) -> AppResult<()> {
    let env = Env::current();
    let mut list = Vec::new();
    for l in &r.libraries {
        if let Some(n) = l.native_artifact(libs_dir, &env) {
            let excl = l.extract.as_ref().map(|e| e.exclude.clone()).unwrap_or_default();
            list.push((n.path, excl));
        }
    }
    std::fs::create_dir_all(dir)?;
    let sig: String = list
        .iter()
        .map(|(p, _)| format!("{}:{}", p.display(), p.metadata().map(|m| m.len()).unwrap_or(0)))
        .collect::<Vec<_>>()
        .join("\n");
    let marker = dir.join(".vibe-natives");
    if !force && std::fs::read_to_string(&marker).ok().as_deref() == Some(sig.as_str()) {
        return Ok(());
    }
    for (jar, exclude) in &list {
        let f = std::fs::File::open(jar).map_err(|e| AppError::msg(format!("Natives fehlen ({}): {e}", jar.display())))?;
        let mut z = zip::ZipArchive::new(f)?;
        for i in 0..z.len() {
            let mut e = z.by_index(i)?;
            let name = e.name().to_string();
            if e.is_dir() || name.starts_with("META-INF/") || exclude.iter().any(|x| name.starts_with(x.as_str())) {
                continue;
            }
            let Some(out) = crate::util::safe_join(dir, &name) else { continue };
            if out.metadata().map(|m| m.len() == e.size()).unwrap_or(false) {
                continue;
            }
            if let Some(p) = out.parent() {
                std::fs::create_dir_all(p)?;
            }
            let res = std::fs::File::create(&out).and_then(|mut w| std::io::copy(&mut e, &mut w).map(|_| ()));
            if let Err(err) = res {
                // Datei evtl. von laufendem Spiel gesperrt – vorhandene Datei behalten
                if !out.exists() {
                    return Err(err.into());
                }
                tracing::warn!("Native {} nicht überschreibbar: {err}", out.display());
            }
        }
    }
    std::fs::write(&marker, sig)?;
    Ok(())
}

/// Client-JAR unter dem Namen der Profil-Version bereitstellen (Forge 1.17+ erwartet `${version_name}.jar`).
fn link_client_jar(paths: &crate::paths::Paths, r: &Resolved) -> AppResult<PathBuf> {
    if let Some(j) = &r.jar {
        let p = paths.version_jar(j);
        if p.is_file() {
            return Ok(p);
        }
    }
    let base = paths.version_jar(&r.base_id);
    if r.id == r.base_id {
        return Ok(base);
    }
    let target = paths.version_jar(&r.id);
    let base_len = base.metadata().map(|m| m.len()).map_err(|_| AppError::msg("Minecraft-JAR fehlt"))?;
    if target.metadata().map(|m| m.len() == base_len).unwrap_or(false) {
        return Ok(target);
    }
    if let Some(p) = target.parent() {
        std::fs::create_dir_all(p)?;
    }
    let _ = std::fs::remove_file(&target);
    if std::fs::hard_link(&base, &target).is_err() {
        std::fs::copy(&base, &target)?;
    }
    Ok(target)
}

async fn do_install(state: &AppState, id: &str, sp: &SubProgress, force: bool) -> AppResult<Prepared> {
    let inst = state.instances.get(id)?;
    let mc = inst.mc_version.trim().to_string();
    let game_dir = state.paths.game_dir(id);
    tokio::fs::create_dir_all(&game_dir).await?;

    // 1. Vanilla-JSON
    sp.message(format!("Minecraft {mc} wird vorbereitet …"));
    sp.progress(0.0);
    meta::ensure_vanilla_json(state, &mc, force).await?;
    let env = Env::current();
    let vanilla_chain = meta::load_chain(&state.paths, &mc)?;
    let vanilla = meta::merge(&vanilla_chain, &env);
    sp.check()?;

    // 2. Java
    sp.message("Java wird geprüft …");
    let major = meta::required_java(&vanilla);
    let component = vanilla.java.as_ref().and_then(|j| j.component.clone());
    let java = super::java::resolve(state, &inst, major, component.as_deref(), force, &sp.sub(0.02, 0.15)).await?;
    sp.check()?;

    // 3. Vanilla-Dateien
    let (game_assets, log_config) = install_vanilla_files(state, &vanilla, &game_dir, force, &sp.sub(0.15, 0.75)).await?;

    // 4. Loader
    let loader_sp = sp.sub(0.75, 0.97);
    let version_id = match inst.loader.kind {
        LoaderKind::Vanilla => mc.clone(),
        kind => {
            let lv = inst.loader.version.clone().filter(|v| !v.trim().is_empty()).ctx("Loader-Version fehlt")?;
            sp.message(format!("{} {lv} wird installiert …", super::loaders::loader_name(kind)));
            match kind {
                LoaderKind::Fabric | LoaderKind::Quilt => super::loaders::install_fabric_like(state, kind, &mc, &lv, force).await?,
                _ => {
                    let spec = super::forge::ForgeSpec { neoforge: kind == LoaderKind::Neoforge, mc: &mc, version: &lv };
                    super::forge::install(state, spec, Path::new(&java.path), force, &loader_sp).await?
                }
            }
        }
    };
    sp.check()?;
    let resolved = if version_id == mc {
        vanilla
    } else {
        let chain = meta::load_chain(&state.paths, &version_id)?;
        let r = meta::merge(&chain, &env);
        if r.base_id != mc {
            return Err(AppError::msg(format!("Loader-Profil {version_id} passt nicht zu Minecraft {mc}.")));
        }
        sp.message("Loader-Bibliotheken werden geladen …");
        download(state, library_items(&r, &state.paths.libraries(), &env), force, &loader_sp).await?;
        r
    };
    sp.check()?;

    // 5. Natives + Client-JAR
    sp.message("Abschluss …");
    let natives_dir = state.paths.natives_dir(&resolved.id);
    let r2 = resolved.clone();
    let libs = state.paths.libraries();
    let nd = natives_dir.clone();
    let paths = state.paths.clone();
    let client_jar = tokio::task::spawn_blocking(move || -> AppResult<PathBuf> {
        extract_natives(&r2, &libs, &nd, force)?;
        link_client_jar(&paths, &r2)
    })
    .await??;
    sp.progress(1.0);
    Ok(Prepared { resolved, java, game_assets, client_jar, log_config, natives_dir })
}

/// Installation mit Status-Verwaltung der Instanz. `force` prüft alle Dateien per Hash.
pub async fn install_instance_opts(state: &AppState, id: &str, sp: &SubProgress, force: bool) -> AppResult<Prepared> {
    let inst = state.instances.get(id)?;
    // Loader-Version festlegen, falls offen (vor dem Statuswechsel: Loader-Änderung setzt den Status zurück)
    if inst.loader.kind != LoaderKind::Vanilla && inst.loader.version.as_deref().is_none_or_empty() {
        sp.message("Loader-Version wird bestimmt …");
        let v = super::loaders::default_loader_version(state, inst.loader.kind, &inst.mc_version).await?;
        state.instances.modify(id, |i| i.loader.version = Some(v))?;
    }
    let lock = match state.game.install_lock.try_lock() {
        Ok(g) => g,
        Err(_) => {
            sp.message("Warte auf eine andere Installation …");
            let cancel = sp.task.cancel_token();
            tokio::select! {
                g = state.game.install_lock.lock() => g,
                _ = cancel.cancelled() => return Err(AppError::Cancelled),
            }
        }
    };
    let before = state.instances.get(id)?.install_state;
    state.instances.modify(id, |i| i.install_state = InstallState::Installing)?;
    let res = do_install(state, id, sp, force).await;
    drop(lock);
    match &res {
        Ok(p) => {
            let vid = p.resolved.id.clone();
            state.instances.modify(id, |i| {
                i.install_state = InstallState::Installed;
                i.version_id = Some(vid);
            })?;
        }
        Err(AppError::Cancelled) => {
            let restore = if before == InstallState::Installing { InstallState::NotInstalled } else { before };
            let _ = state.instances.modify(id, |i| i.install_state = restore);
        }
        Err(e) => {
            tracing::error!("Installation von {id} fehlgeschlagen: {e}");
            let _ = state.instances.modify(id, |i| i.install_state = InstallState::Failed);
        }
    }
    res
}

trait OptStrExt {
    fn is_none_or_empty(&self) -> bool;
}
impl OptStrExt for Option<&str> {
    fn is_none_or_empty(&self) -> bool {
        self.map(|s| s.trim().is_empty()).unwrap_or(true)
    }
}
