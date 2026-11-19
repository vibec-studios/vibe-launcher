//! „Probleme beheben“: erkennt die behebbaren Probleme einer Instanz (Abhängigkeits-Check, bekannte
//! Konflikte laut Modrinth, letzte Crash-Analyse), zeigt sie als Plan und führt die gewählten Schritte aus.
//!
//! Ablauf:
//! 1. [`needs`] (rein, getestet): Probleme -> Bedarf (installieren, aktivieren, deaktivieren, Version tauschen …),
//!    dedupliziert und ohne Widersprüche (eine Mod, die deaktiviert/ersetzt wird, braucht keine Abhängigkeiten mehr).
//!    Der Loader (Version passt nicht zu den Mods, Installation unvollständig/beschädigt/fehlgeschlagen) kommt aus
//!    [`loaderfix::loader_needs`] dazu.
//! 2. [`plan`]: Bedarf über Modrinth/CurseForge auflösen (passende Version, Projekt zur Mod-ID, Java, Loader-Version).
//! 3. [`run_apply`]: Snapshot anlegen (Rückgängig), dann deaktivieren/aktivieren, tauschen/installieren, Java/RAM,
//!    zuletzt Loader umstellen bzw. neu installieren (schlägt das fehl, bleibt die alte Loader-Version eingestellt).
//!    Nichts wird ohne Sicherung gelöscht: doppelte und unpassende Mods werden nur deaktiviert (`.disabled`),
//!    ersetzte Dateien liegen im Snapshot. Gesperrte CurseForge-Dateien werden nur verlinkt (manueller Download).
//! 4. [`run_undo`]: Snapshot wiederherstellen, Java/RAM zurücksetzen, vorgemerkte manuelle Downloads austragen.
use super::deps::{self, DepIssue, Fix, IssueKind};
use super::index::{self, ContentIndex};
use super::loaderfix::{self, LoaderNeed};
use super::{install, local, missing, modrinth as mr, snapshots, ContentKind, MissingDownload, ProjectVersion, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{Instance, InstancePatch, JavaOptions, Loader, LoaderKind};
use crate::platform::crash::{self, Action as CrashAction, Diagnosis};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const SNAPSHOT_NAME: &str = "Vor „Probleme beheben“";
const REPORT_FILE: &str = "autofix.json";

// ------------------------------------------------------------------ Typen

/// Ein ausführbarer Schritt (kommt so auch vom Frontend zurück).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FixAction {
    /// Projekt (inkl. Pflicht-Abhängigkeiten) installieren
    Install { source: Source, project_id: String, title: String },
    /// Installierte Datei durch eine passende Version ersetzen. `manual`: Datei ist auf CurseForge für andere
    /// Launcher gesperrt -> nur vormerken und verlinken.
    Replace {
        file_name: String,
        source: Source,
        project_id: String,
        version_id: String,
        title: String,
        from_version: Option<String>,
        to_version: String,
        #[serde(default)]
        manual: bool,
    },
    Enable { file_name: String },
    Disable { file_name: String },
    /// Java-Hauptversion für die Instanz einstellen; `path = None` -> wird heruntergeladen
    SetJava {
        major: u32,
        #[serde(default)]
        path: Option<String>,
    },
    /// Maximalen Arbeitsspeicher setzen (MB)
    SetRam { mb: u32 },
    /// Loader-Version der Instanz umstellen und installieren (`from` nur zur Anzeige)
    SetLoader {
        loader: LoaderKind,
        #[serde(default)]
        from: Option<String>,
        to: String,
    },
    /// Loader in der eingestellten Version neu installieren (alle Dateien prüfen und neu laden)
    RepairLoader {
        loader: LoaderKind,
        #[serde(default)]
        version: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct FixStep {
    pub id: String,
    /// Grund: missing_dependency | disabled_dependency | version_mismatch | incompatible | known_conflict | duplicate |
    /// wrong_loader | wrong_minecraft | crash_suspect | dep_not_found | java_version | out_of_memory |
    /// loader_too_old | loader_too_new | loader_unknown | loader_files_missing | loader_files_broken | loader_install_failed
    pub reason: String,
    /// Betroffene Mod (Anzeigename)
    pub name: String,
    /// Mods, die das brauchen (fehlende/deaktivierte Abhängigkeit)
    pub required_by: Vec<String>,
    pub action: FixAction,
    /// Alternative (bei Konflikten: die andere Mod deaktivieren)
    pub alt: Option<FixAction>,
    pub alt_name: Option<String>,
    /// Nur nach ausdrücklicher Rückfrage (Konflikte, vermutete Crash-Ursache)
    pub confirm: bool,
    /// Standardmäßig ausgewählt
    pub selected: bool,
    /// Aus der Crash-Analyse
    pub from_crash: bool,
    /// Zusatzangabe je Grund (sprachneutral): wrong_loader -> Loader der Mod ("forge"), loader_too_* -> Anforderungen
    /// („Create >=0.16.10“), loader_files_* -> Anzahl Dateien
    pub detail: Option<String>,
}

/// Erkannt, aber nicht automatisch behebbar.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Unfixable {
    /// loader_version | loader_offline | no_version | dep_not_found | graphics | heap_reserve
    pub reason: String,
    pub name: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FixPlan {
    pub steps: Vec<FixStep>,
    pub unfixable: Vec<Unfixable>,
    /// Die letzte Sitzung ist abgestürzt und wurde mit ausgewertet
    pub crash: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    pub action: FixAction,
    pub ok: bool,
    pub error: Option<String>,
}

/// Ergebnis des letzten Durchlaufs (`instances/<id>/autofix.json`), Grundlage für „Rückgängig“.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixReport {
    pub created: i64,
    pub snapshot_id: Option<String>,
    /// Bereiche der Sicherung (`None` = vollständig bzw. keine Sicherung, siehe `snapshot_id`)
    #[serde(default)]
    pub snapshot_scopes: Option<Vec<String>>,
    pub results: Vec<StepResult>,
    /// Gesperrte Downloads, die manuell geladen werden müssen
    pub manual: Vec<MissingDownload>,
    /// Java-Einstellungen vor dem Durchlauf (nur wenn Java/RAM geändert wurde)
    pub prev_java: Option<JavaOptions>,
    /// Loader vor dem Durchlauf (nur wenn die Loader-Version umgestellt wurde)
    #[serde(default)]
    pub prev_loader: Option<Loader>,
    #[serde(default)]
    pub undone: bool,
}

/// Schnelle Prüfung ohne Netz (vor dem Start).
#[derive(Debug, Clone, Serialize)]
pub struct QuickCheck {
    pub errors: u32,
    pub warnings: u32,
    /// Letzte Sitzung abgestürzt
    pub crashed: bool,
}

// ------------------------------------------------------------------ 1. Bedarf (rein)

#[derive(Debug, Clone, PartialEq)]
pub enum Need {
    /// Fehlende Abhängigkeit (Mod-ID) suchen und installieren
    Install { dep_id: String, required_by: Vec<String>, required_files: Vec<String>, from_crash: bool },
    Enable { file: String, name: String, required_by: Vec<String>, from_crash: bool },
    Disable { file: String, name: String, reason: String, confirm: bool, alt: Option<(String, String)>, from_crash: bool },
    /// Passende Version suchen (falscher Loader / falsche MC-Version), sonst deaktivieren
    Swap { file: String, name: String, reason: String, from_crash: bool },
    /// Installierte Abhängigkeit hat eine unpassende Version -> passende Version suchen
    Update { file: String, name: String, required_by: String },
    Java { major: u32 },
    Ram { mb: u32 },
    Unfixable(Unfixable),
}

const LOADER_IDS: &[&str] = &["fabricloader", "fabric-loader", "forge", "neoforge", "quilt_loader"];

fn kind_str(k: IssueKind) -> &'static str {
    match k {
        IssueKind::MissingDependency => "missing_dependency",
        IssueKind::DisabledDependency => "disabled_dependency",
        IssueKind::VersionMismatch => "version_mismatch",
        IssueKind::Incompatible => "incompatible",
        IssueKind::Duplicate => "duplicate",
        IssueKind::WrongLoader => "wrong_loader",
        IssueKind::WrongMinecraft => "wrong_minecraft",
        IssueKind::LoaderFiles => "loader_files",
    }
}

fn display_name(file: &str) -> String {
    let b = index::strip_disabled(file);
    b.strip_suffix(".jar").unwrap_or(b).to_string()
}

struct Acc {
    out: Vec<Need>,
    /// Dateien, die deaktiviert werden
    off: HashSet<String>,
    /// Dateien, die ersetzt (oder ersatzweise deaktiviert) werden
    swapped: HashSet<String>,
}

impl Acc {
    fn gone(&self, f: &str) -> bool {
        self.off.contains(f) || self.swapped.contains(f)
    }
    fn disable(&mut self, file: &str, name: String, reason: &str, confirm: bool, alt: Option<(String, String)>, from_crash: bool) {
        if self.gone(file) {
            return;
        }
        self.off.insert(file.to_string());
        self.out.push(Need::Disable { file: file.into(), name, reason: reason.into(), confirm, alt, from_crash });
    }
    fn swap(&mut self, file: &str, name: String, reason: &str, from_crash: bool) {
        if self.gone(file) {
            return;
        }
        self.swapped.insert(file.to_string());
        self.out.push(Need::Swap { file: file.into(), name, reason: reason.into(), from_crash });
    }
    fn install(&mut self, dep_id: &str, by: Option<(&str, &str)>, from_crash: bool) {
        let dep = dep_id.to_ascii_lowercase();
        for n in self.out.iter_mut() {
            if let Need::Install { dep_id, required_by, required_files, .. } = n {
                if *dep_id == dep {
                    if let Some((name, file)) = by {
                        if !required_by.iter().any(|x| x == name) {
                            required_by.push(name.into());
                        }
                        if !file.is_empty() && !required_files.iter().any(|x| x == file) {
                            required_files.push(file.into());
                        }
                    }
                    return;
                }
            }
        }
        let (required_by, required_files) = match by {
            Some((n, f)) => (vec![n.to_string()], if f.is_empty() { vec![] } else { vec![f.to_string()] }),
            None => (vec![], vec![]),
        };
        self.out.push(Need::Install { dep_id: dep, required_by, required_files, from_crash });
    }
    fn enable(&mut self, file: &str, name: String, by: Option<&str>, from_crash: bool) {
        for n in self.out.iter_mut() {
            if let Need::Enable { file: f, required_by, .. } = n {
                if f == file {
                    if let Some(b) = by {
                        if !required_by.iter().any(|x| x == b) {
                            required_by.push(b.into());
                        }
                    }
                    return;
                }
            }
        }
        self.out.push(Need::Enable { file: file.into(), name, required_by: by.map(|b| vec![b.to_string()]).unwrap_or_default(), from_crash });
    }
    fn unfixable(&mut self, reason: &str, name: &str, detail: Option<String>) {
        let u = Unfixable { reason: reason.into(), name: name.into(), detail };
        if !self.out.iter().any(|n| matches!(n, Need::Unfixable(x) if *x == u)) {
            self.out.push(Need::Unfixable(u));
        }
    }
}

/// Probleme (Abhängigkeits-Check + Crash-Diagnosen) in einen widerspruchsfreien Bedarf übersetzen.
/// `names`: Dateiname -> Anzeigename der installierten Mods.
pub fn needs(issues: &[DepIssue], diags: &[Diagnosis], names: &HashMap<String, String>) -> Vec<Need> {
    let name = |f: &str| names.get(f).cloned().unwrap_or_else(|| display_name(f));
    let mut a = Acc { out: vec![], off: HashSet::new(), swapped: HashSet::new() };
    let of = |k: IssueKind| issues.iter().filter(move |i| i.kind == k);

    // Doppelte zuerst: alle bis auf die neueste Datei deaktivieren
    for i in of(IssueKind::Duplicate) {
        for f in &i.fixes {
            if let Fix::Remove { file_names } = f {
                for n in file_names {
                    a.disable(n, i.mod_name.clone(), "duplicate", false, None, false);
                }
            }
        }
    }
    // Falscher Loader / falsche Minecraft-Version: passende Version, sonst deaktivieren
    for i in issues.iter().filter(|i| matches!(i.kind, IssueKind::WrongLoader | IssueKind::WrongMinecraft)) {
        a.swap(&i.file_name, i.mod_name.clone(), kind_str(i.kind), false);
    }
    // Deaktivierte Pflicht-Abhängigkeit: wieder aktivieren
    for i in of(IssueKind::DisabledDependency) {
        if a.gone(&i.file_name) {
            continue;
        }
        if let Some(Fix::Enable { file_name, title }) = i.fixes.iter().find(|f| matches!(f, Fix::Enable { .. })) {
            a.enable(file_name, title.clone(), Some(&i.mod_name), false);
        }
    }
    // Fehlende Pflicht-Abhängigkeit: installieren (gleiche ID nur einmal)
    for i in of(IssueKind::MissingDependency) {
        if a.gone(&i.file_name) {
            continue;
        }
        if let Some(t) = &i.target {
            a.install(t, Some((&i.mod_name, &i.file_name)), false);
        }
    }
    // Unpassende Version einer Abhängigkeit: Abhängigkeit tauschen (Loader-Version: siehe loaderfix)
    for i in of(IssueKind::VersionMismatch) {
        if a.gone(&i.file_name) {
            continue;
        }
        match (&i.target, &i.other_file) {
            (Some(t), _) if LOADER_IDS.contains(&t.as_str()) => {}
            (_, Some(o)) => {
                if a.gone(o) || a.out.iter().any(|n| matches!(n, Need::Update { file, .. } if file == o)) {
                    continue;
                }
                a.swapped.insert(o.clone());
                a.out.push(Need::Update { file: o.clone(), name: name(o), required_by: i.mod_name.clone() });
            }
            _ => a.unfixable("version_mismatch", &i.mod_name, Some(i.message.clone())),
        }
    }
    // Konflikte: nur nach Rückfrage, wahlweise die eine oder andere Mod
    let mut pairs: HashSet<(String, String)> = HashSet::new();
    for i in of(IssueKind::Incompatible) {
        let Some(o) = &i.other_file else { continue };
        if a.gone(o) || a.gone(&i.file_name) {
            continue;
        }
        let key = if *o < i.file_name { (o.clone(), i.file_name.clone()) } else { (i.file_name.clone(), o.clone()) };
        if !pairs.insert(key) {
            continue;
        }
        a.disable(o, name(o), "incompatible", true, Some((i.file_name.clone(), i.mod_name.clone())), false);
    }

    // Letzte Crash-Analyse
    for d in diags {
        let culprit_file = d.culprit.as_ref().and_then(|c| c.file.clone());
        let culprit_name = d.culprit.as_ref().and_then(|c| c.name.clone().or_else(|| c.mod_id.clone()));
        match d.id.as_str() {
            "missing_dependency" => {
                if culprit_file.as_deref().is_some_and(|f| a.gone(f)) {
                    continue;
                }
                for act in &d.actions {
                    match act {
                        CrashAction::InstallDependency { mod_id, .. } => {
                            let by = culprit_name.as_deref().map(|n| (n, culprit_file.as_deref().unwrap_or("")));
                            a.install(mod_id, by, true)
                        }
                        CrashAction::EnableMod { file, name: n } => {
                            let n = n.clone().unwrap_or_else(|| name(file));
                            a.enable(file, n, culprit_name.as_deref(), true)
                        }
                        _ => {}
                    }
                }
            }
            "java_version" => {
                for act in &d.actions {
                    if let CrashAction::SetJava { major } = act {
                        if !a.out.iter().any(|n| matches!(n, Need::Java { .. })) {
                            a.out.push(Need::Java { major: *major });
                        }
                    }
                }
            }
            "out_of_memory" => {
                for act in &d.actions {
                    if let CrashAction::IncreaseRam { suggest_mb } = act {
                        if !a.out.iter().any(|n| matches!(n, Need::Ram { .. })) {
                            a.out.push(Need::Ram { mb: *suggest_mb });
                        }
                    }
                }
            }
            "duplicate_mod" => {
                for act in &d.actions {
                    if let CrashAction::DisableMod { file } = act {
                        a.disable(file, culprit_name.clone().unwrap_or_else(|| name(file)), "duplicate", false, None, true);
                    }
                }
            }
            "wrong_minecraft" => {
                if let Some(f) = &culprit_file {
                    a.swap(f, culprit_name.clone().unwrap_or_else(|| name(f)), "wrong_minecraft", true);
                }
            }
            "mixin" | "suspected_mod" => {
                if let Some(f) = &culprit_file {
                    a.disable(f, culprit_name.clone().unwrap_or_else(|| name(f)), "crash_suspect", true, None, true);
                }
            }
            "graphics" => a.unfixable("graphics", "", d.params.get("dll").cloned()),
            "heap_reserve" => a.unfixable("heap_reserve", "", d.params.get("current").cloned()),
            _ => {}
        }
    }
    a.out
}

// ------------------------------------------------------------------ 2. Plan (auflösen)

fn report_path(state: &AppState, instance_id: &str) -> std::path::PathBuf {
    state.paths.instance_dir(instance_id).join(REPORT_FILE)
}

pub fn last_report(state: &AppState, instance_id: &str) -> Option<FixReport> {
    std::fs::read(report_path(state, instance_id)).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

fn last_crash(state: &AppState, instance_id: &str) -> Option<(Option<String>, Option<i32>)> {
    state.game.states().into_iter().find(|s| s.instance_id == instance_id && s.crashed).map(|s| (s.crash_report, s.exit_code))
}

pub async fn quick(state: &AppState, instance_id: &str) -> AppResult<QuickCheck> {
    let inst = state.instances.get(instance_id)?;
    let issues = if inst.loader.kind == LoaderKind::Vanilla { vec![] } else { deps::check(state, instance_id, false).await? };
    let errors = issues.iter().filter(|i| i.severity == "error").count() as u32;
    Ok(QuickCheck { errors, warnings: issues.len() as u32 - errors, crashed: last_crash(state, instance_id).is_some() })
}

/// Neueste zur Instanz passende Version eines Projekts.
async fn best(state: &AppState, inst: &Instance, source: Source, project_id: &str) -> Option<ProjectVersion> {
    install::best_version(state, inst, source, project_id).await.ok().flatten()
}

fn primary(v: &ProjectVersion) -> Option<&super::VersionFile> {
    v.files.iter().find(|f| f.primary).or(v.files.first())
}

/// Gesperrter Download (CurseForge ohne Freigabe und ohne identische Datei auf Modrinth)?
async fn locked(state: &AppState, v: &ProjectVersion) -> bool {
    let Some(f) = primary(v) else { return false };
    if f.url.is_some() {
        return false;
    }
    match &f.sha1 {
        Some(h) => !mr::mirrors(state, std::slice::from_ref(h)).await.contains_key(&h.to_ascii_lowercase()),
        None => true,
    }
}

struct Builder {
    steps: Vec<FixStep>,
    unfixable: Vec<Unfixable>,
}

impl Builder {
    #[allow(clippy::too_many_arguments)]
    fn step(
        &mut self,
        reason: &str,
        name: &str,
        required_by: Vec<String>,
        action: FixAction,
        alt: Option<(FixAction, String)>,
        confirm: bool,
        from_crash: bool,
    ) -> Option<&mut FixStep> {
        if self.steps.iter().any(|s| s.action == action) {
            return None;
        }
        let (alt, alt_name) = match alt {
            Some((a, n)) => (Some(a), Some(n)),
            None => (None, None),
        };
        self.steps.push(FixStep {
            id: format!("s{}", self.steps.len() + 1),
            reason: reason.into(),
            name: name.into(),
            required_by,
            action,
            alt,
            alt_name,
            confirm,
            selected: !confirm,
            from_crash,
            detail: None,
        });
        self.steps.last_mut()
    }
}

/// Vollständiger Plan für eine Instanz. `crash_report`/`exit_code`: ausdrücklich gewählter Absturz (Crash-Dialog);
/// sonst wird die letzte Sitzung ausgewertet, falls sie abgestürzt ist.
pub async fn plan(state: &AppState, instance_id: &str, crash_report: Option<String>, exit_code: Option<i32>) -> AppResult<FixPlan> {
    let inst = state.instances.get(instance_id)?;
    let modded = inst.loader.kind != LoaderKind::Vanilla;
    let issues = if modded { deps::check(state, instance_id, false).await? } else { vec![] };
    let crash_src = if crash_report.is_some() || exit_code.is_some() { Some((crash_report, exit_code)) } else { last_crash(state, instance_id) };
    let crash = crash_src.is_some();
    let diags = match crash_src {
        Some((r, c)) => crash::analyze_instance(state, instance_id, r, c).await.unwrap_or_default(),
        None => vec![],
    };
    let (scanned, idx): (Vec<local::Scanned>, ContentIndex) = if modded { local::scan(state, instance_id, ContentKind::Mod).await? } else { (vec![], ContentIndex::default()) };
    let names: HashMap<String, String> = scanned.iter().map(|s| (s.file_name.clone(), s.meta.name.clone().unwrap_or_else(|| display_name(&s.file_name)))).collect();
    let by_file: HashMap<&str, &local::Scanned> = scanned.iter().map(|s| (s.file_name.as_str(), s)).collect();
    let need = needs(&issues, &diags, &names);
    let origin = |file: &str| idx.files.get(&index::key("mods", index::strip_disabled(file))).cloned();

    let mut b = Builder { steps: vec![], unfixable: vec![] };
    let mut gone: HashSet<String> = HashSet::new();
    for n in &need {
        match n {
            Need::Disable { file, .. } | Need::Swap { file, .. } | Need::Update { file, .. } => {
                gone.insert(file.clone());
            }
            _ => {}
        }
    }

    for n in need {
        match n {
            Need::Disable { file, name, reason, confirm, alt, from_crash } => {
                let alt = alt.map(|(f, n)| (FixAction::Disable { file_name: f }, n));
                b.step(&reason, &name, vec![], FixAction::Disable { file_name: file }, alt, confirm, from_crash);
            }
            Need::Enable { file, name, required_by, from_crash } => {
                b.step("disabled_dependency", &name, required_by, FixAction::Enable { file_name: file }, None, false, from_crash);
            }
            Need::Swap { file, name, reason, from_crash } => {
                // Bei falschem Loader: für welchen Loader die Mod gebaut ist (Anzeige)
                let mod_loader = by_file.get(file.as_str()).and_then(|s| s.meta.loader.clone()).filter(|_| reason == "wrong_loader");
                let o = origin(&file);
                let v = match &o {
                    Some(o) => best(state, &inst, o.source, &o.project_id).await.filter(|v| v.id != o.version_id),
                    None => None,
                };
                match (o, v) {
                    (Some(o), Some(v)) => {
                        let manual = locked(state, &v).await;
                        let title = o.title.clone().unwrap_or_else(|| name.clone());
                        if let Some(s) = b.step(
                            &reason,
                            &name,
                            vec![],
                            FixAction::Replace {
                                file_name: file.clone(),
                                source: o.source,
                                project_id: o.project_id.clone(),
                                version_id: v.id.clone(),
                                title,
                                from_version: o.version_number.clone(),
                                to_version: v.version_number.clone(),
                                manual,
                            },
                            None,
                            false,
                            from_crash,
                        ) {
                            s.detail = mod_loader.clone();
                        }
                        if manual {
                            // Bis die Datei von Hand geladen ist: alte (unpassende) Datei deaktivieren
                            if let Some(s) = b.step(&reason, &name, vec![], FixAction::Disable { file_name: file }, None, false, from_crash) {
                                s.detail = mod_loader;
                            }
                        }
                    }
                    (None, _) if reason == "wrong_loader" => {
                        // Von Hand hinzugefügte Datei: passende Variante über die Mod-ID auf Modrinth suchen
                        let mod_id = by_file.get(file.as_str()).and_then(|s| s.meta.mod_id.clone());
                        let variant = match &mod_id {
                            Some(id) => match deps::resolve_modrinth(state, id, &inst).await {
                                Some((pid, title)) if !idx.has_project(Source::Modrinth, &pid) && best(state, &inst, Source::Modrinth, &pid).await.is_some() => Some((pid, title)),
                                _ => None,
                            },
                            None => None,
                        };
                        if let Some(s) = b.step(&reason, &name, vec![], FixAction::Disable { file_name: file }, None, false, from_crash) {
                            s.detail = mod_loader.clone();
                        }
                        if let Some((pid, title)) = variant {
                            if let Some(s) = b.step(&reason, &title, vec![], FixAction::Install { source: Source::Modrinth, project_id: pid, title: title.clone() }, None, false, from_crash) {
                                s.detail = mod_loader;
                            }
                        }
                    }
                    _ => {
                        if let Some(s) = b.step(&reason, &name, vec![], FixAction::Disable { file_name: file }, None, false, from_crash) {
                            s.detail = mod_loader;
                        }
                    }
                }
            }
            Need::Update { file, name, required_by } => {
                let o = origin(&file);
                let v = match &o {
                    Some(o) => best(state, &inst, o.source, &o.project_id).await.filter(|v| v.id != o.version_id),
                    None => None,
                };
                match (o, v) {
                    (Some(o), Some(v)) => {
                        let manual = locked(state, &v).await;
                        b.step(
                            "version_mismatch",
                            &name,
                            vec![required_by],
                            FixAction::Replace {
                                file_name: file,
                                source: o.source,
                                project_id: o.project_id.clone(),
                                version_id: v.id.clone(),
                                title: o.title.clone().unwrap_or_else(|| name.clone()),
                                from_version: o.version_number.clone(),
                                to_version: v.version_number.clone(),
                                manual,
                            },
                            None,
                            false,
                            false,
                        );
                    }
                    _ => b.unfixable.push(Unfixable { reason: "no_version".into(), name, detail: Some(required_by) }),
                }
            }
            Need::Install { dep_id, required_by, required_files, from_crash } => {
                let found = deps::resolve_modrinth(state, &dep_id, &inst).await;
                let ok = match &found {
                    Some((pid, _)) => !idx.has_project(Source::Modrinth, pid) && best(state, &inst, Source::Modrinth, pid).await.is_some(),
                    None => false,
                };
                match found {
                    Some((pid, title)) if ok => {
                        b.step(
                            "missing_dependency",
                            &title,
                            required_by,
                            FixAction::Install { source: Source::Modrinth, project_id: pid, title: title.clone() },
                            None,
                            false,
                            from_crash,
                        );
                    }
                    Some((pid, _)) if idx.has_project(Source::Modrinth, &pid) => {}
                    _ => {
                        b.unfixable.push(Unfixable { reason: "dep_not_found".into(), name: dep_id.clone(), detail: Some(required_by.join(", ")) });
                        // Ersatzweise (nur nach Rückfrage): die Mods deaktivieren, die die Abhängigkeit brauchen
                        for f in required_files.iter().filter(|f| !gone.contains(*f)) {
                            b.step("dep_not_found", &names.get(f).cloned().unwrap_or_else(|| display_name(f)), vec![], FixAction::Disable { file_name: f.clone() }, None, true, from_crash);
                        }
                    }
                }
            }
            Need::Java { major } => {
                let all = crate::minecraft::java::list(state).await;
                let path = all.iter().filter(|j| j.major == major).max_by_key(|j| j.managed).map(|j| j.path.clone());
                let current_ok = match inst.java.path.as_deref() {
                    Some(p) => all.iter().any(|j| j.path == p && j.major == major),
                    None => false,
                };
                if !current_ok {
                    b.step("java_version", &format!("Java {major}"), vec![], FixAction::SetJava { major, path }, None, false, true);
                }
            }
            Need::Ram { mb } => {
                b.step("out_of_memory", "", vec![], FixAction::SetRam { mb }, None, false, true);
            }
            Need::Unfixable(u) => b.unfixable.push(u),
        }
    }

    // Loader: Version passt nicht zu den Mods (die aktiv bleiben) / Installation unvollständig
    if modded {
        let files = loaderfix::inspect(&state.paths, &inst);
        let reqs: Vec<deps::LoaderReq> = deps::loader_requirements(&inst, &scanned).into_iter().filter(|r| !gone.contains(&r.file)).collect();
        let available = if loaderfix::needs_versions(&inst, &files, &reqs) {
            match crate::minecraft::loaders::loader_versions(state, inst.loader.kind, &inst.mc_version).await {
                Ok(l) => Some(l),
                Err(e) => {
                    tracing::warn!("Autofix {instance_id}: Loader-Versionen nicht geladen: {e}");
                    None
                }
            }
        } else {
            None
        };
        loader_steps(&inst, loaderfix::loader_needs(&inst, &files, &reqs, available.as_deref()), &mut b);
    }

    // Bekannte Konflikte laut Modrinth (Abhängigkeitstyp „incompatible“ der installierten Version)
    if modded {
        if let Err(e) = known_conflicts(state, &scanned, &idx, &names, &gone, &mut b).await {
            tracing::warn!("Autofix {instance_id}: bekannte Konflikte nicht geprüft: {e}");
        }
    }

    Ok(FixPlan { steps: b.steps, unfixable: b.unfixable, crash })
}

/// Loader-Bedarf als Schritte bzw. Hinweise.
fn loader_steps(inst: &Instance, need: Vec<LoaderNeed>, b: &mut Builder) {
    let kind = inst.loader.kind;
    let label = crate::minecraft::loaders::loader_name(kind);
    for n in need {
        match n {
            LoaderNeed::Set { from, to, reason, required_by, detail } => {
                if let Some(s) = b.step(reason, label, required_by, FixAction::SetLoader { loader: kind, from, to }, None, false, false) {
                    s.detail = detail;
                }
            }
            LoaderNeed::Repair { version, reason, detail } => {
                if let Some(s) = b.step(reason, label, vec![], FixAction::RepairLoader { loader: kind, version }, None, false, false) {
                    s.detail = detail;
                }
            }
            LoaderNeed::Unfixable { reason, detail } => b.unfixable.push(Unfixable { reason: reason.into(), name: label.into(), detail }),
        }
    }
}

/// Installierte Modrinth-Mods, deren Version eine andere installierte Mod als inkompatibel markiert.
async fn known_conflicts(
    state: &AppState,
    scanned: &[local::Scanned],
    idx: &ContentIndex,
    names: &HashMap<String, String>,
    gone: &HashSet<String>,
    b: &mut Builder,
) -> AppResult<()> {
    // Projekt -> aktive Datei
    let mut by_project: HashMap<String, String> = HashMap::new();
    let mut vids: Vec<(String, String)> = vec![];
    for s in scanned.iter().filter(|s| s.enabled && !gone.contains(&s.file_name)) {
        if let Some(e) = idx.files.get(&index::key("mods", &s.file_name)) {
            if e.source == Source::Modrinth {
                by_project.insert(e.project_id.clone(), s.file_name.clone());
                vids.push((e.version_id.clone(), s.file_name.clone()));
            }
        }
    }
    if vids.len() < 2 {
        return Ok(());
    }
    let ids: Vec<String> = vids.iter().map(|(v, _)| v.clone()).collect();
    let versions = mr::raw_versions_batch(state, &ids).await?;
    let file_of: HashMap<&str, &str> = vids.iter().map(|(v, f)| (v.as_str(), f.as_str())).collect();
    let name = |f: &str| names.get(f).cloned().unwrap_or_else(|| display_name(f));
    for c in conflicts_of(&versions, &file_of, &by_project) {
        let (me, other) = c;
        let taken = b.steps.iter().any(|s| matches!(&s.action, FixAction::Disable { file_name } if file_name == &other || file_name == &me));
        if taken {
            continue;
        }
        b.step(
            "known_conflict",
            &name(&other),
            vec![],
            FixAction::Disable { file_name: other.clone() },
            Some((FixAction::Disable { file_name: me.clone() }, name(&me))),
            true,
            false,
        );
    }
    Ok(())
}

/// Konfliktpaare (Datei der markierenden Mod, Datei der markierten Mod), jedes Paar nur einmal.
fn conflicts_of(versions: &[mr::MrVersion], file_of: &HashMap<&str, &str>, by_project: &HashMap<String, String>) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = vec![];
    for v in versions {
        let Some(me) = file_of.get(v.id.as_str()) else { continue };
        for d in v.dependencies.iter().filter(|d| d.dependency_type == "incompatible") {
            let Some(other) = d.project_id.as_ref().and_then(|p| by_project.get(p)) else { continue };
            if other == me || out.iter().any(|(a, b)| (a == me && b == other) || (a == other && b == me)) {
                continue;
            }
            out.push((me.to_string(), other.clone()));
        }
    }
    out
}

// ------------------------------------------------------------------ 3. Ausführen

fn save_report(state: &AppState, instance_id: &str, r: &FixReport) -> AppResult<()> {
    crate::util::write_json_atomic(&report_path(state, instance_id), r)
}

/// Kurze deutsche Zusammenfassung für die Aufgabenliste.
fn summary(r: &FixReport) -> String {
    let ok = r.results.iter().filter(|x| x.ok).count();
    let failed = r.results.len() - ok;
    let mut s = format!("{ok} Problem(e) behoben");
    if failed > 0 {
        s.push_str(&format!(", {failed} fehlgeschlagen"));
    }
    if !r.manual.is_empty() {
        s.push_str(&format!(", {} manuell herunterzuladen", r.manual.len()));
    }
    s
}

/// Reihenfolge: deaktivieren/aktivieren, dann tauschen/installieren, Java/RAM, zuletzt der Loader.
pub fn order(actions: &mut [FixAction]) {
    let rank = |a: &FixAction| match a {
        FixAction::Disable { .. } => 0,
        FixAction::Enable { .. } => 1,
        FixAction::Replace { .. } => 2,
        FixAction::Install { .. } => 3,
        FixAction::SetJava { .. } => 4,
        FixAction::SetRam { .. } => 5,
        // Zuletzt: Installation braucht die gewählte Java-Version (Forge-Installer)
        FixAction::SetLoader { .. } => 6,
        FixAction::RepairLoader { .. } => 7,
    };
    actions.sort_by_key(rank);
}

/// `backup`: gewünschte Sicherung (sonst `Settings.fix_backup`).
pub async fn run_apply(state: AppState, task: TaskHandle, instance_id: String, mut actions: Vec<FixAction>, backup: Option<crate::settings::FixBackup>) -> AppResult<()> {
    let inst = state.instances.get(&instance_id)?;
    if state.game.is_running(&instance_id) {
        return Err(AppError::Invalid("Die Instanz läuft gerade – bitte zuerst das Spiel beenden.".into()));
    }
    if actions.is_empty() {
        return Ok(());
    }
    order(&mut actions);
    // Sicherung zuerst (Bereiche laut Einstellung). Schlägt sie fehl, wird nichts verändert. Bei „Gar keine“
    // lässt sich hinterher nur Java/RAM/Loader zurückstellen.
    let backup = backup.unwrap_or_else(|| state.settings().fix_backup);
    let scopes = snapshots::fix_backup_scopes(&backup);
    let snap = match &scopes {
        Some(sc) => {
            task.stage("Sicherung wird erstellt …", Some(0.0));
            Some(snapshots::create_scoped(&state, &instance_id, SNAPSHOT_NAME, true, sc, Some(&task.sub(0.0, 0.25))).await?)
        }
        None => None,
    };
    task.check()?;
    let mut report = FixReport {
        created: crate::util::now_ms(),
        snapshot_scopes: snap.as_ref().and_then(|s| s.scopes.clone()),
        snapshot_id: snap.map(|s| s.id),
        results: vec![],
        manual: vec![],
        prev_java: None,
        prev_loader: None,
        undone: false,
    };
    let n = actions.len().max(1) as f64;
    let mut java = inst.java.clone();
    let mut java_changed = false;
    for (i, a) in actions.into_iter().enumerate() {
        let from = 0.25 + 0.7 * i as f64 / n;
        let to = 0.25 + 0.7 * (i + 1) as f64 / n;
        let res: AppResult<()> = async {
            match &a {
                FixAction::Disable { file_name } => {
                    task.stage(format!("Deaktiviere {} …", display_name(file_name)), Some(from));
                    if file_name.ends_with(".disabled") {
                        return Ok(());
                    }
                    local::set_enabled(&state, &instance_id, ContentKind::Mod, file_name, false).await.map(|_| ())
                }
                FixAction::Enable { file_name } => {
                    task.stage(format!("Aktiviere {} …", display_name(file_name)), Some(from));
                    local::set_enabled(&state, &instance_id, ContentKind::Mod, file_name, true).await.map(|_| ())
                }
                FixAction::Replace { source, project_id, version_id, title, .. } => {
                    task.stage(format!("{title} wird getauscht …"), Some(from));
                    let m = install_one(&state, &inst, *source, project_id, Some(version_id.clone()), &task, from, to).await?;
                    report.manual.extend(m);
                    Ok(())
                }
                FixAction::Install { source, project_id, title } => {
                    task.stage(format!("{title} wird installiert …"), Some(from));
                    let m = install_one(&state, &inst, *source, project_id, None, &task, from, to).await?;
                    report.manual.extend(m);
                    Ok(())
                }
                FixAction::SetJava { major, path } => {
                    let p = match path.clone().filter(|p| std::path::Path::new(p).exists()) {
                        Some(p) => p,
                        None => {
                            task.stage(format!("Java {major} wird heruntergeladen …"), Some(from));
                            crate::minecraft::java::install_major(&state, *major, Some(&task.sub(from, to))).await?.to_string_lossy().into_owned()
                        }
                    };
                    java.path = Some(p);
                    java_changed = true;
                    state.instances.patch(&instance_id, InstancePatch { java: Some(java.clone()), ..Default::default() })?;
                    Ok(())
                }
                FixAction::SetRam { mb } => {
                    java.max_memory_mb = Some(*mb);
                    java.min_memory_mb = Some(java.min_memory_mb.unwrap_or(512).min(*mb));
                    java_changed = true;
                    state.instances.patch(&instance_id, InstancePatch { java: Some(java.clone()), ..Default::default() })?;
                    Ok(())
                }
                FixAction::SetLoader { loader, to: target, .. } => {
                    let cur = state.instances.get(&instance_id)?;
                    if cur.loader.kind != *loader {
                        return Err(AppError::Invalid("Der Loader der Instanz wurde inzwischen geändert".into()));
                    }
                    let name = crate::minecraft::loaders::loader_name(*loader);
                    task.stage(format!("{name} {target} wird installiert …"), Some(from));
                    let prev = cur.loader.clone();
                    state.instances.modify(&instance_id, |i| i.loader.version = Some(target.clone()))?;
                    match crate::minecraft::install_instance_opts(&state, &instance_id, &task.sub(from, to), false).await {
                        Ok(_) => {
                            report.prev_loader.get_or_insert(prev);
                            Ok(())
                        }
                        Err(e) => {
                            // Nicht halb umgestellt zurücklassen: alte Version bleibt eingestellt
                            let _ = state.instances.modify(&instance_id, |i| i.loader = prev);
                            Err(e)
                        }
                    }
                }
                FixAction::RepairLoader { loader, .. } => {
                    let cur = state.instances.get(&instance_id)?;
                    if cur.loader.kind != *loader {
                        return Err(AppError::Invalid("Der Loader der Instanz wurde inzwischen geändert".into()));
                    }
                    let name = crate::minecraft::loaders::loader_name(*loader);
                    task.stage(format!("{name} wird neu installiert …"), Some(from));
                    crate::minecraft::install_instance_opts(&state, &instance_id, &task.sub(from, to), true).await.map(|_| ())
                }
            }
        }
        .await;
        if matches!(res, Err(AppError::Cancelled)) {
            if java_changed {
                report.prev_java = Some(inst.java.clone());
            }
            save_report(&state, &instance_id, &report)?;
            return Err(AppError::Cancelled);
        }
        if let Err(e) = &res {
            tracing::warn!("Autofix {instance_id}: {a:?} fehlgeschlagen: {e}");
        }
        report.results.push(StepResult { ok: res.is_ok(), error: res.err().map(|e| e.to_string()), action: a });
    }
    if java_changed {
        report.prev_java = Some(inst.java.clone());
    }
    if !report.manual.is_empty() {
        missing::watch(&state, &instance_id, missing::WATCH_FOR);
    }
    save_report(&state, &instance_id, &report)?;
    state.content.emit_changed(&instance_id);
    task.message(summary(&report));
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn install_one(
    state: &AppState,
    inst: &Instance,
    source: Source,
    project_id: &str,
    version_id: Option<String>,
    task: &TaskHandle,
    from: f64,
    to: f64,
) -> AppResult<Vec<MissingDownload>> {
    if source == Source::Curseforge {
        super::curseforge::key(state)?;
    }
    let (_, idx) = local::refresh(state, &inst.id, ContentKind::Mod).await?;
    let mut warnings = vec![];
    let planned = install::plan(state, inst, &idx, vec![(source, project_id.to_string(), version_id)], &mut warnings).await?;
    for w in &warnings {
        tracing::warn!("Autofix {}: {w}", inst.id);
    }
    install::apply(state, inst, planned, &task.sub(from, to)).await
}

// ------------------------------------------------------------------ 4. Rückgängig

/// Lässt sich etwas zurückstellen? Ohne Sicherung nur Java/RAM, Loader und vorgemerkte Downloads.
pub fn can_undo(r: &FixReport) -> bool {
    r.snapshot_id.is_some() || r.prev_java.is_some() || r.prev_loader.is_some() || !r.manual.is_empty()
}

pub async fn run_undo(state: AppState, task: TaskHandle, instance_id: String) -> AppResult<()> {
    let mut r = last_report(&state, &instance_id).ok_or_else(|| AppError::NotFound("Kein Durchlauf von „Probleme beheben“".into()))?;
    if r.undone {
        return Err(AppError::Invalid("Wurde bereits rückgängig gemacht".into()));
    }
    if !can_undo(&r) {
        return Err(AppError::Invalid("Ohne Sicherung lässt sich dieser Durchlauf nicht rückgängig machen".into()));
    }
    if let Some(s) = &r.snapshot_id {
        task.stage("Stand vor dem Beheben wird wiederhergestellt …", Some(0.0));
        snapshots::restore(&state, &instance_id, s, Some(&task.sub(0.0, 0.95))).await?;
    }
    if let Some(j) = r.prev_java.clone() {
        state.instances.patch(&instance_id, InstancePatch { java: Some(j), ..Default::default() })?;
    }
    if let Some(l) = r.prev_loader.clone() {
        // Alte Loader-Version wieder einstellen; deren Dateien sind noch da, der nächste Start prüft sie
        state.instances.modify(&instance_id, |i| {
            if i.loader.kind == l.kind {
                i.loader = l;
            }
        })?;
    }
    if !r.manual.is_empty() {
        let files: Vec<String> = r.manual.iter().map(|m| m.file_name.clone()).collect();
        let lock = state.content.lock(&instance_id);
        let _g = lock.lock().await;
        missing::forget(&state.paths, &instance_id, &files)?;
    }
    r.undone = true;
    save_report(&state, &instance_id, &r)?;
    state.content.emit_changed(&instance_id);
    task.message("Rückgängig gemacht");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::crash::Culprit;
    use std::collections::BTreeMap;

    fn issue(kind: IssueKind, file: &str, name: &str, target: Option<&str>, other: Option<&str>, fixes: Vec<Fix>) -> DepIssue {
        DepIssue {
            kind,
            severity: "error".into(),
            file_name: file.into(),
            mod_name: name.into(),
            target: target.map(Into::into),
            other_file: other.map(Into::into),
            message: format!("{name}: {kind:?}"),
            fixes,
        }
    }

    fn diag(id: &str, file: Option<&str>, name: Option<&str>, actions: Vec<CrashAction>) -> Diagnosis {
        Diagnosis {
            id: id.into(),
            confidence: 90,
            culprit: Some(Culprit { mod_id: name.map(|n| n.to_lowercase()), name: name.map(Into::into), file: file.map(Into::into) }),
            params: BTreeMap::new(),
            actions,
            evidence: None,
        }
    }

    #[test]
    fn missing_deps_are_grouped_and_skip_removed_mods() {
        let issues = vec![
            issue(IssueKind::MissingDependency, "a.jar", "A", Some("fabric-api"), None, vec![]),
            issue(IssueKind::MissingDependency, "b.jar", "B", Some("Fabric-API"), None, vec![]),
            // c wird für den falschen Loader gebaut -> dessen Abhängigkeiten sind egal
            issue(IssueKind::WrongLoader, "c.jar", "C", None, None, vec![]),
            issue(IssueKind::MissingDependency, "c.jar", "C", Some("forgeonly"), None, vec![]),
        ];
        let n = needs(&issues, &[], &HashMap::new());
        let installs: Vec<&Need> = n.iter().filter(|x| matches!(x, Need::Install { .. })).collect();
        assert_eq!(installs.len(), 1, "{n:#?}");
        assert!(matches!(installs[0], Need::Install { dep_id, required_by, required_files, .. }
            if dep_id == "fabric-api" && required_by == &vec!["A".to_string(), "B".to_string()] && required_files.len() == 2));
        assert!(n.iter().any(|x| matches!(x, Need::Swap { file, reason, .. } if file == "c.jar" && reason == "wrong_loader")));
    }

    #[test]
    fn duplicates_are_disabled_not_removed() {
        let issues = vec![
            issue(IssueKind::Duplicate, "sodium-2.jar", "Sodium", Some("sodium"), None, vec![Fix::Remove { file_names: vec!["sodium-1.jar".into()] }]),
            // Dieselbe Datei hat zusätzlich eine fehlende Abhängigkeit -> wird nicht gebraucht
            issue(IssueKind::MissingDependency, "sodium-1.jar", "Sodium", Some("x"), None, vec![]),
        ];
        let n = needs(&issues, &[], &HashMap::new());
        assert_eq!(n.len(), 1, "{n:#?}");
        assert!(matches!(&n[0], Need::Disable { file, reason, confirm: false, .. } if file == "sodium-1.jar" && reason == "duplicate"));
    }

    #[test]
    fn conflicts_need_confirmation_and_offer_alternative() {
        let issues = vec![
            issue(IssueKind::Incompatible, "a.jar", "A", Some("b"), Some("b.jar"), vec![]),
            issue(IssueKind::Incompatible, "b.jar", "B", Some("a"), Some("a.jar"), vec![]),
        ];
        let mut names = HashMap::new();
        names.insert("b.jar".to_string(), "Bee".to_string());
        let n = needs(&issues, &[], &names);
        assert_eq!(n.len(), 1, "Paar nur einmal: {n:#?}");
        assert!(matches!(&n[0], Need::Disable { file, name, confirm: true, alt: Some((af, an)), .. }
            if file == "b.jar" && name == "Bee" && af == "a.jar" && an == "A"));
    }

    #[test]
    fn version_mismatch_updates_dependency_or_reports_loader() {
        let issues = vec![
            issue(IssueKind::VersionMismatch, "a.jar", "A", Some("cloth-config"), Some("cloth-1.jar"), vec![]),
            issue(IssueKind::VersionMismatch, "a.jar", "A", Some("fabricloader"), None, vec![]),
            issue(IssueKind::DisabledDependency, "a.jar", "A", Some("lib"), None, vec![Fix::Enable { file_name: "lib.jar.disabled".into(), title: "Lib".into() }]),
        ];
        let n = needs(&issues, &[], &HashMap::new());
        assert!(n.iter().any(|x| matches!(x, Need::Update { file, required_by, .. } if file == "cloth-1.jar" && required_by == "A")));
        // Loader-Version übernimmt loaderfix (Version anheben) -> hier weder Bedarf noch Hinweis
        assert!(!n.iter().any(|x| matches!(x, Need::Unfixable(_))), "{n:#?}");
        assert!(n.iter().any(|x| matches!(x, Need::Enable { file, name, .. } if file == "lib.jar.disabled" && name == "Lib")));
    }

    #[test]
    fn crash_diagnoses_merge_with_dependency_check() {
        let issues = vec![issue(IssueKind::MissingDependency, "a.jar", "A", Some("fabric-api"), None, vec![])];
        let diags = vec![
            diag("missing_dependency", Some("a.jar"), Some("A"), vec![CrashAction::InstallDependency { mod_id: "fabric-api".into(), name: None }]),
            diag("missing_dependency", Some("b.jar"), Some("B"), vec![CrashAction::InstallDependency { mod_id: "cloth-config".into(), name: None }]),
            diag("java_version", None, None, vec![CrashAction::SetJava { major: 21 }]),
            diag("java_version", None, None, vec![CrashAction::SetJava { major: 17 }]),
            diag("suspected_mod", Some("weird.jar"), Some("Weird"), vec![CrashAction::DisableMod { file: "weird.jar".into() }]),
            diag("graphics", None, None, vec![CrashAction::UpdateDrivers]),
        ];
        let n = needs(&issues, &diags, &HashMap::new());
        let installs: Vec<_> = n.iter().filter_map(|x| if let Need::Install { dep_id, from_crash, .. } = x { Some((dep_id.as_str(), *from_crash)) } else { None }).collect();
        assert_eq!(installs, vec![("fabric-api", false), ("cloth-config", true)]);
        assert_eq!(n.iter().filter(|x| matches!(x, Need::Java { major: 21 })).count(), 1);
        assert!(!n.iter().any(|x| matches!(x, Need::Java { major: 17 })));
        assert!(n.iter().any(|x| matches!(x, Need::Disable { file, reason, confirm: true, .. } if file == "weird.jar" && reason == "crash_suspect")));
        assert!(n.iter().any(|x| matches!(x, Need::Unfixable(u) if u.reason == "graphics")));
    }

    #[test]
    fn crash_wrong_minecraft_is_swapped_once() {
        let issues = vec![issue(IssueKind::WrongMinecraft, "old.jar", "Old", Some("minecraft"), None, vec![])];
        let diags = vec![diag("wrong_minecraft", Some("old.jar"), Some("Old"), vec![CrashAction::DisableMod { file: "old.jar".into() }])];
        let n = needs(&issues, &diags, &HashMap::new());
        assert_eq!(n.iter().filter(|x| matches!(x, Need::Swap { .. })).count(), 1, "{n:#?}");
    }

    #[test]
    fn known_conflicts_from_modrinth_versions() {
        let v = |id: &str, deps: &[(&str, &str)]| mr::MrVersion {
            id: id.into(),
            dependencies: deps.iter().map(|(p, t)| mr::MrDependency { project_id: Some((*p).into()), version_id: None, dependency_type: (*t).into() }).collect(),
            ..Default::default()
        };
        let versions = vec![v("va", &[("pb", "incompatible"), ("pc", "required")]), v("vb", &[("pa", "incompatible")]), v("vc", &[])];
        let file_of: HashMap<&str, &str> = [("va", "a.jar"), ("vb", "b.jar"), ("vc", "c.jar")].into_iter().collect();
        let by_project: HashMap<String, String> = [("pa", "a.jar"), ("pb", "b.jar"), ("pc", "c.jar")].into_iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
        let c = conflicts_of(&versions, &file_of, &by_project);
        assert_eq!(c, vec![("a.jar".to_string(), "b.jar".to_string())]);
    }

    #[test]
    fn actions_roundtrip_and_order() {
        let mut a = vec![
            FixAction::SetRam { mb: 6144 },
            FixAction::Install { source: Source::Modrinth, project_id: "P7dR8mSH".into(), title: "Fabric API".into() },
            FixAction::Disable { file_name: "x.jar".into() },
            FixAction::SetJava { major: 21, path: None },
            FixAction::Enable { file_name: "y.jar.disabled".into() },
            FixAction::RepairLoader { loader: LoaderKind::Fabric, version: Some("0.16.9".into()) },
            FixAction::SetLoader { loader: LoaderKind::Fabric, from: Some("0.16.9".into()), to: "0.16.14".into() },
        ];
        order(&mut a);
        assert!(matches!(a[0], FixAction::Disable { .. }));
        assert!(matches!(a[1], FixAction::Enable { .. }));
        assert!(matches!(a[3], FixAction::SetJava { .. }), "Java vor dem Loader (Forge-Installer braucht es)");
        assert!(matches!(a[4], FixAction::SetRam { .. }));
        assert!(matches!(a[5], FixAction::SetLoader { .. }));
        assert!(matches!(a[6], FixAction::RepairLoader { .. }));
        let json = serde_json::to_string(&a).unwrap();
        assert!(json.contains(r#""kind":"set_java""#), "{json}");
        assert!(json.contains(r#""kind":"set_loader","loader":"fabric","from":"0.16.9","to":"0.16.14""#), "{json}");
        let back: Vec<FixAction> = serde_json::from_str(&json).unwrap();
        assert_eq!(back, a);
        // Frontend schickt `manual`/`path` evtl. nicht mit
        let r: FixAction = serde_json::from_str(r#"{"kind":"replace","file_name":"a.jar","source":"modrinth","project_id":"p","version_id":"v","title":"A","from_version":null,"to_version":"2"}"#).unwrap();
        assert!(matches!(r, FixAction::Replace { manual: false, .. }));
        let l: FixAction = serde_json::from_str(r#"{"kind":"repair_loader","loader":"neoforge"}"#).unwrap();
        assert_eq!(l, FixAction::RepairLoader { loader: LoaderKind::Neoforge, version: None });
        // Alte Berichte ohne prev_loader bleiben lesbar
        let rep: FixReport = serde_json::from_str(r#"{"created":1,"snapshot_id":null,"results":[],"manual":[],"prev_java":null}"#).unwrap();
        assert!(rep.snapshot_scopes.is_none());
        assert!(!can_undo(&rep));
        assert!(rep.prev_loader.is_none());
    }

    #[test]
    fn wrong_loader_mods_are_swapped_not_deleted() {
        // Forge-Mod in Fabric-Instanz: Tauschen (sonst deaktivieren), ihre Abhängigkeiten zählen nicht mehr
        let issues = vec![
            issue(IssueKind::WrongLoader, "create-forge.jar", "Create", None, None, vec![Fix::Disable { file_name: "create-forge.jar".into() }]),
            issue(IssueKind::MissingDependency, "create-forge.jar", "Create", Some("flywheel"), None, vec![]),
            issue(IssueKind::VersionMismatch, "create-forge.jar", "Create", Some("forge"), None, vec![]),
        ];
        let n = needs(&issues, &[], &HashMap::new());
        assert_eq!(n.len(), 1, "{n:#?}");
        assert!(matches!(&n[0], Need::Swap { file, reason, .. } if file == "create-forge.jar" && reason == "wrong_loader"));
    }

    #[test]
    fn loader_needs_become_steps_and_hints() {
        let inst: Instance = serde_json::from_value(serde_json::json!({
            "id": "x", "name": "x", "icon": null, "accent": null, "group": null, "mc_version": "1.21.1",
            "loader": Loader { kind: LoaderKind::Fabric, version: Some("0.16.9".into()) }, "created_at": 0
        }))
        .unwrap();
        let mut b = Builder { steps: vec![], unfixable: vec![] };
        loader_steps(
            &inst,
            vec![
                LoaderNeed::Set { from: Some("0.16.9".into()), to: "0.16.14".into(), reason: "loader_too_old", required_by: vec!["Create".into()], detail: Some("Create >=0.16.10".into()) },
                LoaderNeed::Repair { version: Some("0.16.9".into()), reason: "loader_files_broken", detail: Some("2".into()) },
                LoaderNeed::Unfixable { reason: "loader_offline", detail: None },
            ],
            &mut b,
        );
        assert_eq!(b.steps.len(), 2);
        let s = &b.steps[0];
        assert_eq!((s.reason.as_str(), s.name.as_str(), s.selected, s.confirm), ("loader_too_old", "Fabric", true, false));
        assert_eq!(s.required_by, vec!["Create".to_string()]);
        assert_eq!(s.detail.as_deref(), Some("Create >=0.16.10"));
        assert!(matches!(&s.action, FixAction::SetLoader { loader: LoaderKind::Fabric, to, .. } if to == "0.16.14"));
        assert!(matches!(&b.steps[1].action, FixAction::RepairLoader { .. }));
        assert_eq!(b.unfixable, vec![Unfixable { reason: "loader_offline".into(), name: "Fabric".into(), detail: None }]);
    }
}
