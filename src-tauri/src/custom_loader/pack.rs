use super::issue::{PackIssue, PackResult};
use super::limits::*;
use super::manifest::Manifest;
use super::validate::{parse, safe_rel};
use super::MANIFEST;
use crate::instance::LoaderKind;
use crate::paths::Paths;
use base64::Engine;
use serde::Serialize;
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use zip::ZipArchive;

const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";

pub(super) struct Opened {
    pub manifest: Manifest,
    pub icon: Option<Vec<u8>>,
    zip: ZipArchive<File>,
    entries: HashMap<String, usize>,
}

fn scan(z: &mut ZipArchive<File>) -> PackResult<HashMap<String, usize>> {
    if z.len() > MAX_ENTRIES {
        return Err(PackIssue::new("too_many_entries", format!("Das Pack hat {} Einträge, erlaubt sind höchstens {MAX_ENTRIES}.", z.len())).with("max", MAX_ENTRIES).with("n", z.len()));
    }
    let mut entries = HashMap::new();
    let mut total: u64 = 0;
    for i in 0..z.len() {
        let e = z.by_index_raw(i)?;
        let name = e.name().to_string();
        let clean = if e.is_dir() { name.strip_suffix('/').unwrap_or(&name) } else { name.as_str() };
        let link = e.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000);
        if !safe_rel(clean) || link {
            return Err(PackIssue::new("unsafe_path", format!("Das Pack enthält einen unzulässigen Pfad: „{name}“.")).with("path", &name));
        }
        total = total.saturating_add(e.size());
        if total > MAX_UNPACKED {
            return Err(PackIssue::new("too_big", "Das Pack ist entpackt größer als 300 MB.").with("max_mb", MAX_UNPACKED / 1024 / 1024));
        }
        if !e.is_dir() && entries.insert(name.clone(), i).is_some() {
            return Err(PackIssue::new("duplicate_entry", format!("Die Datei „{name}“ steht doppelt im Pack.")).with("path", &name));
        }
    }
    Ok(entries)
}

fn read_limited(z: &mut ZipArchive<File>, idx: usize, max: u64, code: &'static str, what: &str) -> PackResult<Vec<u8>> {
    let too_big = || PackIssue::new(code, format!("{what} ist größer als {} KB.", max / 1024)).with("max_kb", max / 1024);
    let e = z.by_index(idx)?;
    if e.size() > max {
        return Err(too_big());
    }
    let mut buf = Vec::new();
    e.take(max + 1).read_to_end(&mut buf)?;
    if buf.len() as u64 > max {
        return Err(too_big());
    }
    Ok(buf)
}

fn copy_entry(z: &mut ZipArchive<File>, idx: usize, mut sink: Option<&mut dyn Write>) -> PackResult<(String, u64)> {
    let e = z.by_index(idx)?;
    let declared = e.size();
    let name = e.name().to_string();
    let mut r = e.take(declared + 1);
    let mut h = Sha1::new();
    let mut buf = vec![0u8; 64 * 1024];
    let mut n: u64 = 0;
    loop {
        let k = r.read(&mut buf)?;
        if k == 0 {
            break;
        }
        n += k as u64;
        h.update(&buf[..k]);
        if let Some(w) = sink.as_deref_mut() {
            w.write_all(&buf[..k])?;
        }
    }
    if n != declared {
        return Err(PackIssue::new("entry_size_mismatch", format!("„{name}“ ist im Pack beschädigt (Größe stimmt nicht).")).with("path", &name));
    }
    Ok((hex::encode(h.finalize()), n))
}

pub(super) fn open(path: &Path) -> PackResult<Opened> {
    let mut zip = ZipArchive::new(File::open(path)?)?;
    let entries = scan(&mut zip)?;
    let Some(&midx) = entries.get(MANIFEST) else {
        return Err(PackIssue::new("manifest_missing", "Im Pack fehlt die Datei vibeloader.json im obersten Ordner."));
    };
    let bytes = read_limited(&mut zip, midx, MAX_MANIFEST, "manifest_too_big", "vibeloader.json")?;
    let mut manifest = parse(&bytes)?;
    let icon = match manifest.icon.clone() {
        Some(p) => {
            let idx = *entries.get(&p).ok_or_else(|| PackIssue::new("icon_missing", format!("Das Icon „{p}“ fehlt im Pack.")).with("path", &p))?;
            let data = read_limited(&mut zip, idx, MAX_ICON, "icon_too_big", "Das Icon")?;
            if !data.starts_with(PNG_MAGIC) {
                return Err(PackIssue::new("icon_invalid", "Das Icon muss eine PNG-Datei im Pack sein."));
            }
            Some(data)
        }
        None => None,
    };
    for lib in manifest.profile.libraries.iter_mut() {
        let Some(file) = lib.file.clone() else { continue };
        let idx = *entries
            .get(&file)
            .ok_or_else(|| PackIssue::new("library_file_missing", format!("Die Datei „{file}“ für „{}“ fehlt im Pack.", lib.name)).with("file", &file).with("name", &lib.name))?;
        let (sha1, size) = copy_entry(&mut zip, idx, None)?;
        if size == 0 {
            return Err(PackIssue::new("library_file_empty", format!("Die Datei „{file}“ ist leer.")).with("file", &file));
        }
        lib.sha1 = Some(sha1);
        lib.size = Some(size);
    }
    Ok(Opened { manifest, icon, zip, entries })
}

impl Opened {
    pub(super) fn extract(mut self, dest: &Path) -> PackResult<Manifest> {
        let mut manifest = self.manifest.clone();
        for lib in manifest.profile.libraries.iter_mut() {
            let Some(file) = lib.file.clone() else { continue };
            let idx = self.entries[&file];
            let rel = format!("libraries/{}", lib.maven_path());
            let target = dest.join(&rel);
            if let Some(p) = target.parent() {
                std::fs::create_dir_all(p)?;
            }
            let mut out = File::create(&target)?;
            let (sha1, _) = copy_entry(&mut self.zip, idx, Some(&mut out))?;
            out.flush()?;
            if Some(&sha1) != lib.sha1.as_ref() {
                return Err(PackIssue::new("entry_changed", format!("„{file}“ hat sich während des Imports verändert.")).with("path", &file));
            }
            lib.file = Some(rel);
        }
        manifest.icon = None;
        if let Some(icon) = &self.icon {
            std::fs::write(dest.join("icon.png"), icon)?;
            manifest.icon = Some("icon.png".into());
        }
        let json = serde_json::to_vec_pretty(&manifest).map_err(|e| PackIssue::new("io", e.to_string()))?;
        std::fs::write(dest.join(MANIFEST), json)?;
        Ok(manifest)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RemoteLibrary {
    pub name: String,
    pub url: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PackPreview {
    pub id: String,
    pub name: String,
    pub loader_version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub homepage: Option<String>,
    pub icon: Option<String>,
    pub minecraft: Vec<String>,
    pub mods: LoaderKind,
    pub main_class: String,
    pub jvm_args: Vec<String>,
    pub game_args: Vec<String>,
    pub library_count: usize,
    pub local_count: usize,
    pub library_bytes: u64,
    pub remote: Vec<RemoteLibrary>,
    pub exists: bool,
    pub installed_versions: Vec<String>,
}

pub(super) fn preview(paths: &Paths, o: &Opened) -> PackPreview {
    let m = &o.manifest;
    let libs = &m.profile.libraries;
    let remote = libs
        .iter()
        .filter_map(|l| Some(RemoteLibrary { name: l.name.clone(), url: l.url.clone()?, size: l.size.unwrap_or(0) }))
        .collect();
    let installed_versions = super::store::versions(paths, &m.id);
    PackPreview {
        id: m.id.clone(),
        name: m.name.clone(),
        loader_version: m.loader_version.clone(),
        description: m.description.clone(),
        author: m.author.clone(),
        homepage: m.homepage.clone(),
        icon: o.icon.as_ref().map(|b| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b))),
        minecraft: m.minecraft.clone(),
        mods: m.mods,
        main_class: m.profile.main_class.clone(),
        jvm_args: m.profile.arguments.jvm.clone(),
        game_args: m.profile.arguments.game.clone(),
        library_count: libs.len(),
        local_count: libs.iter().filter(|l| l.is_local()).count(),
        library_bytes: libs.iter().filter_map(|l| l.size).sum(),
        remote,
        exists: installed_versions.contains(&m.loader_version),
        installed_versions,
    }
}

pub fn inspect(paths: &Paths, path: &Path) -> PackResult<PackPreview> {
    let o = open(path)?;
    Ok(preview(paths, &o))
}
