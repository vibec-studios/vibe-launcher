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

use files::{commit, Stage};

mod files;
mod types;
mod resolve;
mod prepare;
mod run;

pub use types::*;
use resolve::*;
pub use prepare::*;
pub use run::*;

const TASK: &str = "version_change";
type Project = (Source, String);

pub(super) fn text<'a>(state: &AppState, german: &'a str, english: &'a str) -> &'a str {
    if state.settings().language == "en" {
        english
    } else {
        german
    }
}
