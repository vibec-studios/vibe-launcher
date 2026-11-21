use super::*;

// ------------------------------------------------------------------ Kompatibilitätsübersicht

pub const MATRIX_LOADERS: [LoaderKind; 4] = [LoaderKind::Fabric, LoaderKind::Quilt, LoaderKind::Forge, LoaderKind::Neoforge];
pub(super) const POPULAR_MC: &[&str] = &["1.21.11", "1.21.1", "1.21.4", "1.20.1", "1.19.2", "1.18.2", "1.16.5", "1.12.2"];

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CompatCell {
    pub mc: String,
    pub loader: LoaderKind,
    pub available: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct EntryCompat {
    pub key: String,
    pub loaders: Vec<LoaderKind>,
    pub mc_min: Option<String>,
    pub mc_max: Option<String>,
    /// Konnte nicht geprüft werden
    pub error: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SetCompat {
    pub total: u32,
    pub mc_versions: Vec<String>,
    pub loaders: Vec<LoaderKind>,
    pub cells: Vec<CompatCell>,
    pub entries: Vec<EntryCompat>,
    /// Kombination mit den meisten verfügbaren Projekten (neueste Version bevorzugt)
    pub best: Option<CompatCell>,
}

pub type Support = HashSet<(String, LoaderKind)>;

/// Unterstützte (MC-Version, Loader)-Paare aus Versionen.
pub fn support_of(versions: &[ProjectVersion], pt: ProjectType) -> Support {
    let mut out = Support::new();
    let loaders = [LoaderKind::Vanilla, LoaderKind::Fabric, LoaderKind::Quilt, LoaderKind::Forge, LoaderKind::Neoforge];
    for v in versions {
        for g in v.game_versions.iter().filter(|g| mc_key(g).is_some()) {
            for l in loaders {
                if provider::compatible(v, pt, g, l) && !(pt == ProjectType::Mod && l == LoaderKind::Vanilla && provider::target_kind(pt, v, l, g) == ContentKind::Mod) {
                    out.insert((g.clone(), l));
                }
            }
        }
    }
    out
}

/// Spalten der Übersicht: neueste Versionen, beliebte ältere und die der eigenen Instanzen.
pub fn pick_mc_columns(supports: &[Support], own: &[String]) -> Vec<String> {
    let mut all: Vec<String> = supports.iter().flat_map(|s| s.iter().map(|(g, _)| g.clone())).collect::<BTreeSet<_>>().into_iter().collect();
    sort_mc_desc(&mut all);
    // Vorrang: die 3 neuesten, dann Versionen eigener Instanzen, dann verbreitete; erst danach nach Version sortieren
    let mut cols: Vec<String> = all.iter().take(3).cloned().collect();
    for p in own.iter().cloned().chain(POPULAR_MC.iter().map(|s| s.to_string())) {
        if cols.len() >= 10 {
            break;
        }
        if all.contains(&p) && !cols.contains(&p) {
            cols.push(p);
        }
    }
    sort_mc_desc(&mut cols);
    cols
}

pub fn build_matrix(supports: &[Support], mcs: &[String], loaders: &[LoaderKind]) -> Vec<CompatCell> {
    let mut out = Vec::new();
    for l in loaders {
        for mc in mcs {
            let n = supports.iter().filter(|s| s.contains(&(mc.clone(), *l))).count() as u32;
            out.push(CompatCell { mc: mc.clone(), loader: *l, available: n });
        }
    }
    out
}

pub fn best_cell(cells: &[CompatCell], mcs: &[String], loaders: &[LoaderKind]) -> Option<CompatCell> {
    cells
        .iter()
        .filter(|c| c.available > 0)
        .max_by(|a, b| {
            a.available
                .cmp(&b.available)
                .then_with(|| mcs.iter().position(|m| m == &b.mc).cmp(&mcs.iter().position(|m| m == &a.mc)))
                .then_with(|| loaders.iter().position(|l| *l == b.loader).cmp(&loaders.iter().position(|l| *l == a.loader)))
        })
        .cloned()
}

pub(super) async fn entry_support(state: &AppState, e: &SetEntry) -> Option<Support> {
    match e.source {
        Source::Curseforge => {
            if !cf::available(state) {
                return None;
            }
            // Günstig: Index der neuesten Dateien je (Version, Loader) statt aller Dateien
            let m = cf::raw_mod(state, &e.project_id).await.ok()?;
            let pt = cf::project_type_of_class(m.class_id);
            let versions: Vec<ProjectVersion> = m
                .latest_files_indexes
                .iter()
                .map(|i| ProjectVersion {
                    source: Source::Curseforge,
                    id: i.file_id.to_string(),
                    project_id: e.project_id.clone(),
                    name: String::new(),
                    version_number: String::new(),
                    game_versions: vec![i.game_version.clone()],
                    loaders: i.mod_loader.and_then(cf::loader_name).map(|l| vec![l.to_string()]).unwrap_or_default(),
                    release_type: "release".into(),
                    date: String::new(),
                    downloads: 0,
                    files: vec![],
                    dependencies: vec![],
                    changelog: None,
                })
                .collect();
            Some(support_of(&versions, pt))
        }
        _ => {
            let (all, _, pt) = provider::versions_for(state, e.source, &e.project_id, None, None).await.ok()?;
            Some(support_of(&all, pt))
        }
    }
}

pub async fn compat(state: &AppState, set_id: &str) -> AppResult<SetCompat> {
    let set = sets::get(&state.paths, set_id)?;
    let futs: Vec<_> = set.entries.iter().map(|e| async move { (e.key(), entry_support(state, e).await) }).collect();
    let results: Vec<(String, Option<Support>)> = futures::stream::iter(futs).buffered(6).collect().await;
    let supports: Vec<Support> = results.iter().map(|(_, s)| s.clone().unwrap_or_default()).collect();
    let own: Vec<String> = state.instances.list().into_iter().map(|i| i.mc_version).collect();
    let mcs = pick_mc_columns(&supports, &own);
    let mut loaders: Vec<LoaderKind> = MATRIX_LOADERS.to_vec();
    if !set.entries.iter().any(|e| e.project_type == ProjectType::Mod) {
        loaders.insert(0, LoaderKind::Vanilla);
    }
    let cells = build_matrix(&supports, &mcs, &loaders);
    let best = best_cell(&cells, &mcs, &loaders);
    let entries = results
        .iter()
        .map(|(key, s)| {
            let Some(s) = s else { return EntryCompat { key: key.clone(), loaders: vec![], mc_min: None, mc_max: None, error: true } };
            let ls: Vec<LoaderKind> = loaders.iter().copied().filter(|l| s.iter().any(|(_, x)| x == l)).collect();
            let mut mcs: Vec<String> = s.iter().map(|(g, _)| g.clone()).collect::<BTreeSet<_>>().into_iter().collect();
            sort_mc_desc(&mut mcs);
            EntryCompat { key: key.clone(), loaders: ls, mc_min: mcs.last().cloned(), mc_max: mcs.first().cloned(), error: false }
        })
        .collect();
    Ok(SetCompat { total: set.entries.len() as u32, mc_versions: mcs, loaders, cells, entries, best })
}
