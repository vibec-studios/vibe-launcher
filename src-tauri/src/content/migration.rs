use super::index::{self, ContentIndex, IndexEntry};
use super::{install, local, modrinth, provider, snapshots, ContentKind, DependencyKind, ProjectType, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{Instance, Loader, LoaderKind};
use crate::net::DownloadItem;
use crate::state::AppState;
use crate::tasks::{TaskHandle, TaskStatus};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

mod files;
use files::{commit, Stage};

const TASK: &str = "version_change";
type Project = (Source, String);

pub(super) fn text<'a>(state: &AppState, german: &'a str, english: &'a str) -> &'a str {
    if state.settings().language == "en" {
        english
    } else {
        german
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct GameVersion {
    pub mc_version: String,
    pub loader: Loader,
}

impl From<&Instance> for GameVersion {
    fn from(inst: &Instance) -> Self {
        Self {
            mc_version: inst.mc_version.clone(),
            loader: inst.loader.clone(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum Problem {
    Unknown,
    Unavailable,
    Pinned,
    Manual,
    Dependencies,
    Conflict,
    CheckFailed,
}

#[derive(Serialize)]
struct PreviewItem {
    file_name: String,
    title: String,
    version: Option<String>,
    problem: Option<Problem>,
}

#[derive(Serialize)]
pub struct Preview {
    token: String,
    items: Vec<PreviewItem>,
    dependencies: Vec<String>,
}

struct Existing {
    scan: local::Scanned,
    origin: Option<IndexEntry>,
    pinned: bool,
}

impl Existing {
    fn project(&self) -> Option<Project> {
        self.origin.as_ref().map(|e| (e.source, e.project_id.clone()))
    }
}

struct Selected {
    planned: install::Planned,
    enabled: bool,
}

struct Plan {
    before: GameVersion,
    files: Vec<Existing>,
    selected: Vec<Selected>,
    preview: Preview,
}

fn project(p: &install::Planned) -> Project {
    (p.source, p.brief.id.clone())
}

fn file_name(p: &install::Planned) -> String {
    crate::paths::sanitize_file_name(&p.file.filename)
}

fn mod_version(p: &install::Planned, target: &Instance) -> bool {
    p.kind == ContentKind::Mod
        && target.loader.kind != LoaderKind::Vanilla
        && provider::compatible(&p.version, p.brief.project_type, &target.mc_version, target.loader.kind)
        && ["jar", "zip", "litemod"]
            .iter()
            .any(|ext| Path::new(&file_name(p)).extension().is_some_and(|e| e.eq_ignore_ascii_case(ext)))
}

fn existing_download<'a>(p: &install::Planned, files: &'a [Existing]) -> Option<&'a Path> {
    let key = project(p);
    files
        .iter()
        .find(|file| {
            file.project().as_ref() == Some(&key)
                && file.origin.as_ref().is_some_and(|e| e.version_id == p.version.id)
                && p.file
                    .sha1
                    .as_ref()
                    .map_or(true, |sha| file.scan.meta.sha1.as_ref().is_some_and(|local| local.eq_ignore_ascii_case(sha)))
        })
        .map(|file| file.scan.path.as_path())
}

async fn resolve(state: &AppState, target: &Instance, file: &Existing, files: &[Existing]) -> Result<Vec<install::Planned>, Problem> {
    let origin = file.origin.as_ref().ok_or(Problem::Unknown)?;
    let loader = target.loader.kind;
    if loader == LoaderKind::Vanilla {
        return Err(Problem::Unavailable);
    }
    let mc = &target.mc_version;
    let (mut versions, preferred, kind) = provider::versions_for(state, origin.source, &origin.project_id, Some(mc), Some(loader))
        .await
        .map_err(|e| {
            if matches!(e, AppError::NotFound(_)) {
                Problem::Unavailable
            } else {
                Problem::CheckFailed
            }
        })?;
    versions.retain(|v| kind != ProjectType::Modpack && provider::target_kind(kind, v, loader, mc) == ContentKind::Mod && !v.files.is_empty());
    let version = versions
        .iter()
        .find(|v| v.id == origin.version_id)
        .cloned()
        .or_else(|| (!file.pinned).then(|| provider::pick_best(&versions, preferred.as_deref())).flatten())
        .ok_or(if file.pinned { Problem::Pinned } else { Problem::Unavailable })?;

    let mut warnings = vec![];
    let root = (origin.source, origin.project_id.clone(), Some(version.id));
    let mut planned = install::plan(state, target, &ContentIndex::default(), vec![root], &mut warnings)
        .await
        .map_err(|_| Problem::CheckFailed)?;
    if !warnings.is_empty() || planned.is_empty() || planned.iter().any(|p| !mod_version(p, target)) {
        return Err(Problem::Dependencies);
    }
    for p in &planned {
        for dep in p.version.dependencies.iter().filter(|d| d.kind == DependencyKind::Required) {
            let source = dep.source.unwrap_or(p.source);
            if !planned.iter().any(|d| {
                d.source == source
                    && dep.project_id.as_ref().map_or(true, |id| id == &d.brief.id)
                    && dep.version_id.as_ref().map_or(true, |id| id == &d.version.id)
                    && (dep.project_id.is_some() || dep.version_id.is_some())
            }) {
                return Err(Problem::Dependencies);
            }
        }
    }
    let hashes: Vec<_> = planned
        .iter()
        .filter(|p| p.file.url.is_none() && existing_download(p, files).is_none())
        .filter_map(|p| p.file.sha1.clone())
        .collect();
    let mirrors = modrinth::mirrors(state, &hashes).await;
    for p in &mut planned {
        if p.file.url.is_none() {
            p.file.url = p.file.sha1.as_ref().and_then(|h| mirrors.get(&h.to_ascii_lowercase())).map(|m| m.url.clone());
        }
    }
    if planned.iter().any(|p| p.file.url.is_none() && existing_download(p, files).is_none()) {
        return Err(Problem::Manual);
    }
    Ok(planned)
}

fn merge(selected: &mut Vec<Selected>, incoming: Vec<install::Planned>, file: &Existing, files: &[Existing]) -> Result<(), Problem> {
    let mut names = HashMap::new();
    for p in &incoming {
        let key = project(p);
        let name = file_name(p);
        if names.insert(name.to_lowercase(), &p.brief.id).is_some()
            || files.iter().any(|f| {
                f.project().as_ref() != Some(&key) && index::strip_disabled(&f.scan.file_name).eq_ignore_ascii_case(&name)
                    || f.project().as_ref() == Some(&key) && f.pinned && f.origin.as_ref().is_some_and(|e| e.version_id != p.version.id)
            })
            || selected.iter().any(|s| {
                let other = &s.planned;
                if project(other) == key {
                    other.version.id != p.version.id
                } else {
                    file_name(other).eq_ignore_ascii_case(&name)
                }
            })
        {
            return Err(Problem::Conflict);
        }
    }
    for planned in incoming {
        if let Some(s) = selected.iter_mut().find(|s| project(&s.planned) == project(&planned)) {
            s.enabled |= file.scan.enabled;
        } else {
            selected.push(Selected {
                planned,
                enabled: file.scan.enabled,
            });
        }
    }
    Ok(())
}

async fn prepare(state: &AppState, id: &str, version: &GameVersion) -> AppResult<Plan> {
    let mut target = state.instances.get(id)?;
    let before = GameVersion::from(&target);
    if target.is_bedrock()
        || version == &before
        || version.mc_version.is_empty()
        || (version.loader.kind != LoaderKind::Vanilla && version.loader.version.is_none())
    {
        return Err(AppError::Invalid(
            "Bitte eine andere Java-Version oder einen anderen Mod-Loader auswählen".into(),
        ));
    }
    target.mc_version = version.mc_version.clone();
    target.loader = version.loader.clone();
    let (scanned, idx) = local::refresh(state, id, ContentKind::Mod).await?;
    let mut files: Vec<_> = scanned
        .into_iter()
        .map(|scan| Existing {
            origin: idx.files.get(&scan.key).cloned(),
            pinned: idx.pinned.contains(&scan.key),
            scan,
        })
        .collect();
    files.sort_by(|a, b| b.scan.enabled.cmp(&a.scan.enabled).then_with(|| a.scan.file_name.cmp(&b.scan.file_name)));
    let checks: Vec<_> = files.iter().map(|f| resolve(state, &target, f, &files)).collect();
    let results = futures::stream::iter(checks)
        .buffered(6)
        .collect::<Vec<_>>()
        .await;
    let mut selected = Vec::<Selected>::new();
    let problems: Vec<_> = files
        .iter()
        .zip(results)
        .map(|(f, r)| r.and_then(|p| merge(&mut selected, p, f, &files)).err())
        .collect();
    let items: Vec<_> = files
        .iter()
        .zip(problems)
        .map(|(f, problem)| {
            let selected = f.project().and_then(|key| selected.iter().find(|s| project(&s.planned) == key));
            PreviewItem {
                file_name: f.scan.file_name.clone(),
                title: f
                    .origin
                    .as_ref()
                    .and_then(|o| o.title.clone())
                    .or_else(|| f.scan.meta.name.clone())
                    .unwrap_or_else(|| f.scan.file_name.clone()),
                version: selected.map(|s| s.planned.version.version_number.clone()),
                problem: if selected.is_some() { None } else { problem },
            }
        })
        .collect();
    let dependencies = selected
        .iter()
        .filter(|s| !files.iter().any(|f| f.project() == Some(project(&s.planned))))
        .map(|s| s.planned.brief.title.clone())
        .collect();
    let inventory: Vec<_> = files
        .iter()
        .map(|f| (&f.scan.file_name, f.scan.modified, f.scan.size, &f.scan.meta.sha1, f.project(), f.pinned))
        .collect();
    let targets: Vec<_> = selected
        .iter()
        .map(|s| {
            (
                project(&s.planned),
                &s.planned.version.id,
                file_name(&s.planned),
                &s.planned.file.sha1,
                s.enabled,
            )
        })
        .collect();
    let token = format!("{:x}", Sha1::digest(serde_json::to_vec(&(&before, version, inventory, targets, &items))?));
    Ok(Plan {
        before,
        files,
        selected,
        preview: Preview { token, items, dependencies },
    })
}

pub async fn preview(state: &AppState, id: &str, version: GameVersion) -> AppResult<Preview> {
    Ok(prepare(state, id, &version).await?.preview)
}

pub fn guard(state: &AppState, id: &str) -> AppResult<()> {
    if state
        .tasks
        .list()
        .iter()
        .any(|t| t.instance_id.as_deref() == Some(id) && t.kind == TASK && t.status == TaskStatus::Running)
    {
        return Err(AppError::Invalid("Der Versionswechsel läuft noch".into()));
    }
    Ok(())
}

pub async fn start(state: &AppState, id: String, version: GameVersion, token: String) -> AppResult<String> {
    let lock = state.content.lock(&id);
    let _guard = lock.lock().await;
    state.instances.get(&id)?;
    guard(state, &id)?;
    idle(state, &id, None)?;
    let st = state.clone();
    Ok(state.tasks.spawn(
        TASK,
        text(state, "Minecraft-Version wird gewechselt", "Switching Minecraft version"),
        Some(id.clone()),
        move |task| async move { run(&st, &id, version, token, task).await },
    ))
}

fn idle(state: &AppState, id: &str, own_task: Option<&str>) -> AppResult<()> {
    if state.game.is_running(id)
        || state
            .tasks
            .list()
            .iter()
            .any(|t| t.instance_id.as_deref() == Some(id) && t.status == TaskStatus::Running && Some(t.id.as_str()) != own_task)
    {
        return Err(AppError::Invalid(
            "Beende das Spiel und warte, bis laufende Aufgaben der Instanz abgeschlossen sind".into(),
        ));
    }
    Ok(())
}

fn stale() -> AppError {
    AppError::Invalid("Die Mods oder die Zielversion haben sich geändert. Öffne die Vorschau erneut.".into())
}

async fn run(state: &AppState, id: &str, version: GameVersion, token: String, task: TaskHandle) -> AppResult<()> {
    task.stage(
        text(state, "Mods für die Zielversion werden geprüft …", "Checking mods for the target version …"),
        None,
    );
    let plan = prepare(state, id, &version).await?;
    if token != plan.preview.token {
        return Err(stale());
    }
    task.check()?;
    let mut stage = Stage::new(&state.paths.instance_dir(id))?;
    task.stage(text(state, "Passende Mods werden geladen …", "Downloading compatible mods …"), Some(0.05));
    let mut downloads = Vec::new();
    for (i, s) in plan.selected.iter().enumerate() {
        let path = stage.download(i);
        if let Some(src) = existing_download(&s.planned, &plan.files) {
            if fs::hard_link(src, &path).is_err() {
                fs::copy(src, &path)?;
            }
            continue;
        }
        let file = &s.planned.file;
        let url = file.url.clone().ok_or_else(stale)?;
        downloads.push(DownloadItem::new(url, path).sha1(file.sha1.clone()).size(Some(file.size).filter(|n| *n > 0)));
    }
    state.net.download_all(downloads, Some(&task.sub(0.05, 0.65))).await?;
    task.check()?;
    let (current, _) = local::scan(state, id, ContentKind::Mod).await?;
    let lock = state.content.lock(id);
    let _guard = lock.lock().await;
    idle(state, id, Some(task.id()))?;
    if GameVersion::from(&state.instances.get(id)?) != plan.before
        || current.len() != plan.files.len()
        || !plan.files.iter().all(|f| {
            current
                .iter()
                .any(|c| c.file_name == f.scan.file_name && c.modified == f.scan.modified && c.size == f.scan.size && c.meta.sha1 == f.scan.meta.sha1)
        })
    {
        return Err(stale());
    }
    let old_index = ContentIndex::load(&state.paths, id);
    if plan.files.iter().any(|f| {
        old_index.pinned.contains(&f.scan.key) != f.pinned
            || old_index.files.get(&f.scan.key).map(|e| (&e.source, &e.project_id, &e.version_id))
                != f.origin.as_ref().map(|e| (&e.source, &e.project_id, &e.version_id))
    }) {
        return Err(stale());
    }
    snapshots::before_migration(state, id, plan.before.clone(), &task.sub(0.65, 0.95)).await?;
    task.check()?;
    idle(state, id, Some(task.id()))?;
    let dir = state.paths.game_dir(id).join("mods");
    fs::create_dir_all(&dir)?;
    if dir.canonicalize()? != state.paths.game_dir(id).canonicalize()?.join("mods") {
        return Err(AppError::Invalid("Der Mods-Ordner ist mit einem anderen Ordner verknüpft".into()));
    }
    task.stage(text(state, "Versionswechsel wird angewendet …", "Applying version change …"), Some(0.95));
    let result = commit(state, id, version, plan, &mut stage, &dir, old_index);
    if result.is_ok() {
        state.content.update_counts.lock().remove(id);
        state.content.emit_changed(id);
    }
    result
}
