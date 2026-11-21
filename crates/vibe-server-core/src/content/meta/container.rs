use super::*;

/// Abstraktion über Zip-Archiv oder Ordner.
pub(super) trait Container {
    fn read(&mut self, name: &str) -> Option<Vec<u8>>;
}



pub(super) struct ZipC<R: std::io::Read + std::io::Seek>(pub(super) zip::ZipArchive<R>);

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



pub(super) struct DirC<'a>(pub(super) &'a Path);

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



pub(super) fn parse_container(c: &mut dyn Container, kind: ContentKind) -> (Parsed, Option<Vec<u8>>) {
    let mut parsed = Parsed::default();
    if kind == ContentKind::Mod {
        if let Some(v) = c.read("fabric.mod.json").and_then(|b| lenient_json(&b)) {
            parsed = parse_fabric(&v);
            // Mehrloader-JAR (fabric.mod.json + mods.toml): Loader nicht festlegen
            if c.read("META-INF/mods.toml").is_some() || c.read("META-INF/neoforge.mods.toml").is_some() {
                parsed.loader = Some("multi".into());
            }
        } else if let Some(v) = c.read("quilt.mod.json").and_then(|b| lenient_json(&b)) {
            parsed = parse_quilt(&v);
        } else if let Some((t, loader)) = c.read("META-INF/neoforge.mods.toml").map(|t| (t, "neoforge")).or_else(|| c.read("META-INF/mods.toml").map(|t| (t, "forge"))) {
            let manifest = c.read("META-INF/MANIFEST.MF").map(|b| String::from_utf8_lossy(&b).to_string());
            let mv = manifest.as_deref().and_then(manifest_impl_version);
            parsed = parse_mods_toml(&String::from_utf8_lossy(&t), mv.as_deref());
            parsed.loader = Some(loader.into());
            // Jar-in-Jar (NeoForge/Forge)
            if let Some(v) = c.read("META-INF/jarjar/metadata.json").and_then(|b| lenient_json(&b)) {
                parsed.nested = v
                    .get("jars")
                    .and_then(|j| j.as_array())
                    .map(|a| a.iter().filter_map(|x| x.get("path").and_then(|p| p.as_str()).map(str::to_string)).collect())
                    .unwrap_or_default();
            }
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
    // IDs eingebetteter Mods (eine Ebene) als "provides"
    for path in parsed.nested.clone().iter().take(128) {
        let Some(bytes) = c.read(path) else { continue };
        let Ok(z) = zip::ZipArchive::new(std::io::Cursor::new(bytes)) else { continue };
        let mut inner = ZipC(z);
        let sub = if let Some(v) = inner.read("fabric.mod.json").and_then(|b| lenient_json(&b)) {
            parse_fabric(&v)
        } else if let Some(v) = inner.read("quilt.mod.json").and_then(|b| lenient_json(&b)) {
            parse_quilt(&v)
        } else if let Some(t) = inner.read("META-INF/neoforge.mods.toml").or_else(|| inner.read("META-INF/mods.toml")) {
            parse_mods_toml(&String::from_utf8_lossy(&t), None)
        } else {
            continue;
        };
        if let Some(id) = sub.mod_id {
            parsed.provides.push(id);
        }
        parsed.provides.extend(sub.provides);
    }
    parsed.provides.sort();
    parsed.provides.dedup();
    let icon = parsed.icon_path.as_deref().and_then(|p| c.read(p)).filter(|b| !b.is_empty() && b.len() <= MAX_ICON && image_mime(b).is_some());
    (parsed, icon)
}
