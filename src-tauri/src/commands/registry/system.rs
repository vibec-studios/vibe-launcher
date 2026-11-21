macro_rules! system_commands {
    ([$($acc:tt)*] $next:ident $($rest:ident)*) => {
        $crate::commands::registry::$next!([$($acc)*
            crate::commands::core::instances_list,
            crate::commands::core::instance_get,
            crate::commands::core::instance_create,
            crate::commands::core::instance_update,
            crate::commands::core::instance_delete,
            crate::commands::core::instance_duplicate,
            crate::commands::core::instance_set_icon,
            crate::commands::core::instance_open_folder,
            crate::commands::core::settings_get,
            crate::commands::core::settings_set,
            crate::commands::core::appearance_import_background,
            crate::commands::appearance::appearance_theme_write,
            crate::commands::appearance::appearance_theme_read,
            crate::commands::core::app_icon_import,
            crate::commands::core::app_icon_preview,
            crate::commands::core::tasks_list,
            crate::commands::core::task_cancel,
            crate::commands::core::tasks_clear,
            crate::commands::core::system_info,
            crate::commands::core::open_path,
            crate::commands::core::open_data_dir,
            crate::commands::core::update_check,
            crate::commands::core::update_install,
            crate::commands::core::update_blockers,
            crate::commands::perf::gpu_settings_open,
            crate::commands::perf::launch_skip_step,
            crate::commands::perf::quick_mod_status,
            crate::commands::perf::quick_mod_install,
            crate::commands::perf::game_resources,
            crate::commands::datadir::datadir_preview,
            crate::commands::datadir::datadir_move,
        ] $($rest)*)
    };
}

pub(crate) use system_commands;
