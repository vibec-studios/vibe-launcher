#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathKind {
    Mod,
    Config,
    Skip,
}

const CLIENT_DIRS: &[&str] = &[
    "resourcepacks",
    "shaderpacks",
    "screenshots",
    "saves",
    "logs",
    "crash-reports",
    "journeymap",
    "xaero",
    "xaerominimap",
    "xaeroworldmap",
    "replay_recordings",
    "schematics",
    "screenshots_backup",
    ".cache",
    ".fabric",
    "downloads",
];

const CLIENT_FILES: &[&str] = &[
    "options.txt",
    "optionsof.txt",
    "optionsshaders.txt",
    "options.amecsapi.txt",
    "servers.dat",
    "servers.dat_old",
    "realms_persistence.json",
    "launcher_profiles.json",
    "usercache.json",
    "usernamecache.json",
    "command_history.txt",
    "hotbar.nbt",
    "instance.cfg",
    "mmc-pack.json",
    "server.properties",
    "eula.txt",
    "ops.json",
    "whitelist.json",
    "banned-players.json",
    "banned-ips.json",
    "vibe-server.json",
    "vibe-addons.json",
    "vibe-pack.json",
];

pub const CONFIG_DIRS: &[&str] = &["config", "defaultconfigs", "kubejs", "scripts", "global_packs"];

pub fn classify(rel: &str) -> PathKind {
    let rel = rel.replace('\\', "/");
    let rel = rel.trim_start_matches("./").trim_start_matches('/');
    if rel.is_empty() || rel.split('/').any(|s| s == "..") {
        return PathKind::Skip;
    }
    let mut parts = rel.splitn(2, '/');
    let first = parts.next().unwrap_or("");
    let rest = parts.next();
    let lower = first.to_ascii_lowercase();
    match rest {
        None => {
            if CLIENT_FILES.contains(&lower.as_str()) || lower.ends_with(".log") {
                PathKind::Skip
            } else {
                PathKind::Config
            }
        }
        Some(r) => {
            if lower == "mods" {
                let f = r.to_ascii_lowercase();
                if !r.contains('/') && (f.ends_with(".jar") || f.ends_with(".jar.disabled")) { PathKind::Mod } else { PathKind::Config }
            } else if CLIENT_DIRS.contains(&lower.as_str()) {
                PathKind::Skip
            } else {
                PathKind::Config
            }
        }
    }
}

pub fn is_client_content(rel: &str) -> bool {
    let l = rel.replace('\\', "/").to_ascii_lowercase();
    l.starts_with("resourcepacks/") || l.starts_with("shaderpacks/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds() {
        assert_eq!(classify("mods/sodium.jar"), PathKind::Mod);
        assert_eq!(classify("mods/x.jar.disabled"), PathKind::Mod);
        assert_eq!(classify("mods/sub/notes.txt"), PathKind::Config);
        assert_eq!(classify("config/lithium.properties"), PathKind::Config);
        assert_eq!(classify("kubejs/server_scripts/a.js"), PathKind::Config);
        assert_eq!(classify("resourcepacks/pack.zip"), PathKind::Skip);
        assert_eq!(classify("shaderpacks/BSL.zip"), PathKind::Skip);
        assert_eq!(classify("options.txt"), PathKind::Skip);
        assert_eq!(classify("servers.dat"), PathKind::Skip);
        assert_eq!(classify("saves/World/level.dat"), PathKind::Skip);
        assert_eq!(classify("../evil"), PathKind::Skip);
        assert_eq!(classify("server.properties"), PathKind::Skip);
        assert_eq!(classify("icon.png"), PathKind::Config);
        assert!(is_client_content("resourcepacks/a.zip"));
        assert!(!is_client_content("mods/a.jar"));
    }
}
