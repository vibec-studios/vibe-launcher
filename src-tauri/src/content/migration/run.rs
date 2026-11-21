use super::*;

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

pub(super) fn idle(state: &AppState, id: &str, own_task: Option<&str>) -> AppResult<()> {
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

pub(super) fn stale() -> AppError {
    AppError::Invalid("Die Mods oder die Zielversion haben sich geändert. Öffne die Vorschau erneut.".into())
}

pub(super) async fn run(state: &AppState, id: &str, version: GameVersion, token: String, task: TaskHandle) -> AppResult<()> {
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
