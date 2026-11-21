macro_rules! bedrock_commands {
    ([$($acc:tt)*] $next:ident $($rest:ident)*) => {
        $crate::commands::registry::$next!([$($acc)*
            crate::commands::bedrock::bedrock_status,
            crate::commands::bedrock::bedrock_home_summary,
            crate::commands::bedrock::bedrock_create,
            crate::commands::bedrock::bedrock_packs,
            crate::commands::bedrock::bedrock_pack_remove,
            crate::commands::bedrock::bedrock_pack_export,
            crate::commands::bedrock::bedrock_import_files,
            crate::commands::bedrock::bedrock_worlds,
            crate::commands::bedrock::bedrock_can_import_worlds,
            crate::commands::bedrock::bedrock_world_delete,
            crate::commands::bedrock::bedrock_world_export,
            crate::commands::bedrock::bedrock_world_pack_set,
            crate::commands::bedrock::bedrock_backups,
            crate::commands::bedrock::bedrock_backup_create,
            crate::commands::bedrock::bedrock_backup_restore,
            crate::commands::bedrock::bedrock_backup_delete,
            crate::commands::bedrock::bedrock_open_folder,
            crate::commands::bedrock::bedrock_recover,
            crate::commands::bedrock::bedrock_open_store,
            crate::commands::bedrock::bedrock_cf_classes,
            crate::commands::bedrock::bedrock_cf_search,
            crate::commands::bedrock::bedrock_cf_install,
        ] $($rest)*)
    };
}

pub(crate) use bedrock_commands;
