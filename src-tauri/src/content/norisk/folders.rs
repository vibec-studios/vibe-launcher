use super::NrProfile;
use crate::instance::LoaderKind;

fn reserved(s: &str) -> bool {
    let stem = s.split('.').next().unwrap_or(s);
    matches!(stem, "con" | "prn" | "aux" | "nul")
        || ((stem.starts_with("com") || stem.starts_with("lpt")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit())
}

pub fn sanitize(name: &str) -> String {
    let s: String = name.chars().filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c)).collect();
    if s == "." || s == ".." || reserved(&s) {
        return String::new();
    }
    let s = s.trim_end_matches(['.', ' ']).to_string();
    s.chars().take(255).collect()
}

pub fn group_dir(group: &str) -> String {
    sanitize(&group.to_lowercase())
}

pub fn isolated_group(p: &NrProfile) -> bool {
    p.group.as_deref().is_some_and(|g| matches!(g.to_lowercase().as_str(), "server" | "modpacks"))
}

pub fn uses_shared(p: &NrProfile) -> bool {
    p.use_shared && !isolated_group(p)
}

pub fn own_mods_dir(p: &NrProfile) -> Option<String> {
    let loader = match LoaderKind::parse(&p.loader)? {
        LoaderKind::Fabric => "fabric",
        LoaderKind::Forge => "forge",
        LoaderKind::Neoforge => "neoforge",
        _ => return None,
    };
    let base = format!("nrc-{}-{loader}", p.game_version);
    if p.is_standard || !uses_shared(p) {
        return Some(base);
    }
    let id: String = p.id.chars().filter(|c| *c != '-').collect();
    let short: String = if id.chars().count() >= 4 { id.chars().take(2).chain(id.chars().skip(id.chars().count() - 2)).collect() } else { id.chars().take(4).collect() };
    Some(format!("{base}-{short}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn group_names_like_norisk() {
        assert_eq!(group_dir("Meine Gruppe"), "meine gruppe");
        assert_eq!(group_dir("PvP: Season 2?"), "pvp season 2");
        assert_eq!(group_dir("Freunde..."), "freunde");
        assert_eq!(group_dir(" Leer vorn"), " leer vorn");
        assert_eq!(group_dir("CON"), "");
    }

    #[test]
    fn mods_dir_suffix_from_profile_id() {
        let mut p = NrProfile { id: "4ab0c2d1-0000-4000-8000-0000000000e9".into(), game_version: "1.21.11".into(), loader: "fabric".into(), ..Default::default() };
        assert_eq!(own_mods_dir(&p).as_deref(), Some("nrc-1.21.11-fabric"));
        p.use_shared = true;
        p.group = Some("Freunde".into());
        assert_eq!(own_mods_dir(&p).as_deref(), Some("nrc-1.21.11-fabric-4ae9"));
        p.group = Some("SERVER".into());
        assert_eq!(own_mods_dir(&p).as_deref(), Some("nrc-1.21.11-fabric"), "isolierte Gruppe teilt nie");
        p.group = Some("Freunde".into());
        p.is_standard = true;
        assert_eq!(own_mods_dir(&p).as_deref(), Some("nrc-1.21.11-fabric"));
        p.loader = "quilt".into();
        assert_eq!(own_mods_dir(&p), None);
    }
}
