use crate::instance::{Loader, LoaderKind};
use serde_json::Value;
use std::path::Path;
use std::time::SystemTime;

pub struct Guess {
    pub mc: String,
    pub loader: Loader,
    pub played: SystemTime,
}

fn parse(id: &str, v: &Value) -> Option<(String, Loader)> {
    let parent = v.get("inheritsFrom").and_then(|x| x.as_str()).map(str::to_string);
    let l = id.to_ascii_lowercase();
    let after = |prefix: &str| l.strip_prefix(prefix).map(|r| id[id.len() - r.len()..].to_string());
    if let Some(rest) = after("fabric-loader-").or_else(|| after("quilt-loader-")) {
        let kind = if l.starts_with("fabric") { LoaderKind::Fabric } else { LoaderKind::Quilt };
        let mc = parent.clone().or_else(|| rest.rsplit_once('-').map(|(_, m)| m.to_string()))?;
        let lv = rest.strip_suffix(&format!("-{mc}")).map(str::to_string).or_else(|| rest.split('-').next().map(str::to_string));
        return Some((mc, Loader { kind, version: lv }));
    }
    if let Some(rest) = after("neoforge-") {
        return Some((parent?, Loader { kind: LoaderKind::Neoforge, version: Some(rest) }));
    }
    if let Some(pos) = l.find("-forge") {
        let mc = parent.unwrap_or_else(|| id[..pos].to_string());
        let tail = &id[pos + "-forge".len()..];
        let fv = tail.trim_start_matches('-').strip_prefix(&format!("{mc}-")).unwrap_or(tail.trim_start_matches('-')).to_string();
        return Some((mc, Loader { kind: LoaderKind::Forge, version: Some(fv).filter(|v| !v.is_empty()) }));
    }
    if parent.is_some() {
        return None;
    }
    let mc = v.get("id").and_then(|x| x.as_str()).unwrap_or(id).to_string();
    mc.chars().next().filter(|c| c.is_ascii_digit())?;
    Some((mc, Loader { kind: LoaderKind::Vanilla, version: None }))
}

pub fn guess(game: &Path, want: LoaderKind) -> Option<Guess> {
    let mut best: Option<Guess> = None;
    for e in std::fs::read_dir(game.join("versions")).ok()?.flatten() {
        let id = e.file_name().to_string_lossy().to_string();
        let json = e.path().join(format!("{id}.json"));
        let Ok(meta) = std::fs::metadata(&json) else { continue };
        if meta.len() > 8 * 1024 * 1024 {
            continue;
        }
        let Some(v) = std::fs::read(&json).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else { continue };
        let Some((mc, loader)) = parse(&id, &v) else { continue };
        let played = [e.path().join(format!("{id}.jar")), json].iter().filter_map(|p| std::fs::metadata(p).ok()?.modified().ok()).max().unwrap_or(SystemTime::UNIX_EPOCH);
        let better = match &best {
            None => true,
            Some(b) => (loader.kind == want, played) > (b.loader.kind == want, b.played),
        };
        if better {
            best = Some(Guess { mc, loader, played });
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_version(root: &Path, id: &str, json: &str) {
        let d = root.join("versions").join(id);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join(format!("{id}.json")), json).unwrap();
    }

    #[test]
    fn version_ids() {
        let p = |id: &str, j: &str| parse(id, &serde_json::from_str(j).unwrap());
        assert_eq!(p("fabric-loader-0.16.14-1.21.4", r#"{"inheritsFrom":"1.21.4"}"#), Some(("1.21.4".into(), Loader { kind: LoaderKind::Fabric, version: Some("0.16.14".into()) })));
        assert_eq!(p("quilt-loader-0.26.0-1.20.1", r#"{"inheritsFrom":"1.20.1"}"#).unwrap().1.kind, LoaderKind::Quilt);
        assert_eq!(p("1.20.1-forge-47.2.0", r#"{"inheritsFrom":"1.20.1"}"#), Some(("1.20.1".into(), Loader { kind: LoaderKind::Forge, version: Some("47.2.0".into()) })));
        assert_eq!(p("1.12.2-forge1.12.2-14.23.5.2860", r#"{"inheritsFrom":"1.12.2"}"#).unwrap().1.version.as_deref(), Some("14.23.5.2860"));
        assert_eq!(p("neoforge-21.1.77", r#"{"inheritsFrom":"1.21.1"}"#), Some(("1.21.1".into(), Loader { kind: LoaderKind::Neoforge, version: Some("21.1.77".into()) })));
        assert_eq!(p("1.21.11", r#"{"id":"1.21.11","type":"release"}"#), Some(("1.21.11".into(), Loader { kind: LoaderKind::Vanilla, version: None })));
        assert_eq!(p("OptiFine-irgendwas", r#"{"inheritsFrom":"1.20.1"}"#), None);
    }

    #[test]
    fn prefers_wanted_loader_then_newest() {
        let root = std::env::temp_dir().join(format!("vl-vanilla-{}", uuid::Uuid::new_v4()));
        write_version(&root, "1.21.11", r#"{"id":"1.21.11"}"#);
        write_version(&root, "fabric-loader-0.17.3-1.21.10", r#"{"inheritsFrom":"1.21.10"}"#);
        let g = guess(&root, LoaderKind::Fabric).unwrap();
        assert_eq!((g.mc.as_str(), g.loader.version.as_deref()), ("1.21.10", Some("0.17.3")));
        assert_eq!(guess(&root, LoaderKind::Vanilla).unwrap().mc, "1.21.11");
        assert!(guess(&root.join("leer"), LoaderKind::Vanilla).is_none());
        std::fs::remove_dir_all(&root).ok();
    }
}
