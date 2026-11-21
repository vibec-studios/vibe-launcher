use serde_json::Value;
use std::path::{Path, PathBuf};

pub struct ModCache {
    dir: PathBuf,
}

fn safe_name(n: &str) -> Option<&str> {
    let n = n.trim();
    (!n.is_empty() && !n.contains(['/', '\\']) && !n.starts_with('.') && n.to_ascii_lowercase().ends_with(".jar")).then_some(n)
}

impl ModCache {
    pub fn new(meta: &Path) -> Self {
        Self { dir: meta.join("mod_cache") }
    }

    pub fn file(&self, name: Option<&str>) -> Option<PathBuf> {
        let p = self.dir.join(safe_name(name?)?);
        p.is_file().then_some(p)
    }

    pub fn pack_file(&self, packs: &Value, mod_id: &str, mc: &str, loader: &str) -> Option<PathBuf> {
        let loader = loader.to_lowercase();
        let all = packs.get("packs")?.as_object()?;
        all.values().flat_map(|p| p.get("mods").and_then(|m| m.as_array()).into_iter().flatten()).filter(|m| m.get("id").and_then(|x| x.as_str()) == Some(mod_id)).find_map(|m| {
            let c = m.get("compatibility")?.get(mc)?.get(&loader)?;
            let explicit = c.get("filename").and_then(|x| x.as_str()).map(str::to_string);
            let src = m.get("source");
            let slug = src.and_then(|s| s.get("projectSlug").or_else(|| s.get("artifactId"))).and_then(|x| x.as_str());
            let ident = c.get("identifier").and_then(|x| x.as_str());
            let name = explicit.or_else(|| Some(format!("{}-{}.jar", slug?, ident?)))?;
            self.file(Some(&name))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_cached_files() {
        let meta = std::env::temp_dir().join(format!("vl-nrcache-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(meta.join("mod_cache")).unwrap();
        std::fs::write(meta.join("mod_cache/combatradar-1.7.10-1.21.11-fabric.jar"), "x").unwrap();
        std::fs::write(meta.join("mod_cache/sodium-ABC.jar"), "x").unwrap();
        let c = ModCache::new(&meta);
        assert!(c.file(Some("combatradar-1.7.10-1.21.11-fabric.jar")).is_some());
        assert!(c.file(Some("../mod_cache/sodium-ABC.jar")).is_none());
        assert!(c.file(Some("fehlt.jar")).is_none());
        let packs = serde_json::json!({"packs": {"p": {"mods": [{"id": "sodium", "source": {"type": "modrinth", "projectSlug": "sodium"}, "compatibility": {"1.21.11": {"fabric": {"identifier": "ABC", "filename": null}}}}]}}});
        assert!(c.pack_file(&packs, "sodium", "1.21.11", "Fabric").is_some());
        assert!(c.pack_file(&packs, "sodium", "26.3", "fabric").is_none());
        std::fs::remove_dir_all(&meta).ok();
    }
}
