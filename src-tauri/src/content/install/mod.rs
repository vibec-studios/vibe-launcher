//! Installation von Projekten in Instanzen (mit Pflicht-Abhängigkeiten) und Updates.

use super::index::{self, ContentIndex, IndexEntry};
use super::missing::{self, MissingEntry};
use super::provider::{self, Brief};
use super::{curseforge as cf, modrinth as mr, *};
use crate::error::{AppError, AppResult};
use crate::instance::Instance;
use crate::net::DownloadItem;
use crate::state::AppState;
use crate::tasks::{SubProgress, TaskHandle};
use futures::StreamExt;
use std::collections::VecDeque;

mod plan;
mod apply;
mod updates;
mod manual;

pub use plan::*;
pub use apply::*;
pub use updates::*;
pub use manual::*;
