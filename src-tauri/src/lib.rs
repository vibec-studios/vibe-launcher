//! Vibe Launcher – Backend.
pub mod afk;
pub mod auth;
pub mod bedrock;
pub mod client_packs;
pub mod commands;
pub mod console;
pub mod custom_loader;
#[cfg(debug_assertions)]
mod devlive;
pub mod content;
pub mod datadir;
pub mod domains;
pub mod error;
pub mod events;
pub mod feedback;
pub mod files;
pub mod instance;
pub mod lean;
pub mod minecraft;
pub mod minecraftcapes;
pub mod net;
pub mod paths;
pub mod platform;
pub mod play;
pub mod portable;
pub mod remote;
pub mod server;
pub mod serverpack;
pub mod settings;
pub mod state;
pub mod storage;
pub mod tasks;
pub mod tickets;
pub mod updater;
pub mod util;
pub mod vibe;
pub mod vibefix;

use state::AppState;
use tauri::Manager;

fn init_logging(paths: &paths::Paths) -> Option<tracing_appender::non_blocking::WorkerGuard> {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};
    let _ = std::fs::create_dir_all(paths.launcher_logs());
    let file = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("launcher.log")
        .max_log_files(14)
        .build(paths.launcher_logs())
        .unwrap_or_else(|_| tracing_appender::rolling::daily(paths.launcher_logs(), "launcher.log"));
    let (nb, guard) = tracing_appender::non_blocking(file);
    let filter = EnvFilter::try_from_env("VIBE_LOG").unwrap_or_else(|_| EnvFilter::new("info,vibe_launcher_lib=debug,hyper=warn,reqwest=warn"));
    let registry = tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_writer(nb).with_ansi(false));
    #[cfg(debug_assertions)]
    let registry = registry.with(fmt::layer().with_writer(std::io::stderr));
    let _ = registry.try_init();
    Some(guard)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    portable::prepare_process();
    let guard = init_logging(&paths::Paths::new());

    let mut builder = tauri::Builder::default();
    // Nur eine Launcher-Instanz – außer bei Test-Datenordnern (VIBE_LAUNCHER_HOME), damit mehrere
    // Testläufe parallel möglich sind.
    if std::env::var_os("VIBE_LAUNCHER_HOME").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // `--launch <id>` aus Verknüpfungen; Deep-Links kommen über das Deep-Link-Plugin
            let mut acts: Vec<_> = platform::links::parse_args(argv.iter().skip(1).cloned())
                .into_iter()
                .filter(|a| matches!(a, platform::links::AppAction::Launch { .. }))
                .collect();
            acts.extend(platform::mrlinks::from_args(argv.iter().skip(1)));
            platform::push_actions(app, acts);
            lean::show_main(app);
        }));
    }
    #[cfg(debug_assertions)]
    {
        builder = devlive::register(builder);
    }
    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let _guard = &guard;
            let state = AppState::init(app.handle().clone());
            // Lokale Bilder (Instanz-Icons usw.) aus dem tatsächlichen Datenordner erlauben
            if let Err(e) = app.asset_protocol_scope().allow_directory(&state.paths.root, true) {
                tracing::warn!("Asset-Scope für {:?} nicht setzbar: {e}", state.paths.root);
            }
            tracing::info!("Vibe Launcher {} – Daten: {:?}", env!("CARGO_PKG_VERSION"), state.paths.root);
            datadir::on_startup(&state.paths);
            storage::maintenance::on_startup(&state.paths.root);
            let startup_state = state.clone();
            let appearance = state.settings().appearance.clone();
            app.manage(state);
            platform::app_icon::apply(app.handle(), &appearance);
            platform::init(app.handle());
            afk::init(app.handle());
            lean::init(app.handle());
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                // Schema `vibelauncher://` beim Nutzer registrieren (Installer macht das ebenfalls);
                // nicht in Testläufen, damit Test-Builds keine Registrierung überschreiben.
                #[cfg(any(windows, target_os = "linux"))]
                if !cfg!(debug_assertions) && std::env::var_os("VIBE_LAUNCHER_HOME").is_none() && !paths::portable::active() {
                    if let Err(e) = app.deep_link().register_all() {
                        tracing::warn!("Deep-Link-Registrierung fehlgeschlagen: {e}");
                    }
                }
                let h = app.handle().clone();
                app.deep_link().on_open_url(move |ev| {
                    platform::handle_urls(&h, ev.urls().iter().map(|u| u.to_string()).collect());
                });
            }
            // Bedrock: offenen Profil-Tausch nach Absturz/Neustart abschließen bzw. laufende Sitzung aufnehmen
            platform::mrscheme::on_startup(&startup_state.paths.root);
            let bedrock_state = startup_state.clone();
            tauri::async_runtime::spawn_blocking(move || bedrock::game::on_startup(&bedrock_state));
            // Lokale Server: Server aus früheren Sitzungen erkennen, Auto-Start
            let import_state = startup_state.clone();
            tauri::async_runtime::spawn(async move {
                startup_state.server_mgr.on_startup(&startup_state);
            });
            // Skins aus anderen Launchern automatisch übernehmen (nur wenn eingeschaltet)
            tauri::async_runtime::spawn(async move {
                match crate::auth::skin_import::auto_import(&import_state).await {
                    Ok(n) if n > 0 => crate::events::emit(&import_state.app, crate::auth::skins::SKINS_CHANGED, &serde_json::json!({ "scope": "library" })),
                    Ok(_) => {}
                    Err(e) => tracing::warn!("Skin-Auto-Import: {e}"),
                }
            });
            #[cfg(debug_assertions)]
            devlive::start(app.handle());
            // Fallback: Fenster spätestens nach 3 s zeigen, falls das Frontend hängt
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                if let Some(w) = handle.get_webview_window("main") {
                    if !w.is_visible().unwrap_or(true) {
                        let _ = w.show();
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            lean::memory::on_window_event(window, event);
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) && !lean::is_active(window.app_handle()) {
                console::close(window.app_handle());
                if let Some(state) = window.try_state::<AppState>() {
                    portable::on_exit(&state);
                }
            }
            // Lokale Server laufen noch -> Frontend fragt, ob sie gestoppt werden sollen
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    if let Some(state) = window.try_state::<AppState>() {
                        let n = state.server_mgr.running_count();
                        if n > 0 && !state.server_mgr.quitting() {
                            api.prevent_close();
                            events::emit(window.app_handle(), server::EV_CLOSE_REQUESTED, &serde_json::json!({ "running": n }));
                        } else if lean::close_to_tray(window.app_handle()) {
                            api.prevent_close();
                        }
                    }
                }
            }
        })
        .invoke_handler(commands::registry::invoke_handler!())
        .build(tauri::generate_context!())
        .expect("Fehler beim Starten des Launchers")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { code: None, api, .. } if lean::is_active(app) => api.prevent_exit(),
            tauri::RunEvent::Exit => lean::on_exit(app),
            _ => {}
        });
}
