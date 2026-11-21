macro_rules! sets_commands {
    ([$($acc:tt)*] $next:ident $($rest:ident)*) => {
        $crate::commands::registry::$next!([$($acc)*
            crate::commands::sets::sets_list,
            crate::commands::sets::sets_create,
            crate::commands::sets::sets_update,
            crate::commands::sets::sets_set_apply_on_create,
            crate::commands::sets::sets_delete,
            crate::commands::sets::sets_duplicate,
            crate::commands::sets::sets_add_entries,
            crate::commands::sets::sets_remove_entries,
            crate::commands::sets::sets_parse_list,
            crate::commands::sets::sets_import_text,
            crate::commands::sets::sets_import_file,
            crate::commands::sets::sets_export_file,
            crate::commands::sets::sets_export_code,
            crate::commands::sets::sets_export_links,
            crate::commands::sets::sets_instance_candidates,
            crate::commands::sets::sets_from_profile,
            crate::commands::sets::sets_preview,
            crate::commands::sets::sets_apply,
            crate::commands::sets::sets_install_new,
            crate::commands::sets::sets_check,
            crate::commands::sets::sets_compat,
            crate::commands::sets::sets_news,
            crate::commands::sets::sets_dismiss_news,
        ] $($rest)*)
    };
}

pub(crate) use sets_commands;
