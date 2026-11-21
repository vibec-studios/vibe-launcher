use super::*;

// ------------------------------------------------------------------ Adoptium

#[derive(Debug, Deserialize)]
pub(super) struct AdoptiumAsset {
    pub(super) binary: AdoptiumBinary,
    #[serde(default)]
    pub(super) version: Option<AdoptiumVersion>,
}

#[derive(Debug, Deserialize)]
pub(super) struct AdoptiumBinary {
    pub(super) package: AdoptiumPackage,
}

#[derive(Debug, Deserialize)]
pub(super) struct AdoptiumPackage {
    pub(super) link: String,
    pub(super) name: String,
    #[serde(default)]
    pub(super) checksum: Option<String>,
    #[serde(default)]
    pub(super) size: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(super) struct AdoptiumVersion {
    #[serde(default)]
    pub(super) openjdk_version: Option<String>,
}

pub async fn install_adoptium(state: &Core, major: u32, sp: Option<&SubProgress>) -> AppResult<PathBuf> {
    let dir = state.paths.java_root().join(format!("adoptium-{major}"));
    if dir.join(MARKER).is_file() {
        if let Some(x) = find_bin_in(&dir) {
            return Ok(x);
        }
    }
    let os = match crate::minecraft::meta::os_name() {
        "windows" => "windows",
        "osx" => "mac",
        _ => "linux",
    };
    let arch = match crate::minecraft::meta::arch_name() {
        "aarch64" => "aarch64",
        "x86" => "x86-32",
        _ => "x64",
    };
    let mut asset = None;
    for image in ["jre", "jdk"] {
        let url = format!("https://api.adoptium.net/v3/assets/latest/{major}/hotspot?architecture={arch}&image_type={image}&os={os}&vendor=eclipse");
        if let Ok(list) = state.net.get_json::<Vec<AdoptiumAsset>>(&url).await {
            if let Some(a) = list.into_iter().find(|a| a.binary.package.name.ends_with(".zip") || a.binary.package.name.ends_with(".tar.gz")) {
                asset = Some(a);
                break;
            }
        }
    }
    let asset = asset.ok_or_else(|| AppError::msg(format!("Java {major} ist zum Download nicht verfügbar.")))?;
    if let Some(sp) = sp {
        sp.message(format!("Java {major} (Adoptium) wird heruntergeladen …"));
    }
    let pkg = &asset.binary.package;
    let tmp = state.paths.tmp().join(format!("adoptium-{major}-{}", pkg.name));
    let _ = tokio::fs::remove_file(&tmp).await;
    state.net.download_all(vec![DownloadItem::new(&pkg.link, &tmp).size(pkg.size)], sp).await?;
    let checksum = pkg.checksum.clone();
    let name = pkg.name.clone();
    let dir2 = dir.clone();
    let tmp2 = tmp.clone();
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        if let Some(expected) = checksum {
            let got = crate::net::sha256_file(&tmp2)?;
            if !got.eq_ignore_ascii_case(&expected) {
                return Err(AppError::msg("Java-Download: Prüfsumme falsch"));
            }
        }
        if dir2.exists() {
            std::fs::remove_dir_all(&dir2)?;
        }
        std::fs::create_dir_all(&dir2)?;
        if name.ends_with(".zip") {
            extract_zip_strip(&tmp2, &dir2)?;
        } else {
            extract_targz_strip(&tmp2, &dir2)?;
        }
        Ok(())
    })
    .await??;
    let _ = tokio::fs::remove_file(&tmp).await;
    let version = asset.version.and_then(|v| v.openjdk_version).unwrap_or_else(|| major.to_string());
    crate::util::write_json_atomic(&dir.join(MARKER), &serde_json::json!({ "component": format!("adoptium-{major}"), "version": version, "source": "adoptium" }))?;
    find_bin_in(&dir).ok_or_else(|| AppError::msg("Java wurde entpackt, aber java.exe fehlt."))
}

/// ZIP entpacken und den obersten Ordner entfernen (jdk-21.0.5+11-jre/...).
pub(super) fn extract_zip_strip(zip_path: &Path, dest: &Path) -> AppResult<()> {
    let f = std::fs::File::open(zip_path)?;
    let mut z = zip::ZipArchive::new(f)?;
    for i in 0..z.len() {
        let mut e = z.by_index(i)?;
        let name = e.name().replace('\\', "/");
        let rel = match name.split_once('/') {
            Some((_, r)) => r.to_string(),
            None => continue,
        };
        if rel.is_empty() {
            continue;
        }
        let Some(out) = crate::util::safe_join(dest, &rel) else { continue };
        if e.is_dir() {
            std::fs::create_dir_all(&out)?;
        } else {
            if let Some(p) = out.parent() {
                std::fs::create_dir_all(p)?;
            }
            let mut w = std::fs::File::create(&out)?;
            std::io::copy(&mut e, &mut w)?;
            #[cfg(unix)]
            if let Some(mode) = e.unix_mode() {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&out, std::fs::Permissions::from_mode(mode));
            }
        }
    }
    Ok(())
}

pub(super) fn extract_targz_strip(path: &Path, dest: &Path) -> AppResult<()> {
    // tar.gz nur auf Unix (Adoptium liefert unter Windows ZIPs) – über das System-tar.
    let status = std::process::Command::new("tar")
        .arg("-xzf")
        .arg(path)
        .arg("-C")
        .arg(dest)
        .arg("--strip-components=1")
        .status()?;
    if !status.success() {
        return Err(AppError::msg("Java-Archiv konnte nicht entpackt werden"));
    }
    Ok(())
}

/// Java einer Hauptversion installieren (Mojang bevorzugt, sonst Adoptium).
pub async fn install_major(state: &Core, major: u32, sp: Option<&SubProgress>) -> AppResult<PathBuf> {
    match runtime_index(state).await {
        Ok(idx) => {
            if let Some(c) = component_for_major(&idx, major) {
                match install_mojang_component(state, &c, false, sp).await {
                    Ok(p) => return Ok(p),
                    Err(AppError::Cancelled) => return Err(AppError::Cancelled),
                    Err(e) => tracing::warn!("Mojang-Java {c} fehlgeschlagen, versuche Adoptium: {e}"),
                }
            }
        }
        Err(e) => tracing::warn!("Mojang-Java-Liste nicht verfügbar: {e}"),
    }
    install_adoptium(state, major, sp).await
}
