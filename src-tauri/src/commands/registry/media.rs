macro_rules! media_commands {
    ([$($acc:tt)*] $next:ident $($rest:ident)*) => {
        $crate::commands::registry::$next!([$($acc)*
            crate::commands::feedback::feedback_capture,
            crate::commands::feedback::feedback_pick_screenshots,
            crate::commands::feedback::feedback_discard,
            crate::commands::feedback::feedback_logs,
            crate::commands::feedback::feedback_preview,
            crate::commands::feedback::feedback_send,
            crate::commands::screenshots::screenshots_list,
            crate::commands::screenshots::screenshot_thumb,
            crate::commands::screenshots::screenshot_delete,
            crate::commands::screenshots::screenshot_copy,
            crate::commands::screenshots::screenshot_open_folder,
            crate::commands::clips::clips_list,
            crate::commands::clips::clip_update,
            crate::commands::clips::clip_delete,
            crate::commands::clips::clip_open_folder,
            crate::commands::clips::clips_watch,
            crate::commands::clip_edit::clip_set_trim,
            crate::commands::clip_edit::clip_export_available,
            crate::commands::clip_edit::clip_export_trim,
        ] $($rest)*)
    };
}

pub(crate) use media_commands;
