use super::*;

impl Default for Settings {
    fn default() -> Self {
        Settings {
            language: default_language(),
            min_memory_mb: 512,
            max_memory_mb: default_max_memory(),
            jvm_args: String::new(),
            game_width: 1280,
            game_height: 720,
            fullscreen: false,
            java_overrides: Default::default(),
            auto_java: true,
            launch_behavior: LaunchBehavior::Keep,
            show_snapshots: false,
            concurrent_downloads: 16,
            curseforge_api_key: None,
            msa_client_id: None,
            check_updates: true,
            update_channel: crate::updater::default_channel(),
            vibe: VibeServices { enabled: false, ..VibeServices::default() },
            discord_rpc: true,
            discord_details: true,
            discord_large: "logo".into(),
            discord_pack_icon: true,
            discord_small: "head".into(),
            discord_image: None,
            wrapper_command: None,
            open_log_on_launch: false,
            console_on_launch: false,
            reduce_motion: false,
            auto_update_content: false,
            stores: crate::content::store::default_stores(),
            snapshot_keep: 10,
            world_backup_on_launch: false,
            world_backups_keep: 5,
            fix_backup: FixBackup::default(),
            minecraftcapes: false,
            appearance: Appearance::default(),
            // Neue Nutzer wählen den Modus im Onboarding
            ui_mode: "expert".into(),
            onboarding_done: false,
            simple_hint_seen: false,
            simple_tour_done: false,
            dismissed_notices: Vec::new(),
            prefer_dgpu: false,
            afk: crate::afk::AfkSettings::default(),
        }
    }
}

pub(super) fn default_language() -> String {
    syslang::system().into()
}

pub(super) fn default_max_memory() -> u32 {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    let total_mb = (sys.total_memory() / 1024 / 1024) as u32;
    // Ein Viertel des RAMs, zwischen 2 und 8 GiB, auf 512 MiB gerundet
    let v = (total_mb / 4).clamp(2048, 8192);
    v / 512 * 512
}

/// Gibt es schon Konten oder Instanzen? (Erkennung bestehender Nutzer ohne `settings.json`)
pub(super) fn has_existing_data(paths: &crate::paths::Paths) -> bool {
    if paths.accounts_file().exists() {
        return true;
    }
    std::fs::read_dir(paths.instances())
        .map(|mut it| it.any(|e| e.map(|e| e.path().join("instance.json").exists()).unwrap_or(false)))
        .unwrap_or(false)
}

/// Gesamter Arbeitsspeicher des Systems in MiB (für Regler im Frontend).
pub fn system_memory_mb() -> u64 {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.total_memory() / 1024 / 1024
}
