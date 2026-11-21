use super::*;

// ------------------------------------------------------------------ Mapping

pub fn class_id(t: ProjectType) -> u32 {
    match t {
        ProjectType::Mod => CLASS_MODS,
        ProjectType::Modpack => CLASS_MODPACKS,
        ProjectType::Resourcepack => CLASS_RESOURCEPACKS,
        ProjectType::Shader => CLASS_SHADERS,
        ProjectType::Datapack => CLASS_DATAPACKS,
    }
}

pub fn project_type_of_class(c: Option<u32>) -> ProjectType {
    match c {
        Some(CLASS_MODPACKS) => ProjectType::Modpack,
        Some(CLASS_RESOURCEPACKS) => ProjectType::Resourcepack,
        Some(CLASS_SHADERS) => ProjectType::Shader,
        Some(CLASS_DATAPACKS) => ProjectType::Datapack,
        _ => ProjectType::Mod,
    }
}

/// Zielordner für eine CurseForge-Klasse (Import von Modpacks).
pub fn kind_of_class(c: Option<u32>) -> ContentKind {
    match c {
        Some(CLASS_RESOURCEPACKS) => ContentKind::Resourcepack,
        Some(CLASS_SHADERS) => ContentKind::Shader,
        Some(CLASS_DATAPACKS) => ContentKind::Datapack,
        _ => ContentKind::Mod,
    }
}

pub fn sort_field(s: SortOrder, has_query: bool) -> u32 {
    // 1 Featured, 2 Popularity, 3 LastUpdated, 4 Name, 5 Author, 6 TotalDownloads, 11 ReleasedDate, 12 Rating
    match s {
        SortOrder::Relevance => {
            if has_query {
                1
            } else {
                2
            }
        }
        SortOrder::Downloads => 6,
        SortOrder::Follows => 12,
        SortOrder::Newest => 11,
        SortOrder::Updated => 3,
    }
}

pub fn mod_loader_types(l: LoaderKind) -> Vec<u32> {
    match l {
        LoaderKind::Vanilla => vec![],
        LoaderKind::Forge => vec![ML_FORGE],
        LoaderKind::Fabric => vec![ML_FABRIC],
        LoaderKind::Quilt => vec![ML_QUILT, ML_FABRIC],
        LoaderKind::Neoforge => vec![ML_NEOFORGE],
    }
}

pub fn loader_name(ml: u32) -> Option<&'static str> {
    Some(match ml {
        ML_FORGE => "forge",
        3 => "liteloader",
        ML_FABRIC => "fabric",
        ML_QUILT => "quilt",
        ML_NEOFORGE => "neoforge",
        _ => return None,
    })
}

/// Sortierschlüssel für Versionen wie "1.20.1" / "26.3".
pub(super) fn version_key(s: &str) -> Vec<u64> {
    s.split(['.', '-']).map(|p| p.parse().unwrap_or(0)).collect()
}

pub(super) fn is_mc_version(s: &str) -> bool {
    let s = s.strip_suffix("-Snapshot").unwrap_or(s);
    let parts: Vec<&str> = s.split('.').collect();
    (2..=3).contains(&parts.len()) && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// `gameVersions` einer Datei in (Minecraft-Versionen, Loader) aufteilen.
pub fn split_game_versions(gv: &[String]) -> (Vec<String>, Vec<String>) {
    let mut mc = Vec::new();
    let mut loaders = Vec::new();
    for v in gv {
        let lower = v.to_ascii_lowercase();
        match lower.as_str() {
            "forge" | "fabric" | "quilt" | "neoforge" | "liteloader" => loaders.push(lower),
            _ if is_mc_version(v) => mc.push(v.clone()),
            _ => {}
        }
    }
    (mc, loaders)
}
