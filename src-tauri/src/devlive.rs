//! Nur für Debug-Builds: Live-Entwicklung ohne HTTP-Dev-Server.
//!
//! Ist `VIBE_DEV_DIST=<ordner>` gesetzt, liefert das eigene Protokoll `vldev` die Dateien direkt von der Platte,
//! das Hauptfenster wird darauf umgeleitet und lädt sich neu, sobald `index.html` neu geschrieben wird
//! (z. B. von `vite build --watch`). Siehe `scripts/dev-live.mjs`.
use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Builder, Manager, Wry};

fn dist() -> Option<PathBuf> {
    std::env::var_os("VIBE_DEV_DIST").map(PathBuf::from)
}

fn mime(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

pub fn register(builder: Builder<Wry>) -> Builder<Wry> {
    let Some(dir) = dist() else { return builder };
    builder.register_uri_scheme_protocol("vldev", move |_ctx, req| {
        let rel = req.uri().path().trim_start_matches('/');
        let rel = if rel.is_empty() { "index.html" } else { rel };
        let file = crate::util::safe_join(&dir, rel).filter(|p| p.is_file()).unwrap_or_else(|| dir.join("index.html"));
        let body = std::fs::read(&file).unwrap_or_default();
        tauri::http::Response::builder()
            .header("Content-Type", mime(&file))
            .header("Cache-Control", "no-store")
            .body(body)
            .unwrap()
    })
}

pub fn start(app: &AppHandle) {
    let Some(dir) = dist() else { return };
    let Some(win) = app.get_webview_window("main") else { return };
    let url = if cfg!(windows) { "http://vldev.localhost/" } else { "vldev://localhost/" };
    if let Ok(u) = url.parse() {
        let _ = win.navigate(u);
    }
    tracing::info!("Live-Modus: Frontend aus {:?}", dir);
    std::thread::spawn(move || {
        let index = dir.join("index.html");
        let stamp = || std::fs::metadata(&index).and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
        let mut last = stamp();
        loop {
            std::thread::sleep(Duration::from_millis(400));
            let now = stamp();
            if now != last {
                last = now;
                // Kurz warten, bis alle Dateien des Builds geschrieben sind
                std::thread::sleep(Duration::from_millis(250));
                let _ = win.eval("location.reload()");
            }
        }
    });
}
