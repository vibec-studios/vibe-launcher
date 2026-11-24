use crate::error::{AppError, AppResult};
use crate::instance::{CustomLoaderRef, Instance};
use crate::paths::Paths;

pub fn label(paths: &Paths, r: &CustomLoaderRef) -> String {
    super::load(paths, &r.id, &r.version).map(|m| format!("{} {}", m.name, m.loader_version)).unwrap_or_else(|_| format!("{} {}", r.id, r.version))
}

pub fn block(inst: &Instance, what: &str) -> AppResult<()> {
    match &inst.custom_loader {
        Some(c) => Err(AppError::msg(format!(
            "{what} ist für Instanzen mit eigenem Loader ({} {}) nicht möglich: Andere Launcher und Server kennen diesen Loader nicht.",
            c.id, c.version
        ))),
        None => Ok(()),
    }
}
