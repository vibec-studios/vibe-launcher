use super::manifest::{Library, Manifest};
use super::{pack_dir, store};
use crate::error::{AppError, AppResult};
use crate::instance::{CustomLoaderRef, Loader};
use crate::paths::Paths;
use serde_json::{json, Value};
use std::path::Path;

pub fn version_id(id: &str, loader_version: &str, mc: &str) -> String {
    format!("vibe-{id}-{loader_version}-{mc}")
}

fn broken(m: &Manifest, lib: &Library) -> AppError {
    AppError::msg(format!("Die Datei für „{}“ im Loader-Pack „{}“ fehlt oder ist beschädigt. Importiere das Pack erneut.", lib.name, m.name))
}

fn place(m: &Manifest, lib: &Library, src: &Path, dst: &Path) -> AppResult<()> {
    let want = lib.sha1.as_deref().ok_or_else(|| broken(m, lib))?;
    if dst.is_file() && crate::net::sha1_file(dst).ok().as_deref() == Some(want) {
        return Ok(());
    }
    if crate::net::sha1_file(src).ok().as_deref() != Some(want) {
        return Err(broken(m, lib));
    }
    if let Some(p) = dst.parent() {
        std::fs::create_dir_all(p)?;
    }
    let tmp = dst.with_extension("vibe-tmp");
    let _ = std::fs::remove_file(&tmp);
    std::fs::copy(src, &tmp)?;
    let _ = std::fs::remove_file(dst);
    std::fs::rename(&tmp, dst)?;
    Ok(())
}

pub(super) fn profile_json(m: &Manifest, vid: &str, mc: &str) -> Value {
    let libraries: Vec<Value> = m
        .profile
        .libraries
        .iter()
        .map(|l| {
            json!({
                "name": l.name,
                "downloads": { "artifact": { "path": l.maven_path(), "url": l.url.clone().unwrap_or_default(), "sha1": l.sha1, "size": l.size } }
            })
        })
        .collect();
    json!({
        "id": vid,
        "inheritsFrom": mc,
        "type": "release",
        "mainClass": m.profile.main_class,
        "arguments": { "game": m.profile.arguments.game, "jvm": m.profile.arguments.jvm },
        "libraries": libraries,
    })
}

fn supported(m: &Manifest, mc: &str) -> AppResult<()> {
    if m.supports(mc) {
        return Ok(());
    }
    Err(AppError::Invalid(format!("„{}“ {} unterstützt Minecraft {mc} nicht (nur {}).", m.name, m.loader_version, m.minecraft.join(", "))))
}

pub fn resolve(paths: &Paths, r: &CustomLoaderRef, mc: &str) -> AppResult<(Loader, CustomLoaderRef)> {
    let m = store::load(paths, &r.id, &r.version)?;
    supported(&m, mc)?;
    Ok((Loader { kind: m.mods, version: Some(m.loader_version.clone()) }, CustomLoaderRef { id: m.id, version: m.loader_version }))
}

pub fn ensure_profile(paths: &Paths, r: &CustomLoaderRef, mc: &str) -> AppResult<String> {
    let m = store::load(paths, &r.id, &r.version)?;
    supported(&m, mc)?;
    let dir = pack_dir(paths, &m.id, &m.loader_version);
    let libs = paths.libraries();
    for lib in m.profile.libraries.iter() {
        let Some(file) = lib.file.as_deref() else { continue };
        place(&m, lib, &dir.join(file), &libs.join(lib.maven_path()))?;
    }
    let vid = version_id(&m.id, &m.loader_version, mc);
    crate::util::write_json_atomic(&paths.version_json(&vid), &profile_json(&m, &vid, mc))?;
    Ok(vid)
}
