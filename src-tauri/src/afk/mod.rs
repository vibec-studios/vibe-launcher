pub mod agent;
pub mod commands;
pub mod files;
pub mod launch;
pub mod logscan;
pub mod notify;
pub mod overlay;
pub mod registry;
pub mod runtime;
pub mod settings;
pub mod window;

pub use launch::prepare;
pub use runtime::{init, observe_log, on_exit};
pub use settings::AfkSettings;

pub fn request(state: &crate::state::AppState, run_id: &str) -> crate::error::AppResult<()> {
    if !state.settings().afk.enabled {
        return Err(crate::error::AppError::Invalid("Der AFK-Modus ist in den Einstellungen ausgeschaltet (Spiel → Experimentell).".into()));
    }
    registry::request(run_id);
    Ok(())
}
