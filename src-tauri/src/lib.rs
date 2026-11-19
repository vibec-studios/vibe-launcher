//! Vibe Launcher – Backend.
pub mod auth;
pub mod client_packs;
pub mod commands;
#[cfg(debug_assertions)]
mod devlive;
pub mod content;
pub mod domains;
pub mod error;
pub mod events;
pub mod files;
pub mod instance;
pub mod minecraft;
pub mod minecraftcapes;
pub mod net;
pub mod paths;
pub mod platform;
pub mod play;
pub mod server;
pub mod settings;
pub mod state;
pub mod tasks;
pub mod updater;
pub mod util;
pub mod vibe;
pub mod vibey_client;

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
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // `--launch <id>` aus Verknüpfungen; Deep-Links kommen über das Deep-Link-Plugin
            let acts: Vec<_> = platform::links::parse_args(argv.into_iter().skip(1))
                .into_iter()
                .filter(|a| matches!(a, platform::links::AppAction::Launch { .. }))
                .collect();
            platform::push_actions(app, acts);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
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
            let startup_state = state.clone();
            let appearance = state.settings().appearance.clone();
            app.manage(state);
            platform::app_icon::apply(app.handle(), &appearance);
            platform::init(app.handle());
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                // Schema `vibelauncher://` beim Nutzer registrieren (Installer macht das ebenfalls);
                // nicht in Testläufen, damit Test-Builds keine Registrierung überschreiben.
                #[cfg(any(windows, target_os = "linux"))]
                if !cfg!(debug_assertions) && std::env::var_os("VIBE_LAUNCHER_HOME").is_none() {
                    if let Err(e) = app.deep_link().register_all() {
                        tracing::warn!("Deep-Link-Registrierung fehlgeschlagen: {e}");
                    }
                }
                let h = app.handle().clone();
                app.deep_link().on_open_url(move |ev| {
                    platform::handle_urls(&h, ev.urls().iter().map(|u| u.to_string()).collect());
                });
            }
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
            // Lokale Server laufen noch -> Frontend fragt, ob sie gestoppt werden sollen
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    if let Some(state) = window.try_state::<AppState>() {
                        let n = state.server_mgr.running_count();
                        if n > 0 && !state.server_mgr.quitting() {
                            api.prevent_close();
                            events::emit(window.app_handle(), server::EV_CLOSE_REQUESTED, &serde_json::json!({ "running": n }));
                        }
                    }
                }
            }
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
            commands::core::appearance_import_background,
            commands::core::app_icon_import,
            commands::core::app_icon_preview,
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
            // skins
            commands::skins::skins_profile,
            commands::skins::skin_upload_file,
            commands::skins::skin_apply_library,
            commands::skins::skin_set_variant,
            commands::skins::skin_reset,
            commands::skins::cape_set,
            commands::skins::skin_library_list,
            commands::skins::skin_library_add_file,
            commands::skins::skin_library_add_current,
            commands::skins::skin_library_import_player,
            commands::skins::skin_library_rename,
            commands::skins::skin_library_set_variant,
            commands::skins::skin_library_remove,
            commands::skins::skin_library_export,
            commands::skins::skin_library_reveal,
            commands::skins::skin_import_scan,
            commands::skins::skin_import_run,
            commands::skins::skin_import_set_auto,
            commands::minecraftcapes::mccapes_profile,
            commands::minecraftcapes::mccapes_mod_status,
            commands::minecraftcapes::mccapes_mod_set,
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
            // screenshots
            commands::screenshots::screenshots_list,
            commands::screenshots::screenshot_thumb,
            commands::screenshots::screenshot_delete,
            commands::screenshots::screenshot_copy,
            commands::screenshots::screenshot_open_folder,
            commands::game::java_list,
            commands::game::java_test,
            commands::game::java_install,
            // lokale Server
            commands::server::servers_list,
            commands::server::server_get,
            commands::server::server_create,
            commands::server::server_mod_candidates,
            commands::server::server_update,
            commands::server::server_delete,
            commands::server::server_set_icon,
            commands::server::server_install,
            commands::server::server_accept_eula,
            commands::server::server_start,
            commands::server::server_stop,
            commands::server::server_restart,
            commands::server::server_kill,
            commands::server::server_command,
            commands::server::server_statuses,
            commands::server::server_log,
            commands::server::server_addresses,
            commands::server::server_properties_get,
            commands::server::server_properties_set,
            commands::server::server_properties_raw,
            commands::server::server_properties_raw_set,
            commands::server::server_players,
            commands::server::server_player_action,
            commands::server::server_set_whitelist,
            commands::server::server_worlds,
            commands::server::server_backups,
            commands::server::server_backup_create,
            commands::server::server_backup_delete,
            commands::server::server_backup_restore,
            commands::server::server_open_folder,
            commands::server::server_tunnel_reset,
            commands::server::server_platform_versions,
            commands::server::server_platform_builds,
            commands::server::server_platform_set_build,
            commands::server::server_addons,
            commands::server::server_addon_search,
            commands::server::server_addon_install,
            commands::server::server_addon_project,
            commands::server::server_addon_updates,
            commands::server::server_addon_update,
            commands::server::server_addon_set_enabled,
            commands::server::server_addon_remove,
            commands::server::servers_quit,
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
            commands::content::content_missing_scan,
            commands::content::content_missing_watch,
            commands::content::content_manual_target,
            commands::content::content_manual_projects,
            commands::content::launchers_detect,
            commands::content::launcher_scan_dir,
            commands::content::import_external,
            commands::content::content_set_pinned,
            commands::content::content_update_counts,
            commands::content::stores_list,
            commands::content::store_add,
            commands::content::store_remove,
            commands::content::store_set_enabled,
            // plattform (Frontend A)
            commands::platform::crash_analyze,
            commands::platform::instance_servers_list,
            commands::platform::instance_servers_save,
            commands::platform::instance_servers_modernize,
            commands::platform::server_ping,
            commands::platform::servers_recent,
            commands::platform::playtime_sessions,
            commands::platform::optsync_get,
            commands::platform::optsync_set_instance,
            commands::platform::optsync_capture,
            commands::platform::optsync_apply_all,
            commands::platform::shortcut_create,
            commands::platform::app_actions_take,
            commands::platform::discord_available,
            commands::play::play_link_get,
            commands::play::play_join_preview,
            commands::play::play_join_setup,
            commands::play::play_sessions,
            commands::content::modpack_check,
            commands::content::modpack_update_preview,
            commands::content::modpack_update,
            commands::content::content_check_deps,
            commands::content::autofix_plan,
            commands::content::autofix_apply,
            commands::content::autofix_last,
            commands::content::autofix_undo,
            commands::content::autofix_quick,
            commands::content::instance_refresh,
            commands::content::content_sides,
            commands::content::modsets_list,
            commands::content::modset_create,
            commands::content::modset_apply,
            commands::content::modset_save,
            commands::content::modset_rename,
            commands::content::modset_delete,
            commands::content::perf_preview,
            commands::content::perf_install,
            // backups
            commands::backups::snapshots_list,
            commands::backups::snapshot_create,
            commands::backups::snapshot_restore,
            commands::backups::snapshot_delete,
            commands::backups::world_backups_list,
            commands::backups::world_backup_create,
            commands::backups::world_backup_restore,
            commands::backups::world_backup_delete,
            commands::backups::world_copy,
            commands::backups::world_import_zip,
            commands::backups::backups_open_folder,
            // files (Instanz- und Serverordner)
            commands::files::files_list,
            commands::files::files_stat,
            commands::files::files_find,
            commands::files::files_search,
            commands::files::files_read,
            commands::files::files_write,
            commands::files::files_restore,
            commands::files::files_validate,
            commands::files::files_image,
            commands::files::files_create,
            commands::files::files_rename,
            commands::files::files_duplicate,
            commands::files::files_delete,
            commands::files::files_import,
            commands::files::files_abs_path,
            commands::files::files_reveal,
            // Vibe-Dienste
            commands::vibe::vibe_status,
            commands::vibe::vibe_announcements,
            commands::vibe::vibe_tokens_get,
            commands::vibe::vibe_tokens_set,
            commands::vibe::vibe_mojang_join,
            commands::vibe::vibe_http,
            commands::vibe::vibe_ws_open,
            commands::vibe::vibe_ws_send,
            commands::vibe::vibe_ws_close,
            commands::vibe::vibe_pack_share,
            commands::vibe::vibe_pack_link,
            commands::vibe::vibe_pack_install,
            vibey_client::commands::vibey_client_latest,
            client_packs::commands::client_packs_list,
            client_packs::commands::client_pack_install,
            client_packs::commands::client_pack_remove,
            vibey_client::commands::vibey_client_status,
            vibey_client::commands::vibey_client_set,
            vibey_client::commands::vibey_client_create_instance,
            vibey_client::commands::vibey_client_instances,
            vibey_client::commands::vibey_cosmetics_catalog,
            vibey_client::commands::vibey_cosmetic_asset,
            vibey_client::commands::vibey_cosmetic_thumbnail,
            vibey_client::commands::vibey_bundle_read,
            vibey_client::commands::vibey_png_read,
            vibey_client::commands::vibey_submission_upload,
            vibey_client::commands::vibey_blockbench_status,
            vibey_client::commands::vibey_blockbench_install_plugin,
            vibey_client::commands::vibey_blockbench_open,
            vibey_client::commands::vibey_blockbench_reveal_plugin,
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten des Launchers");
}
