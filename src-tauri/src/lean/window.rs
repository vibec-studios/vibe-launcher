use super::MAIN;
use crate::error::{AppError, AppResult};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WebviewWindowBuilder};

#[derive(Debug, Clone, Copy)]
pub struct Geometry {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    maximized: bool,
}

impl Geometry {
    pub fn capture(w: &WebviewWindow) -> Option<Geometry> {
        let maximized = w.is_maximized().unwrap_or(false);
        let minimized = w.is_minimized().unwrap_or(false);
        if minimized && !maximized {
            return None;
        }
        Some(Geometry { position: w.outer_position().ok()?, size: w.inner_size().ok()?, maximized })
    }
}

pub fn create(app: &AppHandle, geometry: Option<Geometry>) -> AppResult<()> {
    if app.get_webview_window(MAIN).is_some() {
        return Ok(());
    }
    let cfg = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MAIN)
        .cloned()
        .ok_or_else(|| AppError::msg("Fensterkonfiguration fehlt"))?;
    let w = WebviewWindowBuilder::from_config(app, &cfg)
        .and_then(|b| b.build())
        .map_err(|e| AppError::msg(format!("Hauptfenster: {e}")))?;
    if let Some(g) = geometry {
        if !g.maximized {
            let _ = w.set_size(g.size);
        }
        let _ = w.set_position(g.position);
        if g.maximized {
            let _ = w.maximize();
        }
    }
    if let Some(state) = app.try_state::<crate::state::AppState>() {
        crate::platform::app_icon::apply(app, &state.settings().appearance);
    }
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        if let Some(w) = h.get_webview_window(MAIN) {
            if !w.is_visible().unwrap_or(true) {
                let _ = w.show();
            }
        }
    });
    Ok(())
}
