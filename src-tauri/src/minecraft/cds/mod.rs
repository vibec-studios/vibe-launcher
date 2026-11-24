use super::install::Prepared;
use super::launch::{split_args, LaunchPlan};
use crate::instance::Instance;
use crate::settings::Settings;
use crate::state::AppState;
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

mod base;
mod fingerprint;
mod jar;
mod rules;

pub use fingerprint::fingerprint;
pub use jar::{is_signature, strip};
pub use rules::{blocked, Inputs};

pub struct Pending {
    dir: PathBuf,
    java: String,
    java_version: String,
    version_id: String,
    main_class: String,
}

struct Active {
    archive: PathBuf,
    off: PathBuf,
}

fn active() -> &'static Mutex<HashMap<String, Active>> {
    static A: OnceLock<Mutex<HashMap<String, Active>>> = OnceLock::new();
    A.get_or_init(Default::default)
}

fn jar_jobs() -> &'static Mutex<HashSet<PathBuf>> {
    static J: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    J.get_or_init(Default::default)
}

pub fn enabled(settings: &Settings, inst: &Instance) -> bool {
    inst.java.cds.unwrap_or(settings.java_cds)
}

fn ensure_copy(src: &Path, dst: &Path) -> bool {
    if dst.is_file() {
        return true;
    }
    if !jar_jobs().lock().insert(dst.to_path_buf()) {
        return false;
    }
    let (src, dst) = (src.to_path_buf(), dst.to_path_buf());
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = strip(&src, &dst) {
            tracing::warn!("Schnellstart: entsignierte Kopie von {} fehlgeschlagen: {e}", src.display());
        }
        jar_jobs().lock().remove(&dst);
    });
    false
}

pub fn prepare(state: &AppState, inst: &Instance, prep: &mut Prepared, settings: &Settings) -> Result<Option<Pending>, &'static str> {
    if !enabled(settings, inst) || inst.has_custom_loader() {
        return Ok(None);
    }
    let mut user_jvm = split_args(&settings.jvm_args);
    if let Some(a) = &inst.java.jvm_args {
        user_jvm.extend(split_args(a));
    }
    let root = state.paths.root.to_string_lossy().to_string();
    let inputs = Inputs {
        loader: inst.loader.kind,
        major: prep.java.major,
        version: &prep.java.version,
        user_jvm: &user_jvm,
        max_mem_mb: inst.java.max_memory_mb.unwrap_or(settings.max_memory_mb),
        path_has_space: root.contains(' ') || prep.java.path.contains(' '),
    };
    if let Some(reason) = blocked(&inputs) {
        return Err(reason);
    }
    let java = PathBuf::from(&prep.java.path);
    if !base::ready(&java) {
        base::ensure_background(&java, &state.paths.java_root());
        return Err("Java-Grundarchiv wird im Hintergrund erstellt, ab dem nächsten Start aktiv");
    }
    let sha1 = prep.resolved.client.as_ref().and_then(|c| c.sha1.as_deref());
    let Some(copy) = jar::copy_path(&state.paths.meta(), &prep.client_jar, sha1) else { return Err("Client-JAR fehlt") };
    if !ensure_copy(&prep.client_jar, &copy) {
        return Err("Client-JAR wird im Hintergrund vorbereitet, ab dem nächsten Start aktiv");
    }
    prep.client_jar = copy;
    Ok(Some(Pending {
        dir: state.paths.game_dir(&inst.id).join(".vibe"),
        java: prep.java.path.clone(),
        java_version: prep.java.version.clone(),
        version_id: prep.resolved.id.clone(),
        main_class: prep.resolved.main_class.clone(),
    }))
}

fn insert_args(plan: &mut LaunchPlan, main_class: &str, extra: &[String]) -> bool {
    let Some(i) = plan.args.iter().position(|a| a == main_class) else { return false };
    plan.args.splice(i..i, extra.iter().cloned());
    plan.display = plan.display.replacen(&format!(" {main_class} "), &format!(" {} {main_class} ", extra.join(" ")), 1);
    true
}

fn remove_old(dir: &Path, keep: &Path) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with("cds-") && name.ends_with(".jsa") && e.path() != keep {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

impl Pending {
    pub fn apply(self, plan: &mut LaunchPlan, run: &str, slot: u32) -> Option<String> {
        let fp = fingerprint(&self.java, &self.java_version, &self.version_id, &self.main_class, &plan.args);
        let archive = self.dir.join(format!("cds-{fp}.jsa"));
        let off = self.dir.join(format!("cds-off-{fp}"));
        if off.is_file() {
            return Some("Java-Schnellstart (CDS): aus, nach einem frühen Absturz mit Archiv".into());
        }
        let exists = archive.is_file();
        if slot > 1 && !exists {
            return None;
        }
        std::fs::create_dir_all(&self.dir).ok()?;
        if slot == 1 {
            remove_old(&self.dir, &archive);
        }
        let mut extra = vec![format!("-XX:SharedArchiveFile={}", archive.display())];
        if slot == 1 {
            extra.push("-XX:+AutoCreateSharedArchive".into());
        }
        if !insert_args(plan, &self.main_class, &extra) {
            return None;
        }
        active().lock().insert(run.to_string(), Active { archive: archive.clone(), off });
        Some(match archive.metadata() {
            Ok(m) if exists => format!("Java-Schnellstart (CDS): aktiv, {} MB", m.len() / 1_048_576),
            _ => "Java-Schnellstart (CDS): Archiv wird beim Beenden erstellt (einmalig, das Spielende dauert einige Sekunden länger)".into(),
        })
    }
}

pub fn on_exit(run: &str, crashed: bool, elapsed_ms: i64) {
    let Some(a) = active().lock().remove(run) else { return };
    if crashed && elapsed_ms < 30_000 {
        let _ = std::fs::remove_file(&a.archive);
        let _ = std::fs::write(&a.off, b"");
        tracing::warn!("Schnellstart: früher Absturz mit CDS, Archiv gelöscht und für diese Konfiguration abgeschaltet");
    }
}

pub fn instance_files(game_dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(game_dir.join(".vibe"))
        .map(|rd| rd.flatten().filter(|e| e.file_name().to_string_lossy().starts_with("cds-")).map(|e| e.path()).collect())
        .unwrap_or_default()
}

pub fn clear_instance(game_dir: &Path) {
    for p in instance_files(game_dir) {
        let _ = std::fs::remove_file(p);
    }
}

#[cfg(test)]
mod tests;
