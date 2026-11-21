use super::*;

/// „Vibey-Client-Instanz erstellen“: neue Fabric-Instanz in der neuesten unterstützten Version (Task-Körper).
pub async fn create_instance(state: AppState, task: TaskHandle) -> AppResult<()> {
    task.stage("Suche den neuesten Vibey Client …", Some(0.02));
    let rel = super::super::latest(&state, true).await?;
    let mc = newest_supported(&state, &rel, "fabric").await.ok_or_else(|| AppError::NotFound("Der Vibey Client hat noch kein Fabric-Jar.".into()))?;
    let inst = state.instances.create(CreateInstance {
        // Zweite Vibey-Instanz heißt „Vibey Client (2)“ usw.
        name: state.instances.unique_name("Vibey Client"),
        mc_version: mc.clone(),
        loader: Loader { kind: LoaderKind::Fabric, version: None },
        icon: None,
        accent: Some("#8b6cff".into()),
        group: None,
    })?;
    task.set_instance(inst.id.clone());
    let mut s = load(&state, &inst.id);
    s.enabled = true;
    save(&state, &inst.id, &s)?;
    let log = |m: String| state.game.launcher_line(&inst.id, LogLevel::Launcher, m);
    sync(&state, &inst.id, &rel, &task, &log).await?;
    task.message(format!("Instanz „{}“ mit Vibey Client {} (Minecraft {mc}) erstellt", inst.name, rel.version));
    Ok(())
}

/// Instanzen mit aktivem Vibey Client (für den Creator-Bereich: Spielordner für den Live-Link).
#[derive(Debug, Clone, Serialize)]
pub struct VibeyInstance {
    pub instance_id: String,
    pub name: String,
    pub mc_version: String,
    pub loader: String,
    pub version: Option<String>,
    pub game_dir: String,
    /// `vibeyclient/devlink.json` existiert (Creator-Modus war an)
    pub devlink: bool,
}

pub fn vibey_instances(state: &AppState) -> Vec<VibeyInstance> {
    state
        .instances
        .list()
        .into_iter()
        .filter_map(|i| {
            let s = load(state, &i.id);
            if !s.enabled {
                return None;
            }
            let game = state.paths.game_dir(&i.id);
            Some(VibeyInstance {
                instance_id: i.id.clone(),
                name: i.name.clone(),
                mc_version: i.mc_version.clone(),
                loader: loader_name(i.loader.kind).unwrap_or("?").to_string(),
                version: s.version.clone(),
                devlink: game.join("vibeyclient").join("devlink.json").is_file(),
                game_dir: game.to_string_lossy().to_string(),
            })
        })
        .collect()
}
