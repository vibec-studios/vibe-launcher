use crate::error::{AppError, AppResult};
use crate::instance::BedrockChannel;
use crate::state::AppState;
use crate::tasks::{TaskInfo, TaskStatus};
use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct UpdateBlockers {
    pub servers: usize,
    pub games: usize,
    pub tasks: Vec<String>,
    pub bedrock_swap: bool,
}

impl UpdateBlockers {
    pub fn needs_confirm(&self) -> bool {
        self.servers > 0 || self.games > 0 || !self.tasks.is_empty()
    }
}

pub fn busy_tasks(tasks: &[TaskInfo]) -> Vec<String> {
    tasks.iter().filter(|t| t.status == TaskStatus::Running && t.kind != "update" && t.kind != "launch").map(|t| t.title.clone()).collect()
}

fn bedrock_swap_open(state: &AppState) -> bool {
    if crate::bedrock::game::DATA_LOCK.try_lock().is_none() {
        return true;
    }
    [BedrockChannel::Release, BedrockChannel::Preview].into_iter().any(|ch| {
        crate::bedrock::game::adopting(ch)
            || crate::bedrock::target(ch).is_ok_and(|t| crate::bedrock::swapper(&state.paths, &t).active_instance().is_some())
    })
}

pub fn collect(state: &AppState) -> UpdateBlockers {
    UpdateBlockers {
        servers: state.server_mgr.running_count(),
        games: state.game.running_count(),
        tasks: busy_tasks(&state.tasks.list()),
        bedrock_swap: bedrock_swap_open(state),
    }
}

pub const BEDROCK_MSG: &str = "Minecraft Bedrock hat gerade ein Profil eingetauscht. Bitte schließe Bedrock und warte, bis die Welten zurückgetauscht sind – danach kannst du aktualisieren.";

pub fn ensure_allowed(b: &UpdateBlockers, force: bool) -> AppResult<()> {
    if b.bedrock_swap {
        return Err(AppError::Invalid(BEDROCK_MSG.into()));
    }
    if b.needs_confirm() && !force {
        return Err(AppError::Invalid("Es läuft gerade noch etwas (Server, Spiel oder Aufgabe). Bitte bestätige das Update.".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(kind: &str, status: TaskStatus) -> TaskInfo {
        TaskInfo {
            id: kind.into(),
            kind: kind.into(),
            title: format!("T {kind}"),
            instance_id: None,
            progress: None,
            message: None,
            status,
            error: None,
            started_at: 0,
        }
    }

    #[test]
    fn busy_tasks_ignores_update_and_finished() {
        let list = vec![task("update", TaskStatus::Running), task("import", TaskStatus::Running), task("backup", TaskStatus::Done), task("content", TaskStatus::Running)];
        assert_eq!(busy_tasks(&list), vec!["T import".to_string(), "T content".to_string()]);
    }

    #[test]
    fn bedrock_always_blocks() {
        let b = UpdateBlockers { bedrock_swap: true, ..Default::default() };
        assert!(ensure_allowed(&b, true).is_err());
    }

    #[test]
    fn running_server_needs_force() {
        let b = UpdateBlockers { servers: 1, ..Default::default() };
        assert!(ensure_allowed(&b, false).is_err());
        assert!(ensure_allowed(&b, true).is_ok());
        assert!(ensure_allowed(&UpdateBlockers::default(), false).is_ok());
    }
}
