macro_rules! game_commands {
    ([$($acc:tt)*] $next:ident $($rest:ident)*) => {
        $crate::commands::registry::$next!([$($acc)*
            crate::commands::game::game_versions,
            crate::commands::game::loader_game_versions,
            crate::commands::game::loader_versions,
            crate::commands::game::instance_version_preview,
            crate::commands::game::instance_version_apply,
            crate::commands::game::instance_install,
            crate::commands::game::instance_launch,
            crate::commands::game::instance_kill,
            crate::commands::game::game_states,
            crate::commands::game::console_open,
            crate::lean::commands::lean_handoff,
            crate::lean::commands::lean_restore_take,
            crate::lean::commands::lean_dev_session,
            crate::afk::commands::afk_support,
            crate::afk::commands::afk_sessions,
            crate::afk::commands::afk_events,
            crate::afk::commands::afk_set_background,
            crate::afk::commands::afk_send,
            crate::commands::game::instance_log_session,
            crate::commands::game::instance_log_files,
            crate::commands::game::instance_log_read,
            crate::commands::game::mclogs_upload,
            crate::commands::game::mclogs_preview,
            crate::commands::game::java_list,
            crate::commands::game::java_test,
            crate::commands::game::java_install,
        ] $($rest)*)
    };
}

pub(crate) use game_commands;
