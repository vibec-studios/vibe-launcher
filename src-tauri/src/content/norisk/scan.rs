use super::*;

pub fn scan(root: &Path, tmp: &Path, icons: &Path) -> Vec<Found> {
    let g = global::read(root);
    let nr = match read_root(root, g.custom_dir.as_deref(), tmp) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("NoRisk-Profile nicht lesbar: {e}");
            return vec![];
        }
    };
    let packs = read_packs(root);
    let pdir = profiles_dir_with(root, g.custom_dir.as_deref());
    let dirs: HashMap<String, PathBuf> = nr.profiles.iter().map(|p| (p.id.clone(), game_dir(&pdir, p))).collect();
    let roots: Vec<PathBuf> = [Some(root.to_path_buf()), g.custom_dir.clone(), Some(pdir.clone())].into_iter().flatten().collect();
    let ctx = syncplan::Ctx { db: &nr.sync, meta: &nr.meta, tmp, icons, dirs: &dirs };
    let mcache = cache::ModCache::new(&nr.meta);
    nr.profiles
        .iter()
        .map(|p| {
            let game = dirs[&p.id].clone();
            let loader = loader_of(p, &packs);
            let mut plan = plan_for(p, &packs, &game, icons, &mcache);
            let sync = syncplan::plan(&ctx, &p.id, &p.game_version, loader.kind, &game);
            let overlays = sync.overlays.clone();
            add_sync(&mut plan, sync, loader.kind);
            plan.banner = banner::parse(&p.banner, root, &game, &roots, icons);
            let icon_path = match &plan.banner {
                Some(Banner::File(f)) => Some(f.clone()),
                _ => None,
            };
            let mut f = crate::content::external::found(
                if p.name.trim().is_empty() { p.id.clone() } else { p.name.clone() },
                game.clone(),
                Path::new(&source_path(&game, &p.id)),
                p.game_version.clone(),
                loader,
                icon_path,
            );
            if let Some(Banner::Url(u)) = &plan.banner {
                f.info.icon = Some(u.clone());
            }
            f.info.mod_count = (plan.mods.len() + plan.jars.len()) as u32;
            f.info.last_played = p.last_played_ms;
            f.info.play_time_secs = Some(p.playtime_secs).filter(|v| *v > 0);
            if !plan.skipped.is_empty() {
                f.info.warning = Some(format!("{WARN_NRC} ({})", plan.skipped.len()));
            }
            f.settings = crate::content::extsettings::norisk(&p.settings, plan.group.clone(), plan.description.clone(), p.is_standard, &g);
            f.pack = pack_of(p);
            f.overlays = overlays;
            f.norisk = Some(plan);
            f
        })
        .collect()
}

pub fn describe(source: &str, tmp: &Path, icons: &Path) -> Option<Found> {
    let me = norm(source);
    roots_for(source).iter().find_map(|r| scan(r, tmp, icons).into_iter().find(|f| norm(&f.info.source_path) == me))
}

pub fn roots_for(source: &str) -> Vec<PathBuf> {
    let mut roots = roots();
    let (dir, _) = split_source(source);
    let mut cur = Path::new(dir).parent();
    while let Some(c) = cur {
        if is_root(c) && !roots.iter().any(|r| norm(&r.to_string_lossy()) == norm(&c.to_string_lossy())) {
            roots.insert(0, c.to_path_buf());
        }
        cur = c.parent();
    }
    roots
}
