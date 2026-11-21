macro_rules! storage_commands {
    ([$($acc:tt)*] $next:ident $($rest:ident)*) => {
        $crate::commands::registry::$next!([$($acc)*
            crate::commands::backups::snapshots_list,
            crate::commands::backups::snapshot_create,
            crate::commands::backups::snapshot_restore,
            crate::commands::backups::snapshot_delete,
            crate::commands::backups::world_backups_list,
            crate::commands::backups::world_backup_create,
            crate::commands::backups::world_backup_restore,
            crate::commands::backups::world_backup_delete,
            crate::commands::backups::world_copy,
            crate::commands::backups::world_import_zip,
            crate::commands::backups::backups_open_folder,
            crate::commands::files::files_list,
            crate::commands::files::files_stat,
            crate::commands::files::files_find,
            crate::commands::files::files_search,
            crate::commands::files::files_read,
            crate::commands::files::files_write,
            crate::commands::files::files_restore,
            crate::commands::files::files_validate,
            crate::commands::files::files_image,
            crate::commands::files::files_create,
            crate::commands::files::files_rename,
            crate::commands::files::files_duplicate,
            crate::commands::files::files_delete,
            crate::commands::files::files_import,
            crate::commands::files::files_abs_path,
            crate::commands::files::files_reveal,
        ] $($rest)*)
    };
}

pub(crate) use storage_commands;
