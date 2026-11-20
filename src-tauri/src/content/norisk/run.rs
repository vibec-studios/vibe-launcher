use super::banner::{Banner, MAX_BYTES};
use super::{mods, skip_top, Plan};
use crate::content::external::Found;
use crate::content::srctree::{self, Overlay};
use crate::content::{extsettings, gamedata, LauncherKind, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{InstallState, Instance, Loader, PackSource, PackSourceKind};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

const MAX_FILES: usize = 500_000;

pub fn files_to_copy(src: &Path, ov: &[Overlay]) -> Vec<(PathBuf, PathBuf)> {
    let mut budget = MAX_FILES;
    let mut out = Vec::new();
    for top in srctree::tops(src, ov) {
        if skip_top(&top) {
            continue;
        }
        for e in srctree::files(src, Path::new(&top), ov, &mut budget) {
            out.push((e.abs, e.rel));
        }
    }
    out
}

fn new_instance(f: &Found, name: String, mc: String, loader: Loader) -> Instance {
    Instance {
        id: String::new(),
        name,
        icon: None,
        accent: None,
        group: None,
        mc_version: mc,
        loader,
        java: Default::default(),
        window: Default::default(),
        hooks: Default::default(),
        source: Some(f.pack.clone().unwrap_or(PackSource { kind: PackSourceKind::Local, project_id: None, version_id: None, name: Some("NoRisk Client".into()), version_name: None })),
        install_state: InstallState::NotInstalled,
        version_id: None,
        created_at: crate::util::now_ms(),
        last_played: f.info.last_played,
        play_time_secs: f.info.play_time_secs.unwrap_or(0),
        notes: None,
        auto_update_content: None,
        bedrock: None,
    }
}

async fn set_icon(state: &AppState, id: &str, b: &Option<Banner>) {
    let bytes = match b {
        Some(Banner::Url(url)) => match state.net.get_bytes(url).await {
            Ok(b) if (b.len() as u64) < MAX_BYTES => Some(b.to_vec()),
            Ok(_) => None,
            Err(e) => {
                tracing::warn!("NoRisk-Icon nicht ladbar: {e}");
                None
            }
        },
        Some(Banner::File(p)) => std::fs::read(p).ok().filter(|b| (b.len() as u64) < MAX_BYTES),
        None => None,
    };
    if let Some(b) = bytes {
        if let Err(e) = crate::content::import::set_icon_bytes(state, id, &b).await {
            tracing::warn!("NoRisk-Icon nicht übernommen: {e}");
        }
    }
}

fn copy_all(src: PathBuf, ov: Vec<Overlay>, dst: PathBuf, task: TaskHandle) -> AppResult<(u64, Vec<String>)> {
    let files = files_to_copy(&src, &ov);
    let tops = gamedata::top_names(files.iter().map(|f| f.1.as_path()));
    let total = files.len().max(1);
    for (i, (from, rel)) in files.iter().enumerate() {
        if i % 32 == 0 {
            task.check()?;
            task.progress(i as f64 / total as f64 * 0.5);
        }
        let to = dst.join(rel);
        if let Some(p) = to.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::copy(from, &to).map_err(|e| AppError::msg(format!("{} konnte nicht kopiert werden: {e}", rel.display())))?;
    }
    Ok((files.len() as u64, tops))
}

fn summary(plan: &Plan, o: &mods::Outcome, jars: usize, note: &Option<String>, warnings: &[String]) -> String {
    let mut msg = format!("{} Mods von Modrinth, {} von CurseForge, {jars} lokale JARs übernommen", plan.count(Source::Modrinth), plan.count(Source::Curseforge));
    if !plan.sync_packs.is_empty() {
        msg.push_str(&format!(" (inkl. Sync Packs: {})", plan.sync_packs.join(", ")));
    }
    if o.locked > 0 {
        msg.push_str(&format!(", {} gesperrte CurseForge-Dateien bitte selbst herunterladen", o.locked));
    }
    if !plan.skipped.is_empty() {
        msg.push_str(&format!(", {} NoRisk-Mods ausgelassen", plan.skipped.len()));
    }
    if let Some(n) = note {
        msg.push_str(&format!(" · {n}"));
    }
    if let Some(w) = warnings.first() {
        msg.push_str(&format!(" – Hinweis: {w}"));
    }
    msg
}

#[allow(clippy::too_many_arguments)]
pub async fn run_import(
    state: AppState,
    task: TaskHandle,
    f: Found,
    source_path: String,
    name: Option<String>,
    mc_version: Option<String>,
    loader: Option<Loader>,
    keys: HashSet<String>,
) -> AppResult<()> {
    let plan = f.norisk.clone().unwrap_or_default();
    let mc = mc_version.filter(|v| !v.trim().is_empty()).unwrap_or_else(|| f.info.mc_version.clone());
    if mc.trim().is_empty() {
        return Err(AppError::Invalid(format!("{}: Minecraft-Version unbekannt – bitte angeben", f.info.name)));
    }
    let loader = loader.unwrap_or_else(|| f.info.loader.clone());
    let name = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| f.info.name.clone());
    task.set_title(format!("{name} übernehmen"));
    let mut inst = new_instance(&f, name, mc, loader);
    let (prepared, java_note) = extsettings::prepare(&state.settings(), &f.settings, &inst.mc_version, keys.contains("java")).await;
    extsettings::apply(&mut inst, &prepared, &keys);
    let inst = state.instances.insert_new(inst)?;
    task.set_instance(inst.id.clone());

    let res: AppResult<(mods::Outcome, usize, Vec<String>)> = async {
        task.stage("Kopiere Spieldaten …", Some(0.0));
        let (src, ov, dst, t2) = (f.game_dir.clone(), f.overlays.clone(), state.paths.game_dir(&inst.id), task.clone());
        let (copied, tops) = tokio::task::spawn_blocking(move || copy_all(src, ov, dst, t2)).await??;
        crate::content::external::write_mark(&state, &inst.id, LauncherKind::Norisk, &source_path, tops)?;
        task.message(format!("{copied} Dateien übernommen"));
        let mut warnings = Vec::new();
        let o = mods::install(&state, &task, &inst, &plan.mods, 0.5, 0.95, &mut warnings).await?;
        let jars = mods::copy_jars(&state, &inst.id, &plan.jars).await?;
        set_icon(&state, &inst.id, &plan.banner).await;
        Ok((o, jars, warnings))
    }
    .await;
    match res {
        Ok((o, jars, warnings)) => {
            task.message(summary(&plan, &o, jars, &java_note, &warnings));
            state.content.emit_changed(&inst.id);
            Ok(())
        }
        Err(e) => {
            if let Err(de) = state.instances.delete(&inst.id) {
                tracing::warn!("Halb importierte Instanz {} nicht entfernt: {de}", inst.id);
            }
            Err(e)
        }
    }
}
