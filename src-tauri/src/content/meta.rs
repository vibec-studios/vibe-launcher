//! Metadaten aus Mod-JARs, Resourcepacks, Shaderpacks und Datapacks lesen (blockierend).
//!
//! Unterstützt: `fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`, `META-INF/neoforge.mods.toml`,
//! `mcmod.info`, `pack.mcmeta` + `pack.png` (Zip oder Ordner). Icons werden unter `cache/icons/` abgelegt.
use super::index::LocalMeta;
use super::ContentKind;
use base64::Engine;
use serde_json::Value;
use sha1::{Digest, Sha1};
use std::io::Read;
use std::path::Path;

const MAX_ICON: usize = 512 * 1024;

#[derive(Default)]
struct Parsed {
    mod_id: Option<String>,
    name: Option<String>,
    version: Option<String>,
    description: Option<String>,
    authors: Vec<String>,
    icon_path: Option<String>,
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

fn parse_fabric(v: &Value) -> Parsed {
    let authors = v
        .get("authors")
        .and_then(|a| a.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string).or_else(|| x.get("name").and_then(|n| n.as_str()).map(str::to_string)))
                .collect()
        })
        .unwrap_or_default();
    Parsed {
        mod_id: str_of(v.get("id")),
        name: str_of(v.get("name")),
        version: str_of(v.get("version")),
        description: str_of(v.get("description")),
        authors,
        icon_path: icon_of(v.get("icon")),
    }
}

fn parse_quilt(v: &Value) -> Parsed {
    let ql = v.get("quilt_loader").cloned().unwrap_or(Value::Null);
    let md = ql.get("metadata").cloned().unwrap_or(Value::Null);
    let authors = md
        .get("contributors")
        .and_then(|c| c.as_object())
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    Parsed {
        mod_id: str_of(ql.get("id")),
        name: str_of(md.get("name")),
        version: str_of(ql.get("version")),
        description: str_of(md.get("description")),
        authors,
        icon_path: icon_of(md.get("icon")),
    }
}

fn toml_fallback(text: &str, key: &str) -> Option<String> {
    let re = regex::Regex::new(&format!(r#"(?m)^\s*{key}\s*=\s*["']([^"'\n]*)["']"#)).ok()?;
    re.captures(text).map(|c| c[1].to_string()).filter(|s| !s.is_empty())
}

fn parse_mods_toml(text: &str, manifest_version: Option<&str>) -> Parsed {
    let fix_version = |v: Option<String>| -> Option<String> {
        match v {
            Some(v) if v.contains("${file.jarVersion}") => manifest_version.map(|m| v.replace("${file.jarVersion}", m)),
            Some(v) if v.starts_with("${") => manifest_version.map(str::to_string),
            other => other,
        }
    };
    match text.parse::<toml::Table>() {
        Ok(t) => {
            let first = t.get("mods").and_then(|m| m.as_array()).and_then(|a| a.first()).and_then(|m| m.as_table()).cloned().unwrap_or_default();
            let get = |tbl: &toml::Table, k: &str| tbl.get(k).and_then(|v| v.as_str()).map(strip_formatting).filter(|s| !s.is_empty());
            let authors = get(&first, "authors")
                .or_else(|| get(&t, "authors"))
                .map(|a| a.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
                .unwrap_or_default();
            Parsed {
                mod_id: get(&first, "modId"),
                name: get(&first, "displayName"),
                version: fix_version(get(&first, "version")),
                description: get(&first, "description"),
                authors,
                icon_path: get(&first, "logoFile").or_else(|| get(&t, "logoFile")),
            }
        }
        Err(_) => Parsed {
            mod_id: toml_fallback(text, "modId"),
            name: toml_fallback(text, "displayName"),
            version: fix_version(toml_fallback(text, "version")),
            description: toml_fallback(text, "description"),
            authors: toml_fallback(text, "authors").map(|a| vec![a]).unwrap_or_default(),
            icon_path: toml_fallback(text, "logoFile"),
        },
    }
}

fn parse_mcmod_info(v: &Value) -> Parsed {
    let first = match v {
        Value::Array(a) => a.first().cloned(),
        Value::Object(o) => o.get("modList").and_then(|m| m.as_array()).and_then(|a| a.first()).cloned(),
        _ => None,
    }
    .unwrap_or(Value::Null);
    let authors = first
        .get("authorList")
        .or_else(|| first.get("authors"))
        .and_then(|a| a.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    Parsed {
        mod_id: str_of(first.get("modid")),
        name: str_of(first.get("name")),
        version: str_of(first.get("version")),
        description: str_of(first.get("description")),
        authors,
        icon_path: str_of(first.get("logoFile")),
    }
}

fn parse_pack_mcmeta(bytes: &[u8]) -> Parsed {
    let desc = lenient_json(bytes).and_then(|v| v.get("pack").and_then(|p| p.get("description")).map(component_text));
    Parsed {
        description: desc.map(|d| strip_formatting(&d)).filter(|d| !d.is_empty()),
        icon_path: Some("pack.png".into()),
        ..Default::default()
    }
}

fn manifest_impl_version(text: &str) -> Option<String> {
    text.lines()
        .find_map(|l| l.strip_prefix("Implementation-Version:"))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Abstraktion über Zip-Archiv oder Ordner.
trait Container {
    fn read(&mut self, name: &str) -> Option<Vec<u8>>;
}

struct ZipC<R: std::io::Read + std::io::Seek>(zip::ZipArchive<R>);
impl<R: std::io::Read + std::io::Seek> Container for ZipC<R> {
    fn read(&mut self, name: &str) -> Option<Vec<u8>> {
        let name = name.trim_start_matches('/');
        let mut f = self.0.by_name(name).ok()?;
        if f.size() > 16 * 1024 * 1024 {
            return None;
        }
        let mut buf = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut buf).ok()?;
        Some(buf)
    }
}

struct DirC<'a>(&'a Path);
impl Container for DirC<'_> {
    fn read(&mut self, name: &str) -> Option<Vec<u8>> {
        let p = crate::util::safe_join(self.0, name)?;
        let m = std::fs::metadata(&p).ok()?;
        if m.len() > 16 * 1024 * 1024 {
            return None;
        }
        std::fs::read(p).ok()
    }
}

fn parse_container(c: &mut dyn Container, kind: ContentKind) -> (Parsed, Option<Vec<u8>>) {
    let mut parsed = Parsed::default();
    if kind == ContentKind::Mod {
        if let Some(v) = c.read("fabric.mod.json").and_then(|b| lenient_json(&b)) {
            parsed = parse_fabric(&v);
        } else if let Some(v) = c.read("quilt.mod.json").and_then(|b| lenient_json(&b)) {
            parsed = parse_quilt(&v);
        } else if let Some(t) = c.read("META-INF/neoforge.mods.toml").or_else(|| c.read("META-INF/mods.toml")) {
            let manifest = c.read("META-INF/MANIFEST.MF").map(|b| String::from_utf8_lossy(&b).to_string());
            let mv = manifest.as_deref().and_then(manifest_impl_version);
            parsed = parse_mods_toml(&String::from_utf8_lossy(&t), mv.as_deref());
        } else if let Some(v) = c.read("mcmod.info").and_then(|b| lenient_json(&b)) {
            parsed = parse_mcmod_info(&v);
        } else if let Some(b) = c.read("pack.mcmeta") {
            parsed = parse_pack_mcmeta(&b);
        }
    } else if kind != ContentKind::Shader {
        if let Some(b) = c.read("pack.mcmeta") {
            parsed = parse_pack_mcmeta(&b);
        } else {
            parsed.icon_path = Some("pack.png".into());
        }
    }
    let icon = parsed.icon_path.as_deref().and_then(|p| c.read(p)).filter(|b| !b.is_empty() && b.len() <= MAX_ICON && image_mime(b).is_some());
    (parsed, icon)
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
}

/// Datei oder Ordner einlesen: Hashes + Metadaten + Icon. `size`/`mtime` setzt der Aufrufer.
pub fn read_entry(path: &Path, kind: ContentKind, icons_dir: &Path) -> LocalMeta {
    let mut meta = LocalMeta::default();
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
mod tests {
    use super::*;
    use std::io::Write;

    fn make_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            for (n, d) in files {
                w.start_file(*n, zip::write::SimpleFileOptions::default()).unwrap();
                w.write_all(d).unwrap();
            }
            w.finish().unwrap();
        }
        buf.into_inner()
    }

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n0000";

    #[test]
    fn fabric_jar() {
        let dir = std::env::temp_dir().join(format!("vl-meta-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let jar = dir.join("a.jar");
        std::fs::write(
            &jar,
            make_zip(&[
                ("fabric.mod.json", b"{\"id\":\"sodium\",\"name\":\"Sodium\",\"version\":\"0.5.3\",\"description\":\"Fast\nrender\",\"authors\":[\"jellysquid3\",{\"name\":\"IMS\"}],\"icon\":{\"16\":\"s.png\",\"128\":\"icon.png\"}}"),
                ("icon.png", PNG),
            ]),
        )
        .unwrap();
        let m = read_entry(&jar, ContentKind::Mod, &dir.join("icons"));
        assert_eq!(m.mod_id.as_deref(), Some("sodium"));
        assert_eq!(m.name.as_deref(), Some("Sodium"));
        assert_eq!(m.description.as_deref(), Some("Fast render"));
        assert_eq!(m.authors, vec!["jellysquid3", "IMS"]);
        assert!(m.sha1.is_some() && m.murmur2.is_some());
        let icon = m.icon.unwrap();
        assert!(icon_data_url(&dir.join("icons"), &icon).unwrap().starts_with("data:image/png;base64,"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn forge_toml() {
        let toml = r#"
modLoader="javafml"
loaderVersion="[47,)"
license="MIT"
[[mods]]
modId="jei"
version="${file.jarVersion}"
displayName="Just Enough Items"
authors="mezz, someone"
logoFile="logo.png"
description='''
Item list
'''
"#;
        let p = parse_mods_toml(toml, Some("15.2.0.27"));
        assert_eq!(p.mod_id.as_deref(), Some("jei"));
        assert_eq!(p.version.as_deref(), Some("15.2.0.27"));
        assert_eq!(p.name.as_deref(), Some("Just Enough Items"));
        assert_eq!(p.authors, vec!["mezz", "someone"]);
        assert_eq!(p.icon_path.as_deref(), Some("logo.png"));
        assert_eq!(p.description.as_deref(), Some("Item list"));
        // kaputtes TOML -> Regex-Fallback
        let p = parse_mods_toml("displayName=\"X\"\nversion=\"1\"\n[[broken", None);
        assert_eq!(p.name.as_deref(), Some("X"));
    }

    #[test]
    fn mcmod_and_quilt() {
        let v = lenient_json(br#"{"modListVersion":2,"modList":[{"modid":"old","name":"Old Mod","version":"1.0","authorList":["a"]}]}"#).unwrap();
        let p = parse_mcmod_info(&v);
        assert_eq!(p.name.as_deref(), Some("Old Mod"));
        let v = lenient_json(br#"{"quilt_loader":{"id":"q","version":"2","metadata":{"name":"Q Mod","contributors":{"Bob":"Owner"},"icon":"q.png"}}}"#).unwrap();
        let p = parse_quilt(&v);
        assert_eq!(p.name.as_deref(), Some("Q Mod"));
        assert_eq!(p.authors, vec!["Bob"]);
        assert_eq!(p.icon_path.as_deref(), Some("q.png"));
    }

    #[test]
    fn pack_meta() {
        let json = "{\"pack\":{\"pack_format\":15,\"description\":[{\"text\":\"\u{a7}aGreen \"},{\"text\":\"Pack\",\"extra\":[\"!\"]}]}}";
        let p = parse_pack_mcmeta(json.as_bytes());
        assert_eq!(p.description.as_deref(), Some("Green Pack!"));
        assert_eq!(strip_formatting("§6Gold§r text"), "Gold text");
    }
}
