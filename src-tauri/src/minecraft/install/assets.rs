use super::*;

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
pub(super) struct AssetIndex {
    pub(super) objects: HashMap<String, AssetObject>,
    pub(super) map_to_resources: bool,
    #[serde(rename = "virtual")]
    pub(super) is_virtual: bool,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
pub(super) struct AssetObject {
    pub(super) hash: String,
    pub(super) size: u64,
}

/// Bei `force`: vorhandene Dateien mit falschem Hash löschen, damit sie neu geladen werden.
pub(super) async fn verify_hashes(items: &[DownloadItem]) {
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

pub(super) async fn download(state: &AppState, items: Vec<DownloadItem>, force: bool, sp: &SubProgress) -> AppResult<()> {
    if force {
        verify_hashes(&items).await;
    }
    state.net.download_all(items, Some(sp)).await
}

/// Libraries + Natives eines aufgelösten Profils als Download-Liste.
pub(super) fn library_items(r: &Resolved, libs_dir: &Path, env: &Env) -> Vec<DownloadItem> {
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

pub(super) struct VanillaItems {
    pub(super) items: Vec<DownloadItem>,
    pub(super) log_config: Option<PathBuf>,
    pub(super) index_path: Option<PathBuf>,
}

pub(super) fn vanilla_items(paths: &crate::paths::Paths, r: &Resolved, env: &Env) -> VanillaItems {
    let mut items = library_items(r, &paths.libraries(), env);
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
    VanillaItems { items, log_config, index_path }
}

pub(super) async fn read_asset_index(p: &Path) -> AppResult<AssetIndex> {
    let bytes = tokio::fs::read(p).await?;
    serde_json::from_slice(&bytes).ctx("Asset-Index ungültig")
}

pub(super) fn asset_items(paths: &crate::paths::Paths, idx: &AssetIndex) -> Vec<DownloadItem> {
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
    items
}

pub(super) async fn materialize_assets(paths: &crate::paths::Paths, index_id: &str, idx: &AssetIndex, game_dir: &Path) -> AppResult<PathBuf> {
    if !(idx.is_virtual || idx.map_to_resources) {
        return Ok(paths.assets());
    }
    let target = if idx.map_to_resources { game_dir.join("resources") } else { paths.assets().join("virtual").join(index_id) };
    let objs = paths.assets().join("objects");
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
    Ok(target)
}
