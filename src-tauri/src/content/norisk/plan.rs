use super::*;

// ------------------------------------------------------------------ Plan + Scan

#[derive(Debug, Clone, PartialEq)]
pub struct PlanMod {
    pub source: Source,
    pub project_id: String,
    pub version_id: Option<String>,
    pub enabled: bool,
    pub name: String,
    pub cache: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanJar {
    pub path: PathBuf,
    pub name: String,
    pub mod_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Plan {
    pub profile_id: String,
    pub mods: Vec<PlanMod>,
    pub skipped: Vec<String>,
    pub jars: Vec<PlanJar>,
    pub group: Option<String>,
    pub banner: Option<Banner>,
    pub description: Option<String>,
    pub sync_packs: Vec<String>,
    pub unfit: Vec<String>,
}

impl Plan {
    pub(super) fn add_mod(&mut self, m: PlanMod) {
        if !self.mods.iter().any(|x| x.source == m.source && x.project_id == m.project_id) {
            self.mods.push(m);
        }
    }

    pub(super) fn add_jar(&mut self, j: PlanJar) {
        let dup = self.jars.iter().any(|x| x.name.eq_ignore_ascii_case(&j.name) || (x.mod_id.is_some() && x.mod_id == j.mod_id));
        if !dup {
            self.jars.push(j);
        }
    }

    pub fn count(&self, s: Source) -> usize {
        self.mods.iter().filter(|m| m.source == s).count()
    }
}

pub(super) fn is_nrc_id(id: &str) -> bool {
    let l = id.to_ascii_lowercase();
    l.starts_with("nrc") || l.starts_with("norisk")
}

pub enum JarClass {
    Fits(Option<String>),
    Norisk(String),
    Unfit,
}

pub fn jar_class(f: &Path, name: &str, mc: &str, loader: LoaderKind, icons: &Path) -> JarClass {
    let lower = name.to_ascii_lowercase();
    let meta = crate::content::meta::read_entry(f, ContentKind::Mod, icons);
    let id = meta.mod_id.clone().unwrap_or_default();
    if is_nrc_id(&id) || lower.starts_with("nrc-") || lower.starts_with("norisk") {
        return JarClass::Norisk(meta.name.clone().unwrap_or_else(|| name.to_string()));
    }
    let loader_ok = match meta.loader.as_deref().and_then(LoaderKind::parse) {
        Some(l) => l == loader || (loader == LoaderKind::Quilt && l == LoaderKind::Fabric),
        None => true,
    };
    let mc_ok = meta.deps.iter().find(|d| d.id == "minecraft").and_then(|d| d.range.as_deref()).and_then(|r| deps::satisfies(r, mc)).unwrap_or(true);
    if loader_ok && mc_ok {
        JarClass::Fits(meta.mod_id.filter(|m| !m.is_empty()))
    } else {
        JarClass::Unfit
    }
}

pub(super) fn mod_dirs(game: &Path, nrc: Option<&str>) -> Vec<PathBuf> {
    let mut v = vec![game.join("mods"), game.join("custom_mods")];
    if let Some(n) = nrc {
        let found = std::fs::read_dir(game.join("mods")).into_iter().flatten().flatten().map(|e| e.path()).find(|p| p.is_dir() && p.file_name().is_some_and(|f| f.to_string_lossy().eq_ignore_ascii_case(n)));
        v.push(found.unwrap_or_else(|| game.join("mods").join(n)));
    }
    v
}

pub struct Loose {
    pub jars: Vec<PlanJar>,
    pub norisk: Vec<String>,
    pub unfit: Vec<String>,
}

pub fn loose_jars(game: &Path, nrc: Option<&str>, mc: &str, loader: LoaderKind, icons: &Path, known: &HashSet<String>) -> Loose {
    let mut ok: Vec<PlanJar> = Vec::new();
    let mut skipped = Vec::new();
    let mut unfit = Vec::new();
    let mut seen = HashSet::new();
    for dir in mod_dirs(game, nrc) {
        let Ok(rd) = std::fs::read_dir(dir) else { continue };
        let mut files: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_file()).collect();
        files.sort();
        for f in files {
            let name = f.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let lower = name.to_ascii_lowercase();
            let base = lower.trim_end_matches(".disabled").to_string();
            if !(lower.ends_with(".jar") || lower.ends_with(".jar.disabled")) || known.contains(&base) || !seen.insert(base) {
                continue;
            }
            match jar_class(&f, &name, mc, loader, icons) {
                JarClass::Fits(mod_id) => {
                    if mod_id.is_none() || !ok.iter().any(|j| j.mod_id == mod_id) {
                        ok.push(PlanJar { path: f, name, mod_id });
                    }
                }
                JarClass::Norisk(n) => skipped.push(n),
                JarClass::Unfit => unfit.push(name),
            }
        }
    }
    Loose { jars: ok, norisk: skipped, unfit }
}

pub(super) fn mod_name(m: &NrMod) -> String {
    m.name.clone().or_else(|| m.file_name.clone()).or_else(|| m.project_id.clone()).unwrap_or_default()
}

pub(super) fn profile_mod(m: &NrMod, cache: &cache::ModCache) -> Option<PlanMod> {
    let source = match m.source_type.as_str() {
        "modrinth" => Source::Modrinth,
        "curse_forge" | "curseforge" => Source::Curseforge,
        _ => return None,
    };
    Some(PlanMod { source, project_id: m.project_id.clone()?, version_id: m.version_id.clone(), enabled: m.enabled, name: mod_name(m), cache: cache.file(m.file_name.as_deref()) })
}

pub(super) fn url_mod(plan: &mut Plan, m: &NrMod, cache: &cache::ModCache) {
    match cache.file(m.file_override.as_deref().or(m.file_name.as_deref())) {
        Some(path) => {
            let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let name = if m.enabled { name } else { format!("{name}.disabled") };
            plan.add_jar(PlanJar { path, name, mod_id: None });
        }
        None => plan.skipped.push(mod_name(m)),
    }
}

pub fn plan_for(p: &NrProfile, packs: &Value, game: &Path, icons: &Path, cache: &cache::ModCache) -> Plan {
    let mut plan = Plan { profile_id: p.id.clone(), group: p.group.clone(), description: p.description.clone(), ..Default::default() };
    let mut known: HashSet<String> = HashSet::new();
    let loader = LoaderKind::parse(&p.loader).unwrap_or(LoaderKind::Vanilla);
    for m in &p.mods {
        match profile_mod(m, cache) {
            Some(pm) => {
                known.extend([&m.file_name, &m.file_override].into_iter().flatten().map(|f| f.to_ascii_lowercase()));
                plan.add_mod(pm);
            }
            None if m.source_type == "url" && loader != LoaderKind::Vanilla => {
                known.extend([&m.file_name, &m.file_override].into_iter().flatten().map(|f| f.to_ascii_lowercase()));
                url_mod(&mut plan, m, cache);
            }
            None if matches!(m.source_type.as_str(), "maven" | "embedded") => plan.skipped.push(mod_name(m)),
            None => {}
        }
    }
    for pm in pack_mods(packs, p) {
        match pm {
            PackMod::Modrinth { project_id, version_id, name, id } => {
                let file = cache.pack_file(packs, &id, &p.game_version, &p.loader);
                plan.add_mod(PlanMod { source: Source::Modrinth, project_id, version_id: Some(version_id), enabled: true, name, cache: file });
            }
            PackMod::Skipped { name, .. } => plan.skipped.push(name),
        }
    }
    if loader != LoaderKind::Vanilla {
        let nrc = folders::own_mods_dir(p);
        let loose = loose_jars(game, nrc.as_deref(), &p.game_version, loader, icons, &known);
        for j in loose.jars {
            plan.add_jar(j);
        }
        plan.skipped.extend(loose.norisk);
        plan.unfit = loose.unfit;
    }
    plan
}

pub fn add_sync(plan: &mut Plan, s: syncplan::SyncPlan, loader: LoaderKind) {
    plan.sync_packs = s.packs;
    if loader == LoaderKind::Vanilla {
        return;
    }
    for m in s.mods {
        plan.add_mod(m);
    }
    for j in s.jars {
        plan.add_jar(j);
    }
    plan.skipped.extend(s.skipped);
    plan.unfit.extend(s.unfit);
}

pub fn source_path(game: &Path, id: &str) -> String {
    format!("{}#{id}", game.to_string_lossy())
}

pub fn split_source(s: &str) -> (&str, Option<&str>) {
    match s.rsplit_once('#') {
        Some((a, b)) if !b.is_empty() && !b.contains(['\\', '/']) => (a, Some(b)),
        _ => (s, None),
    }
}

pub(super) fn read_packs(root: &Path) -> Value {
    std::fs::read(root.join("norisk_modpacks.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null)
}
