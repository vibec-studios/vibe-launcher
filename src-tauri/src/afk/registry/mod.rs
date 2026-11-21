use super::files::{AfkEvent, AfkFile, Capabilities, Cursor, Mode, StateFile, HEARTBEAT_STALE_MS};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::LazyLock;

mod model;
mod run;

pub use model::*;
pub use run::*;

pub const MAX_EVENTS: usize = 500;
const NOTIFY_GAP_MS: i64 = 15_000;
pub const NOTIFY_KINDS: &[&str] = &["death", "disconnect", "mention", "whisper", "reconnect_gave_up"];

static REG: LazyLock<Mutex<HashMap<String, Run>>> = LazyLock::new(Default::default);
static COUNT: AtomicUsize = AtomicUsize::new(0);
static REQUESTED: LazyLock<Mutex<std::collections::HashSet<String>>> = LazyLock::new(Default::default);

pub fn any() -> bool {
    COUNT.load(Ordering::Relaxed) > 0
}

pub fn with<R>(f: impl FnOnce(&mut HashMap<String, Run>) -> R) -> R {
    let mut reg = REG.lock();
    let r = f(&mut reg);
    COUNT.store(reg.len(), Ordering::Relaxed);
    r
}

pub fn request(run_id: &str) {
    REQUESTED.lock().insert(run_id.to_string());
}

pub fn take_request(run_id: &str) -> bool {
    REQUESTED.lock().remove(run_id)
}

#[cfg(test)]
mod tests;
