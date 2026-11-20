use crate::content::srctree::safe_rel;
use crate::instance::{PackSource, PackSourceKind};
use base64::Engine;
use serde_json::Value;
use std::path::{Path, PathBuf};

pub const MAX_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub enum Banner {
    Url(String),
    File(PathBuf),
}

fn text(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(str::to_string).filter(|s| !s.trim().is_empty())
}

fn within(p: &Path, roots: &[PathBuf]) -> Option<PathBuf> {
    let c = std::fs::canonicalize(p).ok()?;
    let m = std::fs::metadata(&c).ok()?;
    if !m.is_file() || m.len() > MAX_BYTES {
        return None;
    }
    roots.iter().filter_map(|r| std::fs::canonicalize(r).ok()).any(|r| c.starts_with(&r)).then_some(c)
}

pub fn parse(v: &Value, root: &Path, game: &Path, roots: &[PathBuf], icons: &Path) -> Option<Banner> {
    let src = v.get("source")?;
    match text(src, "type")?.as_str() {
        "url" => text(src, "url").filter(|u| u.starts_with("https://")).map(Banner::Url),
        "relativePath" => within(&root.join(safe_rel(&text(src, "path")?)?), roots).map(Banner::File),
        "relativeProfile" => within(&game.join(safe_rel(&text(src, "path")?)?), roots).map(Banner::File),
        "absolutePath" => within(Path::new(&text(src, "path")?), roots).map(Banner::File),
        "base64" => {
            let data = text(src, "data")?;
            let raw = data.split_once("base64,").map(|(_, d)| d).unwrap_or(&data);
            if raw.len() as u64 > MAX_BYTES * 4 / 3 + 4 {
                return None;
            }
            let bytes = base64::engine::general_purpose::STANDARD.decode(raw.trim()).ok()?;
            crate::content::meta::data_url(&bytes)?;
            let name = hex::encode(<sha1::Sha1 as sha1::Digest>::digest(&bytes));
            let out = icons.join(format!("norisk-{}.img", &name[..16]));
            if !out.is_file() {
                std::fs::create_dir_all(icons).ok()?;
                std::fs::write(&out, &bytes).ok()?;
            }
            Some(Banner::File(out))
        }
        _ => None,
    }
}

pub fn pack_source(v: &Value) -> Option<PackSource> {
    let src = v.get("source")?;
    let id = |k: &str| src.get(k).and_then(|x| x.as_str().map(str::to_string).or_else(|| x.as_u64().map(|n| n.to_string()))).filter(|s| !s.is_empty());
    let (kind, project, version) = match src.get("source")?.as_str()? {
        "modrinth" => (PackSourceKind::Modrinth, id("project_id")?, id("version_id")),
        "curse_forge" | "curseforge" => (PackSourceKind::Curseforge, id("project_id")?, id("file_id")),
        _ => return None,
    };
    Some(PackSource { kind, project_id: Some(project), version_id: version, name: None, version_name: None })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, b'I', b'H', b'D', b'R', 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0];

    #[test]
    fn banner_variants() {
        let d = std::env::temp_dir().join(format!("vl-nrb-{}", uuid::Uuid::new_v4()));
        let (root, game, icons, outside) = (d.join("root"), d.join("root/data/profiles/p"), d.join("icons"), d.join("outside"));
        for p in [&root.join("assets"), &game, &outside] {
            std::fs::create_dir_all(p).unwrap();
        }
        std::fs::write(root.join("assets/b.png"), PNG).unwrap();
        std::fs::write(game.join("icon.png"), PNG).unwrap();
        std::fs::write(outside.join("x.png"), PNG).unwrap();
        let roots = vec![root.clone()];
        let b = |v: Value| parse(&json!({ "source": v }), &root, &game, &roots, &icons);
        assert_eq!(b(json!({"type": "url", "url": "https://x.invalid/a.png"})), Some(Banner::Url("https://x.invalid/a.png".into())));
        assert_eq!(b(json!({"type": "url", "url": "http://x.invalid/a.png"})), None);
        assert!(matches!(b(json!({"type": "relativePath", "path": "assets/b.png"})), Some(Banner::File(_))));
        assert!(matches!(b(json!({"type": "relativeProfile", "path": "icon.png"})), Some(Banner::File(_))));
        assert_eq!(b(json!({"type": "relativePath", "path": "../outside/x.png"})), None);
        assert_eq!(b(json!({"type": "absolutePath", "path": outside.join("x.png").to_string_lossy()})), None);
        assert!(matches!(b(json!({"type": "absolutePath", "path": root.join("assets/b.png").to_string_lossy()})), Some(Banner::File(_))));
        let data = base64::engine::general_purpose::STANDARD.encode(PNG);
        let Some(Banner::File(f)) = b(json!({"type": "base64", "data": data, "mime_type": "image/png"})) else { panic!() };
        assert_eq!(std::fs::read(f).unwrap(), PNG);
        assert_eq!(b(json!({"type": "base64", "data": base64::engine::general_purpose::STANDARD.encode(b"nope")})), None);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn modpack_info() {
        let mr = pack_source(&json!({"source": {"source": "modrinth", "project_id": "1KVo5zza", "version_id": "V1"}, "file_hash": null})).unwrap();
        assert_eq!((mr.kind, mr.project_id.as_deref(), mr.version_id.as_deref()), (PackSourceKind::Modrinth, Some("1KVo5zza"), Some("V1")));
        let cf = pack_source(&json!({"source": {"source": "curse_forge", "project_id": 925200, "file_id": 6000001}})).unwrap();
        assert_eq!((cf.kind, cf.project_id.as_deref(), cf.version_id.as_deref()), (PackSourceKind::Curseforge, Some("925200"), Some("6000001")));
        assert!(pack_source(&json!({"source": {"source": "other"}})).is_none());
    }
}
