//! HTTP-Client und Downloader (aus `vibe-server-core`).
pub use vibe_server_core::net::*;

pub const USER_AGENT: &str = concat!("VibeLauncher/", env!("CARGO_PKG_VERSION"), " (+https://github.com/vibec-studios)");
