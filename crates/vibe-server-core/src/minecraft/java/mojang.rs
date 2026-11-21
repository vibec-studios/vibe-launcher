use super::*;

// ------------------------------------------------------------------ Mojang-Runtimes

#[derive(Debug, Deserialize)]
pub(super) struct RuntimeEntry {
    pub(super) manifest: RuntimeManifestRef,
    pub(super) version: RuntimeVersion,
}

#[derive(Debug, Deserialize)]
pub(super) struct RuntimeManifestRef {
    pub(super) sha1: Option<String>,
    pub(super) url: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct RuntimeVersion {
    pub(super) name: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct RuntimeManifest {
    pub(super) files: HashMap<String, RuntimeFile>,
}

#[derive(Debug, Deserialize)]
pub(super) struct RuntimeFile {
    #[serde(rename = "type")]
    pub(super) kind: String,
    #[serde(default)]
    pub(super) executable: bool,
    #[serde(default)]
    pub(super) downloads: Option<HashMap<String, RuntimeDl>>,
    #[serde(default)]
    pub(super) target: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct RuntimeDl {
    pub(super) sha1: Option<String>,
    pub(super) size: Option<u64>,
    pub(super) url: String,
}



pub(super) fn mojang_platform() -> &'static str {
    match (crate::minecraft::meta::os_name(), crate::minecraft::meta::arch_name()) {
        ("windows", "x86") => "windows-x86",
        ("windows", "aarch64") => "windows-arm64",
        ("windows", _) => "windows-x64",
        ("osx", "aarch64") => "mac-os-arm64",
        ("osx", _) => "mac-os",
        ("linux", "x86") => "linux-i386",
        _ => "linux",
    }
}



pub(super) type RuntimeIndex = HashMap<String, HashMap<String, Vec<RuntimeEntry>>>;



pub(super) async fn runtime_index(state: &Core) -> AppResult<RuntimeIndex> {
    let cache = state.paths.meta().join("java-runtimes.json");
    match state.net.get_bytes(RUNTIMES_URL).await {
        Ok(b) => {
            let idx: RuntimeIndex = serde_json::from_slice(&b).ctx("Java-Liste von Mojang ungültig")?;
            let _ = tokio::fs::write(&cache, &b).await;
            Ok(idx)
        }
        Err(e) => {
            let b = tokio::fs::read(&cache).await.map_err(|_| AppError::msg(format!("Java-Liste nicht ladbar: {e}")))?;
            Ok(serde_json::from_slice(&b)?)
        }
    }
}



pub(super) fn component_for_major(idx: &RuntimeIndex, major: u32) -> Option<String> {
    let plat = idx.get(mojang_platform())?;
    let preferred = match major {
        8 => "jre-legacy",
        16 => "java-runtime-alpha",
        17 => "java-runtime-gamma",
        21 => "java-runtime-delta",
        25 => "java-runtime-epsilon",
        _ => "",
    };
    if plat.get(preferred).is_some_and(|v| !v.is_empty()) {
        return Some(preferred.to_string());
    }
    let mut names: Vec<&String> = plat
        .iter()
        .filter(|(k, _)| !k.contains("snapshot") && (k.starts_with("java-runtime") || k.starts_with("jre")))
        .filter(|(_, v)| v.first().is_some_and(|e| parse_major(&e.version.name) == major))
        .map(|(k, _)| k)
        .collect();
    names.sort();
    names.last().map(|s| s.to_string())
}



/// Mojang-Runtime-Komponente installieren. Gibt Pfad zu java(w) zurück.
pub async fn install_mojang_component(state: &Core, component: &str, force: bool, sp: Option<&SubProgress>) -> AppResult<PathBuf> {
    let dir = state.paths.java_root().join(component);
    if !force && dir.join(MARKER).is_file() {
        if let Some(x) = find_bin_in(&dir) {
            return Ok(x);
        }
    }
    let idx = runtime_index(state).await?;
    let entry = idx
        .get(mojang_platform())
        .and_then(|p| p.get(component))
        .and_then(|v| v.first())
        .ok_or_else(|| AppError::msg(format!("Java-Komponente {component} gibt es für dieses System nicht.")))?;
    if let Some(sp) = sp {
        sp.message(format!("Java {} wird heruntergeladen …", entry.version.name));
    }
    let manifest_bytes = state.net.get_bytes(&entry.manifest.url).await?;
    if let Some(expected) = &entry.manifest.sha1 {
        use sha1::Digest;
        let got = hex::encode(sha1::Sha1::digest(&manifest_bytes));
        if !got.eq_ignore_ascii_case(expected) {
            return Err(AppError::msg("Java-Manifest: Prüfsumme falsch"));
        }
    }
    let manifest: RuntimeManifest = serde_json::from_slice(&manifest_bytes).ctx("Java-Manifest ungültig")?;
    let mut items = Vec::new();
    let mut executables = Vec::new();
    let mut links = Vec::new();
    for (rel, f) in &manifest.files {
        let Some(target) = crate::util::safe_join(&dir, rel) else { continue };
        match f.kind.as_str() {
            "directory" => {
                tokio::fs::create_dir_all(&target).await?;
            }
            "file" => {
                let Some(raw) = f.downloads.as_ref().and_then(|d| d.get("raw")) else { continue };
                if force {
                    verify_or_remove(&target, raw.sha1.as_deref()).await;
                }
                items.push(DownloadItem::new(&raw.url, &target).sha1(raw.sha1.clone()).size(raw.size));
                if f.executable {
                    executables.push(target);
                }
            }
            "link" => {
                if let Some(t) = &f.target {
                    links.push((target, t.clone()));
                }
            }
            _ => {}
        }
    }
    state.net.download_all(items, sp).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for e in &executables {
            let _ = std::fs::set_permissions(e, std::fs::Permissions::from_mode(0o755));
        }
        for (link, target) in &links {
            if !link.exists() {
                let _ = std::os::unix::fs::symlink(target, link);
            }
        }
    }
    #[cfg(not(unix))]
    let _ = (&executables, &links);
    let marker = serde_json::json!({ "component": component, "version": entry.version.name, "source": "mojang" });
    crate::util::write_json_atomic(&dir.join(MARKER), &marker)?;
    find_bin_in(&dir).ok_or_else(|| AppError::msg("Java wurde geladen, aber java.exe fehlt."))
}



pub(super) async fn verify_or_remove(path: &Path, sha1: Option<&str>) {
    let Some(expected) = sha1 else { return };
    if !path.is_file() {
        return;
    }
    let p = path.to_path_buf();
    let ok = tokio::task::spawn_blocking(move || crate::net::sha1_file(&p))
        .await
        .ok()
        .and_then(|r| r.ok())
        .is_some_and(|h| h.eq_ignore_ascii_case(expected));
    if !ok {
        let _ = tokio::fs::remove_file(path).await;
    }
}
