-- Auszug aus dem Schema des NoRisk-Launchers (migrations/0002_profiles.sql), Testdaten erfunden
CREATE TABLE profiles (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL, game_version TEXT NOT NULL, loader TEXT NOT NULL,
    loader_version TEXT NULL, created INTEGER NOT NULL, last_played INTEGER NULL, state TEXT NOT NULL DEFAULT 'not_installed',
    selected_norisk_pack_id TEXT NULL, source_standard_profile_id TEXT NULL, group_name TEXT NULL,
    use_shared_minecraft_folder INTEGER NOT NULL DEFAULT 0, is_standard_version INTEGER NOT NULL DEFAULT 0, description TEXT NULL,
    preferred_account_id TEXT NULL, playtime_seconds INTEGER NOT NULL DEFAULT 0, settings TEXT NOT NULL DEFAULT '{}',
    banner TEXT NULL, background TEXT NULL, norisk_information TEXT NULL, modpack_info TEXT NULL,
    extra TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE profile_mods (
    profile_id TEXT NOT NULL, id TEXT NOT NULL, ordinal INTEGER NOT NULL, source TEXT NOT NULL, source_type TEXT NOT NULL,
    project_id TEXT NULL, version_id TEXT NULL, file_name TEXT NULL, enabled INTEGER NOT NULL DEFAULT 1, display_name TEXT NULL,
    version TEXT NULL, game_versions TEXT NULL, file_name_override TEXT NULL, associated_loader TEXT NULL, modpack_origin TEXT NULL,
    updates_enabled INTEGER NOT NULL DEFAULT 1, force_include_versions TEXT NOT NULL DEFAULT '[]', extra TEXT NOT NULL DEFAULT '{}',
    mod_loaders TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (profile_id, id)
);
CREATE TABLE profile_disabled_norisk_mods (
    profile_id TEXT NOT NULL, pack_id TEXT NOT NULL, mod_id TEXT NOT NULL, game_version TEXT NOT NULL, loader TEXT NOT NULL,
    PRIMARY KEY (profile_id, pack_id, mod_id, game_version, loader)
);
INSERT INTO profiles (id, name, path, game_version, loader, loader_version, created, last_played, selected_norisk_pack_id, group_name,
    use_shared_minecraft_folder, is_standard_version, playtime_seconds, settings, banner, description) VALUES
 ('p-main', 'NRC 26.3', 'noriskclient/new', '26.3', 'fabric', '0.19.5', 0, 1793476074136410600, 'child', 'NORISK CLIENT', 0, 1, 291260,
  '{"java_path":null,"use_custom_java_path":false,"use_overwrite_loader_version":false,"overwrite_loader_version":null,"memory":{"min":1024,"max":3584},"resolution":null,"fullscreen":false,"extra_game_args":[],"custom_jvm_args":null}',
  '{"source":{"type":"url","url":"https://cdn.example.invalid/icon.png"}}', NULL),
 ('p-group', 'Eigene Gruppe', 'custom/eg', '26.3', 'fabric', '0.19.5', 0, NULL, NULL, 'Meine Gruppe', 1, 0, 0,
  '{"use_overwrite_loader_version":true,"overwrite_loader_version":"0.20.1","memory":{"min":512,"max":2048}}', NULL, 'Test'),
 ('p-hyp', 'Hypixel', 'noriskclient/hypixel', '1.21.5', 'fabric', '0.16.14', 0, NULL, NULL, 'SERVER', 0, 1, 0, '{}', NULL, NULL);
INSERT INTO profile_mods (profile_id, id, ordinal, source, source_type, project_id, version_id, file_name, enabled, display_name) VALUES
 ('p-main', 'm1', 0, '{"type":"modrinth","project_id":"MODMENU","version_id":"MMV"}', 'modrinth', 'MODMENU', 'MMV', 'modmenu.jar', 0, 'Mod Menu'),
 ('p-main', 'm2', 1, '{"type":"local","file_name":"lokal.jar"}', 'local', NULL, NULL, 'lokal.jar', 1, 'Lokal');
INSERT INTO profile_disabled_norisk_mods VALUES ('p-main', 'child', 'appleskin', '26.3', 'fabric');
