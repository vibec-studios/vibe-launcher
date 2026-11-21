use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Window, WindowEvent};

static LOW: AtomicBool = AtomicBool::new(false);

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != super::MAIN {
        return;
    }
    let low = match event {
        WindowEvent::Resized(_) => window.is_minimized().unwrap_or(false),
        WindowEvent::Focused(true) => false,
        _ => return,
    };
    if LOW.swap(low, Ordering::SeqCst) == low {
        return;
    }
    if let Some(w) = tauri::Manager::get_webview_window(window, super::MAIN) {
        set_target(&w, low);
    }
}

#[cfg(windows)]
fn set_target(w: &tauri::WebviewWindow, low: bool) {
    let res = w.with_webview(move |wv| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows_core::Interface;
        let level = if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
        unsafe {
            let Ok(core) = wv.controller().CoreWebView2() else { return };
            let Ok(v19) = core.cast::<ICoreWebView2_19>() else { return };
            if let Err(e) = v19.SetMemoryUsageTargetLevel(level) {
                tracing::debug!("WebView2-Speicherziel nicht gesetzt: {e}");
            }
        }
    });
    if let Err(e) = res {
        tracing::debug!("WebView nicht erreichbar: {e}");
    }
}

#[cfg(not(windows))]
fn set_target(_: &tauri::WebviewWindow, _: bool) {}
