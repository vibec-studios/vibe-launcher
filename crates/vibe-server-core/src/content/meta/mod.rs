//! Metadaten aus Mod-JARs, Resourcepacks, Shaderpacks und Datapacks lesen (blockierend).
//!
//! Unterstützt: `fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`, `META-INF/neoforge.mods.toml`,
//! `mcmod.info`, `pack.mcmeta` + `pack.png` (Zip oder Ordner). Icons werden unter `cache/icons/` abgelegt.
use super::index::{LocalMeta, MetaDep};
use super::ContentKind;
use base64::Engine;
use serde_json::Value;
use sha1::{Digest, Sha1};
use std::io::Read;
use std::path::Path;

mod loaders;
use loaders::*;
mod container;
use container::*;

const MAX_ICON: usize = 512 * 1024;

#[derive(Default)]
struct Parsed {
    mod_id: Option<String>,
    name: Option<String>,
    version: Option<String>,
    description: Option<String>,
    authors: Vec<String>,
    icon_path: Option<String>,
    loader: Option<String>,
    deps: Vec<MetaDep>,
    provides: Vec<String>,
    environment: Option<String>,
    /// eingebettete JARs (Pfade im Archiv)
    nested: Vec<String>,
}

fn dep(id: &str, range: Option<String>, kind: &str) -> MetaDep {
    MetaDep { id: id.to_string(), range: range.filter(|r| !r.trim().is_empty()), kind: kind.to_string() }
}

/// Fabric-`depends`-Wert (String oder Liste von Strings = ODER) -> Bereich.
fn fabric_range(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Array(a) => {
            let parts: Vec<String> = a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join(" || "))
            }
        }
        _ => None,
    }
}

/// Minecraft-Formatcodes (§x) entfernen und trimmen.
pub fn strip_formatting(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut skip = false;
    for c in s.chars() {
        if skip {
            skip = false;
            continue;
        }
        if c == '§' {
            skip = true;
            continue;
        }
        out.push(c);
    }
    out.trim().to_string()
}

/// Text-Komponente (String, Objekt mit text/extra, Array) zu Klartext.
pub fn component_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().map(component_text).collect(),
        Value::Object(o) => {
            let mut s = o.get("text").or_else(|| o.get("translate")).and_then(|t| t.as_str()).unwrap_or("").to_string();
            if let Some(extra) = o.get("extra") {
                s.push_str(&component_text(extra));
            }
            s
        }
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
    }
}

/// JSON tolerant parsen (manche Mods haben echte Zeilenumbrüche in Strings).
pub fn lenient_json(bytes: &[u8]) -> Option<Value> {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    if let Ok(v) = serde_json::from_slice(bytes) {
        return Some(v);
    }
    let s = String::from_utf8_lossy(bytes);
    let cleaned: String = s.chars().map(|c| if c == '\n' || c == '\r' || c == '\t' { ' ' } else { c }).collect();
    serde_json::from_str(&cleaned).ok()
}

fn str_of(v: Option<&Value>) -> Option<String> {
    v.and_then(|v| v.as_str()).map(strip_formatting).filter(|s| !s.is_empty())
}

/// Icon-Angabe (String oder {"16": "...", "128": "..."}) -> Pfad. Bevorzugt die größte Variante ≤ 256.
fn icon_of(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) => Some(s.clone()),
        Value::Object(o) => {
            let mut best: Option<(u32, String)> = None;
            for (k, v) in o {
                let Some(p) = v.as_str() else { continue };
                let size: u32 = k.parse().unwrap_or(0);
                let score = if size <= 256 { size } else { 0 };
                if best.as_ref().map_or(true, |(b, _)| score > *b) {
                    best = Some((score, p.to_string()));
                }
            }
            best.map(|(_, p)| p)
        }
        _ => None,
    }
}

/// MIME-Typ anhand der Magic-Bytes.
pub fn image_mime(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(b"\x89PNG") {
        Some("image/png")
    } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if b.starts_with(b"GIF8") {
        Some("image/gif")
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

pub fn data_url(bytes: &[u8]) -> Option<String> {
    let mime = image_mime(bytes)?;
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Icon aus dem Cache als data:-URL.
pub fn icon_data_url(icons_dir: &Path, name: &str) -> Option<String> {
    let b = std::fs::read(icons_dir.join(name)).ok()?;
    data_url(&b)
}

fn store_icon(icons_dir: &Path, hash: &str, bytes: &[u8]) -> Option<String> {
    let name = format!("{hash}.img");
    let p = icons_dir.join(&name);
    if !p.exists() {
        std::fs::create_dir_all(icons_dir).ok()?;
        let tmp = icons_dir.join(format!("{name}.tmp{}", std::process::id()));
        std::fs::write(&tmp, bytes).ok()?;
        if std::fs::rename(&tmp, &p).is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
    }
    Some(name)
}

fn apply(meta: &mut LocalMeta, p: Parsed) {
    meta.mod_id = p.mod_id;
    meta.name = p.name;
    meta.version = p.version;
    meta.description = p.description;
    meta.authors = p.authors;
    meta.loader = p.loader;
    meta.deps = p.deps;
    meta.provides = p.provides;
    meta.environment = p.environment;
    meta.meta_version = super::index::META_VERSION;
}

/// Datei oder Ordner einlesen: Hashes + Metadaten + Icon. `size`/`mtime` setzt der Aufrufer.
pub fn read_entry(path: &Path, kind: ContentKind, icons_dir: &Path) -> LocalMeta {
    let mut meta = LocalMeta { meta_version: super::index::META_VERSION, ..Default::default() };
    if path.is_dir() {
        meta.is_dir = true;
        let (parsed, icon) = parse_container(&mut DirC(path), kind);
        apply(&mut meta, parsed);
        if let Some(icon) = icon {
            let h = hex::encode(Sha1::digest(&icon));
            meta.icon = store_icon(icons_dir, &h, &icon);
        }
        return meta;
    }
    let Ok(data) = std::fs::read(path) else { return meta };
    let sha1 = hex::encode(Sha1::digest(&data));
    meta.sha256 = Some(hex::encode(<sha2::Sha256 as sha2::Digest>::digest(&data)));
    meta.murmur2 = Some(super::murmur::cf_fingerprint(&data));
    if let Ok(zip) = zip::ZipArchive::new(std::io::Cursor::new(&data[..])) {
        let (parsed, icon) = parse_container(&mut ZipC(zip), kind);
        apply(&mut meta, parsed);
        if let Some(icon) = icon {
            meta.icon = store_icon(icons_dir, &sha1, &icon);
        }
    }
    meta.sha1 = Some(sha1);
    meta
}

#[cfg(test)]
mod tests;
