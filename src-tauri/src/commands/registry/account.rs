macro_rules! account_commands {
    ([$($acc:tt)*] $next:ident $($rest:ident)*) => {
        $crate::commands::registry::$next!([$($acc)*
            crate::commands::auth::accounts_list,
            crate::commands::auth::account_remove,
            crate::commands::auth::account_set_active,
            crate::commands::auth::account_refresh,
            crate::commands::auth::auth_msa_available,
            crate::commands::auth::auth_msa_begin,
            crate::commands::auth::auth_msa_wait,
            crate::commands::auth::auth_msa_cancel,
            crate::commands::auth::auth_msa_window_login,
            crate::commands::skins::skins_profile,
            crate::commands::skins::skin_upload_file,
            crate::commands::skins::skin_apply_library,
            crate::commands::skins::skin_set_variant,
            crate::commands::skins::skin_reset,
            crate::commands::skins::cape_set,
            crate::commands::skins::skin_library_list,
            crate::commands::skins::skin_library_add_file,
            crate::commands::skins::skin_library_add_current,
            crate::commands::skins::skin_library_add_data,
            crate::commands::skins::skin_library_import_player,
            crate::commands::skins::skin_library_rename,
            crate::commands::skins::skin_library_set_variant,
            crate::commands::skins::skin_library_remove,
            crate::commands::skins::skin_library_export,
            crate::commands::skins::skin_library_reveal,
            crate::commands::skins::skin_import_scan,
            crate::commands::skins::skin_import_run,
            crate::commands::skins::skin_import_set_auto,
            crate::commands::minecraftcapes::mccapes_profile,
            crate::commands::minecraftcapes::mccapes_mod_status,
            crate::commands::minecraftcapes::mccapes_mod_set,
        ] $($rest)*)
    };
}

pub(crate) use account_commands;
