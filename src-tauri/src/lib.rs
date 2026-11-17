//! Vibe Launcher – Backend.
pub mod auth;
pub mod commands;
pub mod content;
pub mod error;
pub mod events;
pub mod instance;
pub mod minecraft;
pub mod net;
pub mod paths;
pub mod settings;
pub mod state;
pub mod tasks;
pub mod updater;
pub mod util;

use state::AppState;
use tauri::Manager;

fn init_logging(paths: &paths::Paths) -> Option<tracing_appender::non_blocking::WorkerGuard> {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};
    let _ = std::fs::create_dir_all(paths.launcher_logs());
    let file = tracing_appender::rolling::daily(paths.launcher_logs(), "launcher.log");
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
    let guard = init_logging(&paths::Paths::new());

    let mut builder = tauri::Builder::default();
    // Nur eine Launcher-Instanz – außer bei Test-Datenordnern (VIBE_LAUNCHER_HOME), damit mehrere
    // Testläufe parallel möglich sind.
    if std::env::var_os("VIBE_LAUNCHER_HOME").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }
    builder
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
            app.manage(state);
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
        .invoke_handler(tauri::generate_handler![
            // core
            commands::core::instances_list,
            commands::core::instance_get,
            commands::core::instance_create,
            commands::core::instance_update,
            commands::core::instance_delete,
            commands::core::instance_duplicate,
            commands::core::instance_set_icon,
            commands::core::instance_open_folder,
            commands::core::settings_get,
            commands::core::settings_set,
            commands::core::tasks_list,
            commands::core::task_cancel,
            commands::core::tasks_clear,
            commands::core::system_info,
            commands::core::open_path,
            commands::core::open_data_dir,
            commands::core::update_check,
            commands::core::update_install,
            // auth
            commands::auth::accounts_list,
            commands::auth::account_remove,
            commands::auth::account_set_active,
            commands::auth::account_refresh,
            commands::auth::auth_msa_available,
            commands::auth::auth_msa_begin,
            commands::auth::auth_msa_wait,
            commands::auth::auth_msa_cancel,
            // game
            commands::game::game_versions,
            commands::game::loader_game_versions,
            commands::game::loader_versions,
            commands::game::instance_install,
            commands::game::instance_launch,
            commands::game::instance_kill,
            commands::game::game_states,
            commands::game::instance_log_session,
            commands::game::instance_log_files,
            commands::game::instance_log_read,
            commands::game::mclogs_upload,
            commands::game::java_list,
            commands::game::java_test,
            commands::game::java_install,
            // content
            commands::content::curseforge_available,
            commands::content::content_search,
            commands::content::content_categories,
            commands::content::content_project,
            commands::content::content_versions,
            commands::content::content_install,
            commands::content::content_list,
            commands::content::content_set_enabled,
            commands::content::content_remove,
            commands::content::content_add_files,
            commands::content::content_check_updates,
            commands::content::content_update,
            commands::content::worlds_list,
            commands::content::world_delete,
            commands::content::modpack_install,
            commands::content::import_preview,
            commands::content::import_pack,
            commands::content::export_entries,
            commands::content::export_instance,
            commands::content::content_missing,
            commands::content::content_missing_dismiss,
            commands::content::launchers_detect,
            commands::content::launcher_scan_dir,
            commands::content::import_external,
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten des Launchers");
}
