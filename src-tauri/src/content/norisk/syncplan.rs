use super::options::{separator, Doc};
use super::sync::{pick_version, Kind, Pack, SyncDb, Target};
use super::{jar_class, JarClass, PlanJar, PlanMod};
use crate::content::srctree::{safe_rel, Overlay, Prefer};
use crate::instance::LoaderKind;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

pub struct Ctx<'a> {
    pub db: &'a SyncDb,
    pub meta: &'a Path,
    pub tmp: &'a Path,
    pub icons: &'a Path,
    pub dirs: &'a HashMap<String, PathBuf>,
}

#[derive(Debug, Clone, Default)]
pub struct SyncPlan {
    pub packs: Vec<String>,
    pub overlays: Vec<Overlay>,
    pub mods: Vec<PlanMod>,
    pub jars: Vec<PlanJar>,
    pub skipped: Vec<String>,
    pub unfit: Vec<String>,
}

fn rel_key(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/").to_lowercase()
}

fn allowed(rel: &Path) -> bool {
    let mut it = rel.components().map(|c| c.as_os_str().to_string_lossy().to_string());
    let Some(top) = it.next() else { return false };
    let denied = ["mods", "versions", "libraries", "assets"].iter().any(|d| d.eq_ignore_ascii_case(&top));
    !denied && !super::skip_top(&top) && !rel.components().any(|c| crate::content::gamedata::is_secret(&c.as_os_str().to_string_lossy()))
}

fn master(ctx: &Ctx, pack: &Pack, t: &Target, rel: &Path) -> Option<PathBuf> {
    if let Some(e) = t.external.as_ref().filter(|e| e.is_absolute() && e.parent().is_some()) {
        return Some(e.clone());
    }
    Some(ctx.meta.join("sync_packs").join(safe_rel(&pack.id)?).join("master").join(rel))
}

fn mtime(p: &Path) -> Option<SystemTime> {
    std::fs::metadata(p).ok().filter(|m| m.is_file()).and_then(|m| m.modified().ok())
}

fn prefer_of(adopt: &str) -> Prefer {
    match adopt {
        "prefer_instance" => Prefer::Source,
        "prefer_newer" => Prefer::Newer,
        _ => Prefer::Overlay,
    }
}

fn subscribers(ctx: &Ctx, pack: &str, me: &str, game: &Path, rel: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = ctx
        .db
        .subs
        .iter()
        .filter(|(pid, packs)| pid.as_str() != me && packs.iter().any(|p| p == pack))
        .filter_map(|(pid, _)| ctx.dirs.get(pid))
        .filter(|d| rel_key(d) != rel_key(game))
        .map(|d| d.join(rel))
        .collect();
    v.sort();
    v.dedup();
    v
}

fn newest(cands: Vec<PathBuf>) -> Option<(PathBuf, SystemTime)> {
    cands.into_iter().filter_map(|p| Some((mtime(&p)?, p))).max_by_key(|(t, _)| *t).map(|(t, p)| (p, t))
}

fn file_copy(own: &Path, master: PathBuf, others: Vec<PathBuf>) -> Option<PathBuf> {
    let mut c = vec![master];
    c.extend(others);
    let (win, t) = newest(c)?;
    match mtime(own) {
        Some(o) if o >= t => None,
        _ => Some(win),
    }
}

fn file_merge(own: &Path, master: &Path, others: Vec<PathBuf>, sep: char, keys: &[String], out: &Path) -> Option<PathBuf> {
    let own_t = mtime(own);
    let mut c: Vec<(SystemTime, PathBuf)> = std::iter::once(master.to_path_buf()).chain(others).filter_map(|p| Some((mtime(&p)?, p))).filter(|(t, _)| own_t.map_or(true, |o| *t > o)).collect();
    c.sort();
    let read = |p: &Path| std::fs::metadata(p).ok().filter(|m| m.len() <= 4 * 1024 * 1024).and_then(|_| std::fs::read_to_string(p).ok());
    let had = read(own);
    let mut doc = match had.as_deref().or(read(master).as_deref()) {
        Some(t) => Doc::parse(t, sep),
        None => Doc::empty(sep),
    };
    let mut changed = false;
    for (_, p) in &c {
        if let Some(t) = read(p) {
            changed |= doc.apply(&Doc::parse(&t, sep), keys);
        }
    }
    let text = doc.render();
    if text.is_empty() || (!changed && had.is_some()) {
        return None;
    }
    std::fs::create_dir_all(out.parent()?).ok()?;
    std::fs::write(out, text).ok()?;
    let t = c.iter().map(|(t, _)| *t).chain(own_t).chain(mtime(master)).max()?;
    let f = std::fs::File::options().write(true).open(out).ok()?;
    f.set_modified(t).ok()?;
    Some(out.to_path_buf())
}

fn claims<'a>(packs: &[&'a Pack]) -> Vec<(&'a Pack, &'a Target, PathBuf)> {
    let mut win: Vec<(&Pack, &Target, PathBuf)> = Vec::new();
    for p in packs {
        for t in p.targets.iter().filter(|t| t.kind != Kind::Mods) {
            let Some(rel) = safe_rel(&t.path).filter(|r| allowed(r)) else { continue };
            win.retain(|(_, _, r)| rel_key(r) != rel_key(&rel));
            win.push((p, t, rel));
        }
    }
    let linked: Vec<String> = win.iter().filter(|(_, t, _)| matches!(t.kind, Kind::DirLink { .. })).map(|(_, _, r)| rel_key(r)).collect();
    win.retain(|(_, _, r)| {
        let k = rel_key(r);
        !linked.iter().any(|d| *d != k && k.starts_with(&format!("{d}/")))
    });
    win
}

fn out_file(ctx: &Ctx, me: &str, game: &Path, rel: &Path) -> PathBuf {
    let h = hex::encode(<sha1::Sha1 as sha1::Digest>::digest(format!("{}#{me}#{}", rel_key(game), rel_key(rel)).as_bytes()));
    ctx.tmp.join("norisk-merge").join(&h[..12]).join(rel.file_name().unwrap_or_default())
}

pub fn plan(ctx: &Ctx, me: &str, mc: &str, loader: LoaderKind, game: &Path) -> SyncPlan {
    let mut out = SyncPlan::default();
    let packs: Vec<&Pack> = ctx.db.subs.get(me).into_iter().flatten().filter_map(|id| ctx.db.packs.get(id)).collect();
    out.packs = packs.iter().map(|p| p.name.clone()).collect();
    let won = claims(&packs);
    let res_linked = won.iter().any(|(_, t, r)| matches!(t.kind, Kind::DirLink { .. }) && rel_key(r) == "resourcepacks");
    for (pack, t, rel) in &won {
        let Some(m) = master(ctx, pack, t, rel) else { continue };
        let own = game.join(rel);
        let path = match &t.kind {
            Kind::DirLink { adopt } => {
                if m.is_dir() {
                    out.overlays.push(Overlay { rel: rel.clone(), path: m, prefer: prefer_of(adopt) });
                }
                continue;
            }
            Kind::FileCopy => file_copy(&own, m, subscribers(ctx, &pack.id, me, game, rel)),
            Kind::FileMerge { format, local_keys } => {
                let keys: Vec<String> = if res_linked { vec![] } else { local_keys.clone() };
                file_merge(&own, &m, subscribers(ctx, &pack.id, me, game, rel), separator(format.as_deref()), &keys, &out_file(ctx, me, game, rel))
            }
            Kind::Mods => None,
        };
        if let Some(p) = path {
            out.overlays.push(Overlay { rel: rel.clone(), path: p, prefer: Prefer::Overlay });
        }
    }
    let lkey = loader.as_str();
    let cache = super::cache::ModCache::new(ctx.meta);
    let mut seen: HashSet<String> = HashSet::new();
    for pack in packs.iter().rev() {
        let excl = ctx.db.excluded.get(&(me.to_string(), pack.id.clone()));
        let ex = |k: &str| excl.is_some_and(|e| e.contains(k));
        for m in pack.mods.iter().filter(|m| m.enabled && !ex(&m.mod_id)) {
            let Some(version) = pick_version(m, pack, mc, lkey) else { continue };
            if seen.insert(super::sync::project_key(m)) {
                let file = pack.files.get(&(super::sync::project_key(m), mc.to_string(), lkey.to_string()));
                out.mods.push(PlanMod { source: m.source, project_id: m.project_id.clone(), version_id: version, enabled: true, name: m.name.clone(), cache: cache.file(file.map(String::as_str)) });
            }
        }
        let Some(id) = safe_rel(&pack.id) else { continue };
        let mut jars: Vec<PathBuf> = std::fs::read_dir(ctx.meta.join("sync_packs").join(id).join("mods")).into_iter().flatten().flatten().map(|e| e.path()).collect();
        jars.sort();
        for j in jars {
            let name = j.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if !name.to_ascii_lowercase().ends_with(".jar") || !j.is_file() || ex(&format!("jar:{name}")) || !seen.insert(format!("jar:{}", name.to_lowercase())) {
                continue;
            }
            match jar_class(&j, &name, mc, loader, ctx.icons) {
                JarClass::Fits(mod_id) => out.jars.push(PlanJar { path: j, name, mod_id }),
                JarClass::Norisk(n) => out.skipped.push(n),
                JarClass::Unfit => out.unfit.push(name),
            }
        }
    }
    out.mods.reverse();
    out
}
