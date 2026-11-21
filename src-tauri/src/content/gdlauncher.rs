use super::external::{found, Found};
use super::extsettings::ExtSettings;
use crate::instance::{Loader, LoaderKind, PackSource, PackSourceKind};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub const LEGACY_SKIP: &[&str] = &["config.json", "config.bak.json", "config_new_temp.json", "manifest.json", "installing.lock", "natives"];

fn read_override(f: &Path) -> Option<PathBuf> {
    let t = std::fs::read_to_string(f).ok()?;
    let p = PathBuf::from(t.trim());
    p.is_dir().then_some(p)
}

pub fn carbon_instances(app: &Path) -> PathBuf {
    read_override(&app.join("runtime_path_override")).unwrap_or_else(|| app.join("data")).join("instances")
}

pub fn legacy_instances(app: &Path) -> PathBuf {
    read_override(&app.join("override.data")).unwrap_or_else(|| app.to_path_buf()).join("instances")
}

pub fn roots() -> Vec<(bool, PathBuf)> {
    let mut v = Vec::new();
    if let Some(d) = dirs::data_dir() {
        v.push((true, carbon_instances(&d.join("gdlauncher_carbon"))));
    }
    if let Some(c) = if cfg!(target_os = "linux") { dirs::config_dir() } else { dirs::data_dir() } {
        v.push((false, legacy_instances(&c.join("gdlauncher_next"))));
    }
    v.into_iter().filter(|(_, p)| p.is_dir()).collect()
}

fn st(v: Option<&Value>) -> Option<String> {
    v.and_then(|x| x.as_str()).map(str::to_string).filter(|s| !s.trim().is_empty())
}

fn id(v: Option<&Value>) -> Option<String> {
    v.and_then(|x| x.as_str().map(str::to_string).or_else(|| x.as_u64().map(|n| n.to_string()))).filter(|s| !s.is_empty())
}

fn num(v: Option<&Value>) -> Option<u32> {
    v.and_then(|x| x.as_u64()).and_then(|n| u32::try_from(n).ok()).filter(|n| *n > 0)
}

fn loader_kind(t: &str) -> LoaderKind {
    LoaderKind::parse(&t.to_lowercase()).unwrap_or(LoaderKind::Vanilla)
}

fn json(p: &Path) -> Option<Value> {
    let m = std::fs::metadata(p).ok()?;
    if m.len() == 0 || m.len() > 16 * 1024 * 1024 {
        return None;
    }
    serde_json::from_slice(&std::fs::read(p).ok()?).ok()
}

fn resolution(s: &str) -> Option<(u32, u32)> {
    let (_, wh) = s.split_once(':')?;
    let (w, h) = wh.split_once('x')?;
    Some((w.trim().parse().ok()?, h.trim().parse().ok()?))
}

pub fn carbon_one(dir: &Path) -> Option<Found> {
    let v = json(&dir.join("instance.json")).filter(|v| v.get("_version").is_some() || v.get("game_configuration").is_some())?;
    let name = st(v.get("name")).or_else(|| dir.file_name().map(|n| n.to_string_lossy().to_string()))?;
    let gc = v.get("game_configuration");
    let ver = gc.and_then(|g| g.get("version"));
    let (mc, loader) = match ver {
        Some(Value::String(s)) => (s.clone(), Loader { kind: LoaderKind::Vanilla, version: None }),
        Some(o) => {
            let ml = o.get("modloaders").and_then(|m| m.as_array()).and_then(|a| a.first());
            let kind = ml.and_then(|m| st(m.get("type"))).map(|t| loader_kind(&t)).unwrap_or(LoaderKind::Vanilla);
            let mc = st(o.get("release")).unwrap_or_default();
            let lv = ml.and_then(|m| st(m.get("version"))).map(|v| v.strip_prefix(&format!("{mc}-")).map(str::to_string).unwrap_or(v));
            (mc, Loader { kind, version: lv.filter(|_| kind != LoaderKind::Vanilla) })
        }
        None => (String::new(), Loader { kind: LoaderKind::Vanilla, version: None }),
    };
    let icon = st(v.get("icon")).map(|i| dir.join(i)).filter(|p| p.is_file() && p.starts_with(dir));
    let mut f = found(name.clone(), dir.join("instance"), dir, mc, loader, icon);
    f.info.last_played = st(v.get("last_played")).and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok()).map(|d| d.timestamp_millis());
    f.info.play_time_secs = v.get("seconds_played").and_then(|x| x.as_u64()).filter(|s| *s > 0);
    if let Some(mp) = v.get("modpack").filter(|m| m.is_object()) {
        let (kind, ver) = match st(mp.get("platform")).as_deref() {
            Some("Curseforge") => (PackSourceKind::Curseforge, id(mp.get("file_id"))),
            Some("Modrinth") => (PackSourceKind::Modrinth, id(mp.get("version_id"))),
            _ => (PackSourceKind::Local, None),
        };
        if kind != PackSourceKind::Local {
            f.pack = Some(PackSource { kind, project_id: id(mp.get("project_id")), version_id: ver, name: Some(name), version_name: None });
        }
    }
    let mut s = ExtSettings::default();
    if let Some(m) = gc.and_then(|g| g.get("memory")) {
        s.min_memory_mb = num(m.get("min_mb"));
        s.max_memory_mb = num(m.get("max_mb"));
    }
    s.jvm_args = gc.and_then(|g| st(g.get("extra_java_args")));
    s.java_path = gc.and_then(|g| g.get("java_override")).and_then(|j| st(j.get("Path")));
    if let Some((w, h)) = gc.and_then(|g| st(g.get("game_resolution"))).and_then(|r| resolution(&r)) {
        (s.width, s.height) = (Some(w), Some(h));
    }
    s.pre_launch = gc.and_then(|g| st(g.get("pre_launch_hook")));
    s.post_exit = gc.and_then(|g| st(g.get("post_exit_hook")));
    s.wrapper = gc.and_then(|g| st(g.get("wrapper_command")));
    s.notes = st(v.get("notes"));
    f.settings = s;
    Some(f)
}

fn slate_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().map(slate_text).filter(|t| !t.is_empty()).collect::<Vec<_>>().join("\n"),
        Value::Object(o) => match o.get("text") {
            Some(Value::String(t)) => t.clone(),
            _ => o.get("children").map(slate_text).unwrap_or_default(),
        },
        _ => String::new(),
    }
}

pub fn legacy_one(dir: &Path) -> Option<Found> {
    let v = json(&dir.join("config.json")).or_else(|| json(&dir.join("config.bak.json")))?;
    let l = v.get("loader").filter(|l| l.is_object())?;
    let name = dir.file_name()?.to_string_lossy().to_string();
    let mc = st(l.get("mcVersion")).unwrap_or_default();
    let kind = st(l.get("loaderType")).map(|t| loader_kind(&t)).unwrap_or(LoaderKind::Vanilla);
    let lv = st(l.get("loaderVersion")).map(|v| v.strip_prefix(&format!("{mc}-")).map(str::to_string).unwrap_or(v)).filter(|_| kind != LoaderKind::Vanilla);
    let icon = st(v.get("background")).filter(|b| !b.contains(['/', '\\'])).map(|b| dir.join(b)).filter(|p| p.is_file());
    let mut f = found(name.clone(), dir.to_path_buf(), dir, mc, Loader { kind, version: lv }, icon);
    f.info.last_played = v.get("lastPlayed").and_then(|x| x.as_i64()).filter(|t| *t > 0);
    f.info.play_time_secs = v.get("timePlayed").and_then(|x| x.as_u64()).filter(|t| *t > 0).map(|m| m * 60);
    let pid = id(l.get("projectID")).or_else(|| id(l.get("addonID"))).or_else(|| id(l.get("addonId")));
    if pid.is_some() && st(l.get("source")).is_none_or(|s| s.eq_ignore_ascii_case("curseforge")) {
        let fid = id(l.get("fileID")).or_else(|| id(l.get("fileId")));
        f.pack = Some(PackSource { kind: PackSourceKind::Curseforge, project_id: pid, version_id: fid, name: st(l.get("sourceName")).or(Some(name)), version_name: None });
    }
    let mut s = ExtSettings { max_memory_mb: num(v.get("javaMemory")), jvm_args: st(v.get("javaArgs")), java_path: st(v.get("customJavaPath")), ..Default::default() };
    if let Some(r) = v.get("resolution") {
        (s.width, s.height) = (num(r.get("width")), num(r.get("height")));
    }
    s.notes = v.get("notes").map(slate_text).filter(|t| !t.trim().is_empty());
    f.settings = s;
    Some(f)
}

pub fn scan(instances: &Path, carbon: bool) -> Vec<Found> {
    let Ok(rd) = std::fs::read_dir(instances) else { return vec![] };
    rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).filter_map(|d| if carbon { carbon_one(&d) } else { legacy_one(&d) }).collect()
}

pub fn one(dir: &Path) -> Option<Found> {
    carbon_one(dir).or_else(|| legacy_one(dir))
}

pub fn skip_top(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    LEGACY_SKIP.iter().any(|s| s.eq_ignore_ascii_case(name)) || l.starts_with("background.")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("vl-gdl-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn carbon_instance() {
        let root = tmp();
        let d = root.join("instances/My Pack");
        std::fs::create_dir_all(d.join("instance/mods")).unwrap();
        std::fs::write(d.join("instance/mods/a.jar"), "x").unwrap();
        std::fs::write(d.join("instance/mods/b.jar.disabled"), "x").unwrap();
        std::fs::write(
            d.join("instance.json"),
            r#"{"_version":"1","name":"Mein Pack","icon":null,"last_played":"2025-03-02T08:30:00.123Z","seconds_played":7260,
                "modpack":{"platform":"Curseforge","project_id":123456,"file_id":4567890,"locked":true},
                "game_configuration":{"version":{"release":"1.20.1","modloaders":[{"type":"Forge","version":"47.2.0"}]},"global_java_args":true,
                "extra_java_args":"-XX:+UseG1GC","memory":{"min_mb":1024,"max_mb":6144},"game_resolution":"custom:1600x900","java_override":{"Path":"C:\\Java\\bin\\java.exe"}},"notes":""}"#,
        )
        .unwrap();
        let f = scan(&root.join("instances"), true).pop().unwrap();
        assert_eq!(f.info.name, "Mein Pack");
        assert_eq!(f.info.mc_version, "1.20.1");
        assert_eq!(f.info.loader, Loader { kind: LoaderKind::Forge, version: Some("47.2.0".into()) });
        assert_eq!(f.game_dir, d.join("instance"));
        assert_eq!(f.info.mod_count, 2);
        assert_eq!(f.info.play_time_secs, Some(7260));
        assert!(f.info.last_played.is_some());
        assert_eq!(f.pack.as_ref().map(|p| (p.kind, p.project_id.clone(), p.version_id.clone())), Some((PackSourceKind::Curseforge, Some("123456".into()), Some("4567890".into()))));
        assert_eq!((f.settings.min_memory_mb, f.settings.max_memory_mb), (Some(1024), Some(6144)));
        assert_eq!((f.settings.width, f.settings.height), (Some(1600), Some(900)));
        assert_eq!(f.settings.jvm_args.as_deref(), Some("-XX:+UseG1GC"));
        assert!(f.settings.java_path.is_some());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn legacy_instance() {
        let root = tmp();
        let d = root.join("instances/Alt");
        std::fs::create_dir_all(d.join("mods")).unwrap();
        std::fs::write(
            d.join("config.json"),
            r#"{"loader":{"loaderType":"forge","mcVersion":"1.20.1","loaderVersion":"1.20.1-47.2.0","fileID":4567890,"projectID":123456,"source":"curseforge","sourceName":"Some Modpack"},
                "timePlayed":121,"lastPlayed":1709373000123,"javaMemory":6144,"javaArgs":"-XX:+UseG1GC","resolution":{"width":1600,"height":900},
                "notes":[{"type":"paragraph","children":[{"text":"Hallo"}]}],"mods":[]}"#,
        )
        .unwrap();
        let f = one(&d).unwrap();
        assert_eq!(f.info.loader, Loader { kind: LoaderKind::Forge, version: Some("47.2.0".into()) });
        assert_eq!(f.game_dir, d);
        assert_eq!(f.info.play_time_secs, Some(121 * 60));
        assert_eq!(f.info.last_played, Some(1_709_373_000_123));
        assert_eq!(f.pack.as_ref().and_then(|p| p.name.clone()).as_deref(), Some("Some Modpack"));
        assert_eq!(f.settings.max_memory_mb, Some(6144));
        assert_eq!(f.settings.notes.as_deref(), Some("Hallo"));
        assert!(skip_top("config.json") && skip_top("background.png") && skip_top("natives") && !skip_top("saves"));
        let atl = root.join("atl");
        std::fs::create_dir_all(&atl).unwrap();
        std::fs::write(atl.join("instance.json"), r#"{"id":"1.20.4","launcher":{"name":"ATL"}}"#).unwrap();
        assert!(carbon_one(&atl).is_none(), "ATLauncher-Instanz ist keine GDLauncher-Instanz");
        std::fs::remove_dir_all(&root).ok();
    }
}
