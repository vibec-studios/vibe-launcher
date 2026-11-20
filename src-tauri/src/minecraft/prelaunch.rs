use crate::tasks::TaskHandle;
use parking_lot::Mutex;
use std::collections::HashSet;
use std::future::Future;
use std::time::Duration;

pub const STEP_AUTO_UPDATE: &str = "auto_update";
pub const STEP_WORLD_BACKUP: &str = "world_backup";

static SKIP: Mutex<Option<HashSet<String>>> = parking_lot::const_mutex(None);

pub fn request_skip(task_id: &str) {
    SKIP.lock().get_or_insert_with(HashSet::new).insert(task_id.to_string());
}

pub fn take_skip(task_id: &str) -> bool {
    SKIP.lock().as_mut().is_some_and(|s| s.remove(task_id))
}

pub async fn skippable<F: Future>(task: &TaskHandle, step: &str, f: F) -> Option<F::Output> {
    take_skip(task.id());
    task.set_step(Some(step));
    let id = task.id().to_string();
    let watch = async {
        loop {
            tokio::time::sleep(Duration::from_millis(150)).await;
            if take_skip(&id) {
                return;
            }
        }
    };
    let r = tokio::select! {
        v = f => Some(v),
        _ = watch => None,
    };
    task.set_step(None);
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skip_flag_is_consumed_once() {
        request_skip("t-1");
        assert!(take_skip("t-1"));
        assert!(!take_skip("t-1"));
        assert!(!take_skip("t-2"));
    }
}
