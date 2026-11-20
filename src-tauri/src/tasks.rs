//! Hintergrundaufgaben mit Fortschritt (Downloads, Installationen, Importe ...).
//!
//! Jede Aufgabe sendet `task://update` mit [`TaskInfo`]. Fortschritts-Updates werden auf
//! höchstens ~10/s gedrosselt, Statuswechsel werden immer sofort gesendet.
use crate::error::{AppError, AppResult};
use crate::events;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Running,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskInfo {
    pub id: String,
    /// z. B. "install", "launch", "import", "export", "content", "java", "update"
    pub kind: String,
    pub title: String,
    pub instance_id: Option<String>,
    /// 0.0..=1.0, `None` = unbestimmt
    pub progress: Option<f64>,
    pub message: Option<String>,
    pub status: TaskStatus,
    pub error: Option<String>,
    pub started_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
}

struct Entry {
    info: TaskInfo,
    cancel: CancellationToken,
}

pub struct Tasks {
    app: AppHandle,
    map: Mutex<HashMap<String, Entry>>,
}

impl Tasks {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Tasks { app, map: Mutex::new(HashMap::new()) })
    }

    /// Neue Aufgabe anlegen (ohne sie zu starten). Für Abläufe, die selbst schon in
    /// einem async-Kontext laufen. Am Ende `finish` aufrufen!
    pub fn create(self: &Arc<Self>, kind: &str, title: impl Into<String>, instance_id: Option<String>) -> TaskHandle {
        let id = uuid::Uuid::new_v4().to_string();
        let info = TaskInfo {
            id: id.clone(),
            kind: kind.to_string(),
            title: title.into(),
            instance_id,
            progress: None,
            message: None,
            status: TaskStatus::Running,
            error: None,
            started_at: chrono::Utc::now().timestamp_millis(),
            step: None,
        };
        let cancel = CancellationToken::new();
        self.map.lock().insert(id.clone(), Entry { info: info.clone(), cancel: cancel.clone() });
        events::emit(&self.app, events::TASK_UPDATE, &info);
        TaskHandle {
            inner: Arc::new(HandleInner {
                id,
                tasks: self.clone(),
                cancel,
                last_emit: Mutex::new(Instant::now() - Duration::from_secs(1)),
            }),
        }
    }

    /// Aufgabe anlegen und im Hintergrund ausführen. Gibt die Task-ID zurück.
    pub fn spawn<F, Fut>(self: &Arc<Self>, kind: &str, title: impl Into<String>, instance_id: Option<String>, f: F) -> String
    where
        F: FnOnce(TaskHandle) -> Fut + Send + 'static,
        Fut: Future<Output = AppResult<()>> + Send + 'static,
    {
        let handle = self.create(kind, title, instance_id);
        let id = handle.id().to_string();
        tauri::async_runtime::spawn(async move {
            let h2 = handle.clone();
            let res = f(handle).await;
            h2.finish(res);
        });
        id
    }

    pub fn list(&self) -> Vec<TaskInfo> {
        let mut v: Vec<TaskInfo> = self.map.lock().values().map(|e| e.info.clone()).collect();
        v.sort_by_key(|t| t.started_at);
        v
    }

    pub fn cancel(&self, id: &str) -> bool {
        if let Some(e) = self.map.lock().get(id) {
            e.cancel.cancel();
            true
        } else {
            false
        }
    }

    /// Abgeschlossene Aufgaben aus der Liste entfernen.
    pub fn clear_finished(&self) {
        self.map.lock().retain(|_, e| e.info.status == TaskStatus::Running);
    }

    fn update<F: FnOnce(&mut TaskInfo)>(&self, id: &str, f: F) -> Option<TaskInfo> {
        let mut map = self.map.lock();
        let e = map.get_mut(id)?;
        f(&mut e.info);
        Some(e.info.clone())
    }

    fn emit(&self, info: &TaskInfo) {
        events::emit(&self.app, events::TASK_UPDATE, info);
    }
}

struct HandleInner {
    id: String,
    tasks: Arc<Tasks>,
    cancel: CancellationToken,
    last_emit: Mutex<Instant>,
}

/// Griff auf eine laufende Aufgabe. Klonbar, threadsicher.
#[derive(Clone)]
pub struct TaskHandle {
    inner: Arc<HandleInner>,
}

impl TaskHandle {
    pub fn id(&self) -> &str {
        &self.inner.id
    }

    pub fn cancel_token(&self) -> CancellationToken {
        self.inner.cancel.clone()
    }

    pub fn is_cancelled(&self) -> bool {
        self.inner.cancel.is_cancelled()
    }

    /// `Err(Cancelled)`, wenn der Nutzer abgebrochen hat.
    pub fn check(&self) -> AppResult<()> {
        if self.is_cancelled() { Err(AppError::Cancelled) } else { Ok(()) }
    }

    fn throttled_emit(&self, info: Option<TaskInfo>, force: bool) {
        let Some(info) = info else { return };
        let mut last = self.inner.last_emit.lock();
        if force || last.elapsed() >= Duration::from_millis(100) {
            *last = Instant::now();
            drop(last);
            self.inner.tasks.emit(&info);
        }
    }

    /// Fortschritt 0..=1 setzen (gedrosselt).
    pub fn progress(&self, p: f64) {
        let info = self.inner.tasks.update(&self.inner.id, |i| i.progress = Some(p.clamp(0.0, 1.0)));
        self.throttled_emit(info, false);
    }

    /// Unbestimmten Fortschritt setzen.
    pub fn indeterminate(&self) {
        let info = self.inner.tasks.update(&self.inner.id, |i| i.progress = None);
        self.throttled_emit(info, true);
    }

    /// Statuszeile setzen (wird sofort gesendet).
    pub fn message(&self, msg: impl Into<String>) {
        let msg = msg.into();
        let info = self.inner.tasks.update(&self.inner.id, |i| i.message = Some(msg));
        self.throttled_emit(info, true);
    }

    /// Statuszeile + Fortschritt in einem.
    pub fn stage(&self, msg: impl Into<String>, p: Option<f64>) {
        let msg = msg.into();
        let info = self.inner.tasks.update(&self.inner.id, |i| {
            i.message = Some(msg);
            i.progress = p.map(|p| p.clamp(0.0, 1.0));
        });
        self.throttled_emit(info, true);
    }

    /// Instanz nachträglich zuordnen (z. B. wenn ein Import die Instanz erst anlegt).
    pub fn set_instance(&self, instance_id: impl Into<String>) {
        let id = instance_id.into();
        let info = self.inner.tasks.update(&self.inner.id, |i| i.instance_id = Some(id));
        self.throttled_emit(info, true);
    }

    pub fn set_step(&self, step: Option<&str>) {
        let step = step.map(str::to_string);
        let info = self.inner.tasks.update(&self.inner.id, |i| i.step = step);
        self.throttled_emit(info, true);
    }

    pub fn set_title(&self, title: impl Into<String>) {
        let title = title.into();
        let info = self.inner.tasks.update(&self.inner.id, |i| i.title = title);
        self.throttled_emit(info, true);
    }

    /// Aufgabe abschließen. Wird von `Tasks::spawn` automatisch aufgerufen.
    pub fn finish(&self, res: AppResult<()>) {
        let info = self.inner.tasks.update(&self.inner.id, |i| match &res {
            Ok(()) => {
                i.status = TaskStatus::Done;
                i.progress = Some(1.0);
            }
            Err(AppError::Cancelled) => i.status = TaskStatus::Cancelled,
            Err(e) => {
                i.status = TaskStatus::Failed;
                i.error = Some(e.to_string());
            }
        });
        if let Err(e) = &res {
            if !matches!(e, AppError::Cancelled) {
                tracing::error!(task = %self.inner.id, "Aufgabe fehlgeschlagen: {e}");
            }
        }
        self.throttled_emit(info, true);
    }

    /// Teilfortschritt: bildet 0..1 eines Unterschritts auf [from, to] der Gesamtaufgabe ab.
    pub fn sub(&self, from: f64, to: f64) -> SubProgress {
        SubProgress { task: self.clone(), from, to }
    }
}

/// Fortschritt eines Teilschritts, abgebildet auf einen Bereich der Gesamtaufgabe.
#[derive(Clone)]
pub struct SubProgress {
    pub task: TaskHandle,
    from: f64,
    to: f64,
}

impl SubProgress {
    pub fn progress(&self, p: f64) {
        self.task.progress(self.from + (self.to - self.from) * p.clamp(0.0, 1.0));
    }
    pub fn message(&self, msg: impl Into<String>) {
        self.task.message(msg);
    }
    pub fn check(&self) -> AppResult<()> {
        self.task.check()
    }
    /// Weiter unterteilen.
    pub fn sub(&self, from: f64, to: f64) -> SubProgress {
        let span = self.to - self.from;
        SubProgress { task: self.task.clone(), from: self.from + span * from, to: self.from + span * to }
    }
}
