use crate::error::{AppError, AppResult};
use crate::state::AppState;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

mod api;
mod client;
mod reply;
mod store;

pub use api::*;
pub use client::*;
pub use reply::*;
pub use store::*;

pub const LOOKUP_BATCH: usize = 50;
pub const SAVED_MAX: usize = 500;
pub const BODY_MAX: usize = 5000;
pub const FULFILLS_MAX: usize = 10;
pub const DETAILS_MAX: usize = 1000;
pub const QUIET_AFTER_MS: i64 = 30 * 24 * 3600 * 1000;
const PREPARED_TTL: Duration = Duration::from_secs(30 * 60);
const TIMEOUT: Duration = Duration::from_secs(20);

#[cfg(test)]
mod tests;
