//! Java-Runtimes (Logik im gemeinsamen Crate `vibe-server-core`).
pub use vibe_server_core::minecraft::java::*;

use super::JavaInstall;
use crate::error::AppResult;
use crate::state::AppState;
use crate::tasks::SubProgress;

/// Java für eine Instanz bestimmen:
/// Instanz-Override > `settings.java_overrides[major]` > verwaltete Runtime > Auto-Download > System-Java.
pub async fn resolve(
    state: &AppState,
    inst: &crate::instance::Instance,
    major: u32,
    component: Option<&str>,
    force: bool,
    sp: &SubProgress,
) -> AppResult<JavaInstall> {
    resolve_with(state, inst.java.path.as_deref(), major, component, force, sp).await
}
