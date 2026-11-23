macro_rules! platform_commands {
    ([$($acc:tt)*] $next:ident $($rest:ident)*) => {
        $crate::commands::registry::$next!([$($acc)*
            crate::commands::platform::crash_analyze,
            crate::commands::platform::crash_analysis,
            crate::commands::platform::vibefix_status,
            crate::commands::platform::instance_servers_list,
            crate::commands::platform::instance_servers_save,
            crate::commands::platform::instance_servers_modernize,
            crate::commands::platform::server_ping,
            crate::commands::platform::servers_recent,
            crate::commands::platform::playtime_sessions,
            crate::commands::platform::optsync_get,
            crate::commands::platform::optsync_set_instance,
            crate::commands::platform::optsync_capture,
            crate::commands::platform::optsync_apply_all,
            crate::commands::platform::optsync_sync_now,
            crate::commands::platform::optsync_open_folder,
            crate::commands::platform::optsync_clear_conflicts,
            crate::commands::platform::shortcut_create,
            crate::commands::platform::app_actions_take,
            crate::commands::links::modrinth_links_status,
            crate::commands::links::modrinth_links_set,
            crate::commands::links::app_link_parse,
            crate::commands::links::content_version_project,
            crate::commands::platform::discord_available,
            crate::commands::play::play_link_get,
            crate::commands::play::play_join_preview,
            crate::commands::play::play_join_setup,
            crate::commands::play::play_sessions,
        ] $($rest)*)
    };
}

pub(crate) use platform_commands;
