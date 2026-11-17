//! Client/Server-Einordnung von Mods für „Server aus Instanz“.
//!
//! Einziger Einstiegspunkt ist [`classify`]. Sobald das Content-Modul eine eigene Einordnung anbietet
//! (z. B. `content::sides::classify` mit Modrinth-Metadaten), wird sie hier eingebunden – bis dahin eine
//! Heuristik über die Metadaten im JAR (fabric.mod.json, quilt.mod.json, mods.toml).
use serde::Serialize;
use std::io::Read;
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ModSide {
    Both,
    Client,
    Server,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerModCandidate {
    pub file_name: String,
    pub name: Option<String>,
    pub side: ModSide,
    pub enabled: bool,
    pub server_ok: bool,
}

/// Bekannte reine Client-Mods (Mod-IDs), falls die Metadaten es nicht verraten.
const CLIENT_ONLY_IDS: &[&str] = &[
    "sodium", "iris", "oculus", "embeddium", "rubidium", "optifine", "optifabric", "modmenu", "lambdynlights", "dynamiclights",
    "continuity", "entityculling", "betterf3", "zoomify", "okzoomer", "ok_zoomer", "logical_zoom", "appleskin_client", "mousetweaks",
    "controlling", "jeiintegration_client", "fpsreducer", "dynamic_fps", "dynamicfps", "betterbeds", "cull_leaves", "cullleaves",
    "reeses_sodium_options", "reeses-sodium-options", "sodium-extra", "sodium_extra", "indium", "immediatelyfast", "chat_heads",
    "chatheads", "skinlayers3d", "3dskinlayers", "notenoughanimations", "fallingleaves", "legendarytooltips", "itemphysiclite",
    "nvidium", "xaerominimap", "xaeroworldmap", "journeymap_client", "replaymod", "freecam", "enhancedblockentities", "ebe",
    "particlerain", "visuality", "effective", "lambdabettergrass", "presencefootsteps", "shulkerboxtooltip_client", "torohealth",
    "betterpingdisplay", "borderlessmining", "fastquit", "smoothboot", "ferritecore_client", "cit", "citresewn", "entitytexturefeatures",
    "entity_texture_features", "entity_model_features", "puzzle", "yet_another_config_lib_client", "craftpresence", "wthit_client",
    "jade_client", "blur", "resourcepackoverrides", "fancymenu", "drippyloadingscreen", "konkrete_client", "loadingscreen",
];

fn read_entry(z: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Option<String> {
    let mut e = z.by_name(name).ok()?;
    let mut s = String::new();
    e.read_to_string(&mut s).ok()?;
    Some(s)
}

fn json_side(env: Option<&serde_json::Value>) -> Option<ModSide> {
    match env?.as_str()? {
        "client" => Some(ModSide::Client),
        "server" => Some(ModSide::Server),
        "*" => Some(ModSide::Both),
        _ => None,
    }
}

/// Heuristik über die Mod-Metadaten. Liefert (Seite, Anzeigename).
fn classify_jar(path: &Path) -> (ModSide, Option<String>) {
    let Ok(f) = std::fs::File::open(path) else { return (ModSide::Unknown, None) };
    let Ok(mut z) = zip::ZipArchive::new(f) else { return (ModSide::Unknown, None) };
    let mut ids: Vec<String> = Vec::new();
    let mut name = None;
    let mut side = None;

    if let Some(s) = read_entry(&mut z, "fabric.mod.json") {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
            name = v["name"].as_str().map(str::to_string);
            if let Some(id) = v["id"].as_str() {
                ids.push(id.to_string());
            }
            side = json_side(v.get("environment")).or(Some(ModSide::Both));
        }
    }
    if let Some(s) = read_entry(&mut z, "quilt.mod.json") {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
            let ql = &v["quilt_loader"];
            name = name.or_else(|| ql["metadata"]["name"].as_str().map(str::to_string));
            if let Some(id) = ql["id"].as_str() {
                ids.push(id.to_string());
            }
            let env = v["minecraft"]["environment"].as_str().or_else(|| ql["minecraft"]["environment"].as_str());
            side = match env {
                Some("client") => Some(ModSide::Client),
                Some("dedicated_server") | Some("server") => Some(ModSide::Server),
                _ => side.or(Some(ModSide::Both)),
            };
        }
    }
    for toml_name in ["META-INF/neoforge.mods.toml", "META-INF/mods.toml"] {
        if side.is_some() && !ids.is_empty() {
            break;
        }
        let Some(s) = read_entry(&mut z, toml_name) else { continue };
        let Ok(v) = s.parse::<toml::Table>() else { continue };
        if let Some(mods) = v.get("mods").and_then(|m| m.as_array()) {
            for m in mods {
                if let Some(id) = m.get("modId").and_then(|x| x.as_str()) {
                    ids.push(id.to_string());
                }
                if name.is_none() {
                    name = m.get("displayName").and_then(|x| x.as_str()).map(str::to_string);
                }
            }
        }
        let client_only = v.get("clientSideOnly").and_then(|x| x.as_bool()).unwrap_or(false);
        // Abhängigkeit von minecraft/forge/neoforge nur auf der Client-Seite => Client-Mod
        let mut dep_client = false;
        if let Some(deps) = v.get("dependencies").and_then(|d| d.as_table()) {
            for list in deps.values().filter_map(|l| l.as_array()) {
                for d in list {
                    let id = d.get("modId").and_then(|x| x.as_str()).unwrap_or_default();
                    let dside = d.get("side").and_then(|x| x.as_str()).unwrap_or("BOTH");
                    if ["minecraft", "forge", "neoforge"].contains(&id) && dside.eq_ignore_ascii_case("CLIENT") {
                        dep_client = true;
                    }
                }
            }
        }
        side = Some(if client_only || dep_client { ModSide::Client } else { ModSide::Unknown });
    }
    let mut side = side.unwrap_or(ModSide::Unknown);
    if side != ModSide::Client && ids.iter().any(|id| CLIENT_ONLY_IDS.contains(&id.to_ascii_lowercase().as_str())) {
        side = ModSide::Client;
    }
    (side, name)
}

/// Einordnung einer Mod-Datei (blockierend).
pub fn classify(path: &Path) -> (ModSide, Option<String>) {
    let file = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_ascii_lowercase();
    let (mut side, name) = classify_jar(path);
    if side == ModSide::Unknown {
        let stem = file.split(['-', '_', '+']).next().unwrap_or_default();
        if CLIENT_ONLY_IDS.contains(&stem) || file.starts_with("optifine") {
            side = ModSide::Client;
        }
    }
    (side, name)
}

/// Mods einer Instanz (mods/*.jar und *.jar.disabled) mit Einordnung.
pub fn candidates(mods_dir: &Path) -> Vec<ServerModCandidate> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(mods_dir) else { return out };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let lower = name.to_ascii_lowercase();
        let enabled = lower.ends_with(".jar");
        if !(enabled || lower.ends_with(".jar.disabled")) || !e.path().is_file() {
            continue;
        }
        let (side, display) = classify(&e.path());
        let server_ok = enabled && side != ModSide::Client;
        out.push(ServerModCandidate { file_name: name, name: display, side, enabled, server_ok });
    }
    out.sort_by_key(|m| m.file_name.to_lowercase());
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn jar(dir: &Path, name: &str, files: &[(&str, &str)]) -> std::path::PathBuf {
        let p = dir.join(name);
        let f = std::fs::File::create(&p).unwrap();
        let mut z = zip::ZipWriter::new(f);
        for (n, c) in files {
            z.start_file(*n, zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(c.as_bytes()).unwrap();
        }
        z.finish().unwrap();
        p
    }

    #[test]
    fn heuristics() {
        let dir = std::env::temp_dir().join(format!("vibe-sides-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = jar(&dir, "a.jar", &[("fabric.mod.json", r#"{"id":"x","name":"X","environment":"client"}"#)]);
        assert_eq!(classify(&a), (ModSide::Client, Some("X".into())));
        let b = jar(&dir, "b.jar", &[("fabric.mod.json", r#"{"id":"lithium","name":"Lithium","environment":"*"}"#)]);
        assert_eq!(classify(&b).0, ModSide::Both);
        let c = jar(&dir, "c.jar", &[("fabric.mod.json", r#"{"id":"modmenu","name":"Mod Menu"}"#)]);
        assert_eq!(classify(&c).0, ModSide::Client);
        let d = jar(&dir, "d.jar", &[("META-INF/mods.toml", "clientSideOnly=true\n[[mods]]\nmodId=\"foo\"\n")]);
        assert_eq!(classify(&d).0, ModSide::Client);
        let e = jar(
            &dir,
            "e.jar",
            &[("META-INF/mods.toml", "[[mods]]\nmodId=\"bar\"\n[[dependencies.bar]]\nmodId=\"minecraft\"\nside=\"BOTH\"\n")],
        );
        assert_eq!(classify(&e).0, ModSide::Unknown);
        let list = candidates(&dir);
        assert_eq!(list.len(), 5);
        assert!(!list.iter().find(|m| m.file_name == "a.jar").unwrap().server_ok);
        assert!(list.iter().find(|m| m.file_name == "e.jar").unwrap().server_ok);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
