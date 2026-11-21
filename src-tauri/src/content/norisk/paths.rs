use super::*;

pub(super) fn skip_top(name: &str) -> bool {
    crate::content::gamedata::skip_top(crate::content::LauncherKind::Norisk, crate::content::gamedata::Purpose::Import, name)
}

pub fn default_root() -> Option<PathBuf> {
    let d = dirs::data_dir()?;
    Some(if cfg!(windows) {
        d.join("norisk").join("NoRiskClientV3")
    } else if cfg!(target_os = "macos") {
        d.join("gg.norisk.NoRiskClientV3")
    } else {
        d.join("noriskclientv3")
    })
}

pub fn roots() -> Vec<PathBuf> {
    default_root().into_iter().filter(|r| is_root(r)).collect()
}

pub fn is_root(r: &Path) -> bool {
    r.join("meta").join("app.db").is_file() || r.join("profiles.json").is_file() || r.join("norisk_modpacks.json").is_file()
}

pub fn profiles_dir(root: &Path) -> PathBuf {
    profiles_dir_with(root, global::read(root).custom_dir.as_deref())
}

pub(super) fn profiles_dir_with(root: &Path, custom: Option<&Path>) -> PathBuf {
    if let Some(c) = custom.filter(|c| c.join("profiles").is_dir()) {
        return c.join("profiles");
    }
    if root.join("data").join("profiles").is_dir() || cfg!(windows) {
        root.join("data").join("profiles")
    } else {
        root.join("profiles")
    }
}

#[derive(Debug, Clone, Default)]
pub struct NrRoot {
    pub profiles: Vec<NrProfile>,
    pub meta: PathBuf,
    pub sync: sync::SyncDb,
}

pub fn read_root(root: &Path, custom: Option<&Path>, tmp: &Path) -> AppResult<NrRoot> {
    let mut dbs = vec![root.join("meta")];
    if let Some(c) = custom {
        dbs.push(c.join("meta"));
        dbs.push(c.to_path_buf());
    }
    for d in dbs {
        if d.join("app.db").is_file() {
            if let Some(c) = crate::content::external::open_db_copy_named(&d, tmp, "norisk-db") {
                let mut profiles = read_db(&c)?;
                standard::merge(root, &mut profiles);
                return Ok(NrRoot { profiles, sync: sync::read(&c), meta: data_meta(root, custom) });
            }
        }
    }
    let mut profiles = match std::fs::read(root.join("profiles.json")) {
        Ok(b) => read_json(&b)?,
        Err(_) => vec![],
    };
    standard::merge(root, &mut profiles);
    Ok(NrRoot { profiles, meta: data_meta(root, custom), sync: Default::default() })
}

pub(super) fn data_meta(root: &Path, custom: Option<&Path>) -> PathBuf {
    custom.filter(|c| c.is_dir()).map(Path::to_path_buf).unwrap_or_else(|| root.join("meta"))
}

pub fn read_profiles(root: &Path, tmp: &Path) -> AppResult<Vec<NrProfile>> {
    Ok(read_root(root, global::read(root).custom_dir.as_deref(), tmp)?.profiles)
}

// ------------------------------------------------------------------ Spielordner

pub(super) fn is_legacy(mc: &str) -> bool {
    let mut it = mc.split('.').map(|x| x.parse::<u32>().unwrap_or(0));
    matches!((it.next(), it.next()), (Some(1), Some(minor)) if minor < 13)
}

pub fn game_dir(profiles: &Path, p: &NrProfile) -> PathBuf {
    if folders::uses_shared(p) {
        if let Some(g) = &p.group {
            let gl = g.to_lowercase();
            if gl == "nrc" || gl == "noriskclient" || gl == "norisk client" {
                return profiles.join("noriskclient").join(if is_legacy(&p.game_version) { "legacy" } else { "new" });
            }
            return profiles.join("groups").join(folders::group_dir(g));
        }
    }
    let mut d = profiles.to_path_buf();
    for seg in p.path.split('/').filter(|s| !s.is_empty() && *s != "..") {
        d.push(seg);
    }
    d
}
