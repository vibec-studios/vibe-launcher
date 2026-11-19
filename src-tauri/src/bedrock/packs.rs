//! Installierte Packs einer Bedrock-Instanz: Liste, Installation aus Archiven, Entfernen, Export,
//! Aktivieren je Welt (`world_resource_packs.json` / `world_behavior_packs.json`).
use super::manifest::{self, Entry, Found, Manifest, PackKind};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct BedrockPack {
    /// `<ordner-art>/<ordnername>`, z. B. `resource_packs/Tolles Pack` – stabile ID innerhalb der Instanz
    pub id: String,
    pub kind: PackKind,
    pub name: String,
    pub description: String,
    pub uuid: String,
    pub version: Vec<u64>,
    pub min_engine: Option<String>,
    /// Aus einem `development_*`-Ordner (eigene Entwicklung)
    pub dev: bool,
    pub size: u64,
    /// Kleines Icon als data:-URL
    pub icon: Option<String>,
    pub modified: i64,
    /// Woher (CurseForge-Projekt), falls über den Launcher installiert
    pub source: Option<PackSource>,
}

/// Herkunft (in `.vibe-source.json` im Pack-Ordner).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PackSource {
    pub project_id: String,
    pub file_id: String,
    pub title: Option<String>,
}

const SOURCE_FILE: &str = ".vibe-source.json";

fn folders(kind: PackKind) -> [(&'static str, bool); 2] {
    match kind {
        PackKind::Resource => [("resource_packs", false), ("development_resource_packs", true)],
        PackKind::Behavior => [("behavior_packs", false), ("development_behavior_packs", true)],
        PackKind::Skin => [("skin_packs", false), ("development_skin_packs", true)],
        PackKind::WorldTemplate => [("world_templates", false), ("world_templates", false)],
    }
}

fn mtime(p: &Path) -> i64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Pack-Ordner lesen (`None`, wenn kein gültiges Manifest).
pub fn read_pack_dir(dir: &Path) -> Option<Manifest> {
    let bytes = std::fs::read(dir.join("manifest.json")).ok()?;
    let lang = std::fs::read_to_string(dir.join("texts").join("en_US.lang")).ok();
    manifest::parse(&bytes, lang.as_deref()).ok()
}

/// Alle Packs unter `packs_dir` (= Slot mit Packs).
pub fn list(packs_dir: &Path, with_icons: bool) -> Vec<BedrockPack> {
    let mut out = Vec::new();
    for kind in PackKind::all() {
        let mut seen = std::collections::HashSet::new();
        for (folder, dev) in folders(kind) {
            if !seen.insert(folder) {
                continue;
            }
            let Ok(rd) = std::fs::read_dir(packs_dir.join(folder)) else { continue };
            for e in rd.flatten() {
                let dir = e.path();
                if !dir.is_dir() {
                    continue;
                }
                let Some(m) = read_pack_dir(&dir) else { continue };
                let name = e.file_name().to_string_lossy().to_string();
                let icon = if with_icons { super::icon_data_url(&dir.join("pack_icon.png"), 96) } else { None };
                let source = std::fs::read(dir.join(SOURCE_FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok());
                out.push(BedrockPack {
                    id: format!("{folder}/{name}"),
                    kind: m.kind,
                    name: m.name,
                    description: m.description,
                    uuid: m.uuid,
                    version: m.version,
                    min_engine: m.min_engine,
                    dev,
                    size: super::dir_size(&dir),
                    icon,
                    modified: mtime(&dir),
                    source,
                });
            }
        }
    }
    out.sort_by_key(|p| p.name.to_lowercase());
    out
}

/// Pack-ID (`resource_packs/<ordner>`) prüfen und auflösen.
pub fn resolve(packs_dir: &Path, id: &str) -> AppResult<PathBuf> {
    let (folder, name) = id.split_once('/').ok_or_else(|| AppError::Invalid("Ungültige Pack-ID".into()))?;
    let ok_folder = PackKind::all().iter().flat_map(|k| folders(*k)).any(|(f, _)| f == folder);
    if !ok_folder || name.is_empty() || name.contains(['/', '\\', ':']) || name == "." || name == ".." {
        return Err(AppError::Invalid("Ungültige Pack-ID".into()));
    }
    let p = packs_dir.join(folder).join(name);
    if !p.join("manifest.json").is_file() {
        return Err(AppError::NotFound(format!("Pack {id}")));
    }
    Ok(p)
}

/// Ordnername aus dem Pack-Namen.
fn folder_name(name: &str) -> String {
    let s: String = crate::paths::sanitize_file_name(name).chars().filter(|c| !c.is_control()).take(60).collect();
    let s = s.trim().trim_end_matches('.').to_string();
    if s.is_empty() { "pack".into() } else { s }
}

/// Dateien in einen neuen Ordner schreiben (erst in einen Temp-Ordner daneben, dann umbenennen).
fn write_tree(dest: &Path, files: &[(&str, &[u8])]) -> AppResult<()> {
    let parent = dest.parent().ok_or_else(|| AppError::msg("Kein Zielordner"))?;
    std::fs::create_dir_all(parent)?;
    let tmp = parent.join(format!(".vibe-tmp-{}", uuid::Uuid::new_v4().simple()));
    let r = (|| {
        for (rel, data) in files {
            let p = crate::util::safe_join(&tmp, rel).ok_or_else(|| AppError::Invalid(format!("Unsicherer Pfad: {rel}")))?;
            if let Some(pp) = p.parent() {
                std::fs::create_dir_all(pp)?;
            }
            std::fs::write(&p, data)?;
        }
        std::fs::rename(&tmp, dest)?;
        Ok::<_, AppError>(())
    })();
    if r.is_err() {
        let _ = std::fs::remove_dir_all(&tmp);
    }
    r
}

/// Ersetzen: alten Ordner beiseite, neuen an seine Stelle, alten weg. Bricht nichts halb ab.
fn replace_dir(old: &Path, files: &[(&str, &[u8])]) -> AppResult<()> {
    let parent = old.parent().ok_or_else(|| AppError::msg("Kein Zielordner"))?;
    let aside = parent.join(format!(".vibe-old-{}", uuid::Uuid::new_v4().simple()));
    std::fs::rename(old, &aside)?;
    match write_tree(old, files) {
        Ok(()) => {
            let _ = std::fs::remove_dir_all(&aside);
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::rename(&aside, old);
            Err(e)
        }
    }
}

/// Ergebnis eines Imports.
#[derive(Debug, Clone, Serialize, Default)]
pub struct ImportResult {
    /// Installierte bzw. aktualisierte Packs (Namen)
    pub packs: Vec<String>,
    /// Importierte Welten (Ordnernamen unter `minecraftWorlds`)
    pub worlds: Vec<String>,
    /// Bereits vorhandene Packs, die ersetzt wurden
    pub updated: Vec<String>,
}

/// Ein Pack installieren: gleiche UUID im Zielordner -> ersetzen (Update), sonst neuer Ordner.
pub fn install_pack(packs_dir: &Path, m: &Manifest, files: &[(&str, &[u8])], source: Option<&PackSource>) -> AppResult<(String, bool)> {
    let folder = m.kind.folder();
    let base = packs_dir.join(folder);
    std::fs::create_dir_all(&base)?;
    let mut owned: Vec<(String, Vec<u8>)> = files.iter().filter(|(r, _)| *r != SOURCE_FILE).map(|(r, d)| (r.to_string(), d.to_vec())).collect();
    if let Some(s) = source {
        owned.push((SOURCE_FILE.into(), serde_json::to_vec_pretty(s)?));
    }
    let refs: Vec<(&str, &[u8])> = owned.iter().map(|(r, d)| (r.as_str(), d.as_slice())).collect();
    // Vorhandenes Pack mit gleicher UUID?
    if let Ok(rd) = std::fs::read_dir(&base) {
        for e in rd.flatten() {
            if e.path().is_dir() && read_pack_dir(&e.path()).is_some_and(|x| x.uuid == m.uuid) {
                replace_dir(&e.path(), &refs)?;
                return Ok((format!("{folder}/{}", e.file_name().to_string_lossy()), true));
            }
        }
    }
    let stem = folder_name(&m.name);
    let mut name = stem.clone();
    let mut n = 2;
    while base.join(&name).exists() {
        name = format!("{stem} ({n})");
        n += 1;
    }
    write_tree(&base.join(&name), &refs)?;
    Ok((format!("{folder}/{name}"), false))
}

/// Zufälliger Weltordnername wie im Spiel (12 Zeichen).
pub fn new_world_folder(worlds_dir: &Path) -> String {
    loop {
        let s: String = uuid::Uuid::new_v4().simple().to_string().chars().take(12).collect();
        if !worlds_dir.join(&s).exists() {
            return s;
        }
    }
}

/// Archiv (bereits gelesen) in die Instanz übernehmen.
/// `worlds_dir`: Ziel für Welten (`None`, wenn es noch keinen Spielerordner gibt).
pub fn import_entries(packs_dir: &Path, worlds_dir: Option<&Path>, entries: &[Entry], source: Option<&PackSource>) -> AppResult<ImportResult> {
    let found = manifest::analyze(entries)?;
    if found.is_empty() {
        return Err(AppError::Invalid("In der Datei wurde kein Bedrock-Pack und keine Welt gefunden.".into()));
    }
    if worlds_dir.is_none() && found.iter().any(|f| matches!(f, Found::World { .. })) {
        return Err(AppError::Invalid("Für Welten braucht die Instanz einen Spielerordner: Starte sie einmal, dann klappt der Import.".into()));
    }
    // Innere Archive einmal entpacken
    let mut nested: std::collections::HashMap<String, Vec<Entry>> = Default::default();
    for f in &found {
        let n = match f {
            Found::Pack { nested: Some(n), .. } | Found::World { nested: Some(n), .. } => n,
            _ => continue,
        };
        if !nested.contains_key(n) {
            let data = entries.iter().find(|e| &e.path == n).map(|e| e.data.as_slice()).unwrap_or_default();
            nested.insert(n.clone(), manifest::read_zip(data)?);
        }
    }
    let mut res = ImportResult::default();
    for f in &found {
        match f {
            Found::Pack { manifest, root, nested: n } => {
                let src = n.as_ref().map(|n| nested[n].as_slice()).unwrap_or(entries);
                let files = manifest::files_of(src, root);
                let (_, updated) = install_pack(packs_dir, manifest, &files, source)?;
                if updated {
                    res.updated.push(manifest.name.clone());
                }
                res.packs.push(manifest.name.clone());
            }
            Found::World { root, nested: n, .. } => {
                let wd = worlds_dir.expect("oben geprüft");
                let src = n.as_ref().map(|n| nested[n].as_slice()).unwrap_or(entries);
                let files = manifest::files_of(src, root);
                std::fs::create_dir_all(wd)?;
                let folder = new_world_folder(wd);
                write_tree(&wd.join(&folder), &files)?;
                res.worlds.push(folder);
            }
        }
    }
    Ok(res)
}

/// Ordnerinhalt als ZIP (Wurzel = Ordnerinhalt) schreiben, z. B. `.mcpack`/`.mcworld`.
pub fn zip_dir(src: &Path, out: &Path) -> AppResult<()> {
    use std::io::Write;
    let tmp = out.with_extension("vibe-tmp");
    let r = (|| {
        let f = std::fs::File::create(&tmp)?;
        let mut z = zip::ZipWriter::new(std::io::BufWriter::new(f));
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
        for e in walkdir::WalkDir::new(src).min_depth(1).into_iter().flatten() {
            let rel = e.path().strip_prefix(src).map_err(|e| AppError::msg(e.to_string()))?.to_string_lossy().replace('\\', "/");
            if rel == SOURCE_FILE || rel.ends_with("session.lock") {
                continue;
            }
            if e.file_type().is_dir() {
                z.add_directory(format!("{rel}/"), opts)?;
            } else if e.file_type().is_file() {
                z.start_file(rel, opts)?;
                let mut f = std::fs::File::open(e.path())?;
                std::io::copy(&mut f, &mut z)?;
            }
        }
        z.finish()?.flush()?;
        Ok::<_, AppError>(())
    })();
    match r {
        Ok(()) => {
            std::fs::rename(&tmp, out)?;
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}

// ------------------------------------------------------------------ Packs je Welt

/// Eintrag in `world_*_packs.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorldPackRef {
    pub pack_id: String,
    pub version: Vec<u64>,
}

pub fn world_pack_file(world: &Path, kind: PackKind) -> Option<PathBuf> {
    match kind {
        PackKind::Resource => Some(world.join("world_resource_packs.json")),
        PackKind::Behavior => Some(world.join("world_behavior_packs.json")),
        _ => None,
    }
}

pub fn read_world_packs(world: &Path, kind: PackKind) -> Vec<WorldPackRef> {
    let Some(f) = world_pack_file(world, kind) else { return Vec::new() };
    let Ok(text) = std::fs::read_to_string(f) else { return Vec::new() };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&manifest::relax_json(&text)) else { return Vec::new() };
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| {
                    Some(WorldPackRef {
                        pack_id: x.get("pack_id")?.as_str()?.to_ascii_lowercase(),
                        version: x.get("version").and_then(|v| v.as_array()).map(|a| a.iter().map(|n| n.as_u64().unwrap_or(0)).collect()).unwrap_or_default(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Pack in einer Welt ein-/ausschalten. Neue Einträge kommen nach vorn (= höchste Priorität im Spiel).
/// Unbekannte Felder vorhandener Einträge bleiben erhalten.
pub fn set_world_pack(world: &Path, kind: PackKind, uuid: &str, version: &[u64], enabled: bool) -> AppResult<()> {
    let f = world_pack_file(world, kind).ok_or_else(|| AppError::Invalid("Nur Ressourcen- und Verhaltenspakete lassen sich je Welt aktivieren".into()))?;
    if !world.join("level.dat").is_file() {
        return Err(AppError::NotFound("Welt".into()));
    }
    let uuid = uuid.to_ascii_lowercase();
    let mut arr: Vec<serde_json::Value> = std::fs::read_to_string(&f)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&manifest::relax_json(&t)).ok())
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();
    arr.retain(|x| x.get("pack_id").and_then(|p| p.as_str()).map(|p| p.to_ascii_lowercase()) != Some(uuid.clone()));
    if enabled {
        arr.insert(0, serde_json::json!({ "pack_id": uuid, "version": version }));
    }
    crate::util::write_json_atomic(&f, &arr)
}

#[cfg(test)]
mod tests {
    use super::super::manifest::tests::{manifest, zip_of};
    use super::*;

    #[test]
    fn install_list_update_remove_export() {
        let tmp = super::super::tempdir("packs");
        let packs = tmp.join("Users/Shared/games/com.mojang");
        let worlds = tmp.join("Users/1/games/com.mojang/minecraftWorlds");
        let addon = zip_of(&[
            ("RP/manifest.json", &manifest("Glanz", "r-1", "resources")),
            ("RP/pack_icon.png", &tiny_png()),
            ("BP/manifest.json", &manifest("Mobs", "b-1", "data")),
            ("BP/entities/x.json", b"{}"),
        ]);
        let entries = manifest::read_zip(&addon).unwrap();
        let src = PackSource { project_id: "123".into(), file_id: "9".into(), title: Some("Addon".into()) };
        let r = import_entries(&packs, Some(&worlds), &entries, Some(&src)).unwrap();
        assert_eq!(r.packs.len(), 2);
        assert!(r.updated.is_empty());
        let l = list(&packs, true);
        assert_eq!(l.len(), 2);
        let rp = l.iter().find(|p| p.kind == PackKind::Resource).unwrap();
        assert_eq!(rp.id, "resource_packs/Glanz");
        assert!(rp.icon.as_deref().is_some_and(|i| i.starts_with("data:image/png;base64,")));
        assert_eq!(rp.source.as_ref(), Some(&src));
        // Gleiche UUID erneut -> Update im selben Ordner
        let r2 = import_entries(&packs, Some(&worlds), &entries, None).unwrap();
        assert_eq!(r2.updated.len(), 2);
        assert_eq!(list(&packs, false).len(), 2);
        assert!(list(&packs, false).iter().all(|p| p.source.is_none()));
        // Anderes Pack mit gleichem Namen -> eigener Ordner
        let other = zip_of(&[("manifest.json", &manifest("Glanz", "r-2", "resources"))]);
        import_entries(&packs, None, &manifest::read_zip(&other).unwrap(), None).unwrap();
        assert!(packs.join("resource_packs/Glanz (2)/manifest.json").is_file());
        // Export als .mcpack und wieder einlesbar
        let dir = resolve(&packs, "resource_packs/Glanz").unwrap();
        let out = tmp.join("export.mcpack");
        zip_dir(&dir, &out).unwrap();
        let back = manifest::analyze(&manifest::read_zip(&std::fs::read(&out).unwrap()).unwrap()).unwrap();
        assert!(matches!(&back[..], [Found::Pack { manifest, root, .. }] if manifest.uuid == "r-1" && root.is_empty()));
        // Ungültige IDs
        assert!(resolve(&packs, "../x").is_err());
        assert!(resolve(&packs, "resource_packs/..").is_err());
        assert!(resolve(&packs, "mods/x").is_err());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn world_import_needs_player_folder_and_world_packs() {
        let tmp = super::super::tempdir("wpacks");
        let packs = tmp.join("p");
        let worlds = tmp.join("w");
        let mcworld = zip_of(&[("level.dat", b"x"), ("levelname.txt", b"Insel"), ("db/CURRENT", b"1")]);
        let e = manifest::read_zip(&mcworld).unwrap();
        assert!(import_entries(&packs, None, &e, None).is_err());
        let r = import_entries(&packs, Some(&worlds), &e, None).unwrap();
        assert_eq!(r.worlds.len(), 1);
        let w = worlds.join(&r.worlds[0]);
        assert_eq!(std::fs::read_to_string(w.join("levelname.txt")).unwrap(), "Insel");
        // Packs je Welt: an, Reihenfolge, fremde Felder bleiben, aus
        std::fs::write(w.join("world_resource_packs.json"), r#"[{"pack_id":"ALT","version":[1,0,0],"subpack":"hd"},]"#).unwrap();
        set_world_pack(&w, PackKind::Resource, "neu", &[2, 0, 0], true).unwrap();
        let l = read_world_packs(&w, PackKind::Resource);
        assert_eq!(l.iter().map(|x| x.pack_id.as_str()).collect::<Vec<_>>(), vec!["neu", "alt"]);
        assert!(std::fs::read_to_string(w.join("world_resource_packs.json")).unwrap().contains("subpack"));
        set_world_pack(&w, PackKind::Resource, "NEU", &[2, 0, 0], false).unwrap();
        assert_eq!(read_world_packs(&w, PackKind::Resource).len(), 1);
        assert!(set_world_pack(&w, PackKind::Skin, "x", &[1], true).is_err());
        assert!(set_world_pack(&tmp.join("gibtsnicht"), PackKind::Behavior, "x", &[1], true).is_err());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    fn tiny_png() -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(4, 4, image::Rgba([10, 200, 90, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img).write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }
}
