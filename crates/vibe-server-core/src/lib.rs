//! Gemeinsame Server-Logik von Vibe Launcher und Vibe Server Agent: Minecraft-Server installieren und betreiben,
//! Java-Verwaltung, Downloads, Loader-Installer, Log4Shell-Schutz, Relay/UDP-Tunnel. Ohne Tauri; Ereignisse gehen
//! über [`events::EventSink`], Einstellungen und Konten über [`host::Host`].
pub mod content;
pub mod core;
pub mod domains;
pub mod error;
pub mod events;
pub mod host;
pub mod minecraft;
pub mod model;
pub mod net;
pub mod paths;
pub mod product;
pub mod rt;
pub mod server;
pub mod tasks;
pub mod util;

pub use crate::core::Core;
