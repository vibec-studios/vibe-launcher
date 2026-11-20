-- Auszug aus dem Schema des NoRisk-Launchers (migrations/0002_profiles.sql, 0003_sync_packs.sql, 0005, 0006), Testdaten erfunden
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
  '{"use_overwrite_loader_version":true,"overwrite_loader_version":"0.20.1","memory":{"min":512,"max":2048}}', '{"source":{"type":"relativeProfile","path":"icon.png"}}', 'Test'),
 ('p-hyp', 'Hypixel', 'noriskclient/hypixel', '1.21.5', 'fabric', '0.16.14', 0, NULL, NULL, 'SERVER', 0, 1, 0, '{}', NULL, NULL);
UPDATE profiles SET modpack_info = '{"source":{"source":"modrinth","project_id":"1KVo5zza","version_id":"FOV1"},"file_hash":null}' WHERE id = 'p-group';
UPDATE profiles SET modpack_info = '{"source":{"source":"curse_forge","project_id":925200,"file_id":6000001},"file_hash":"123"}' WHERE id = 'p-hyp';
INSERT INTO profile_mods (profile_id, id, ordinal, source, source_type, project_id, version_id, file_name, enabled, display_name) VALUES
 ('p-main', 'm1', 0, '{"type":"modrinth","project_id":"MODMENU","version_id":"MMV"}', 'modrinth', 'MODMENU', 'MMV', 'modmenu.jar', 0, 'Mod Menu'),
 ('p-main', 'm2', 1, '{"type":"local","file_name":"lokal.jar"}', 'local', NULL, NULL, 'lokal.jar', 1, 'Lokal'),
 ('p-main', 'm3', 2, '{"type":"curse_forge","project_id":"238222","file_id":"6829086","file_name":"jei.jar"}', 'curse_forge', '238222', '6829086', 'jei.jar', 1, 'JEI'),
 ('p-main', 'm4', 3, '{"type":"maven","coordinates":"gg.norisk:nrc:1"}', 'maven', 'gg.norisk:nrc:1', NULL, NULL, 1, 'NRC Maven');
INSERT INTO profile_disabled_norisk_mods VALUES ('p-main', 'child', 'appleskin', '26.3', 'fabric');
CREATE TABLE sync_packs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NULL, icon TEXT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL
);
CREATE TABLE sync_pack_targets (
    id TEXT PRIMARY KEY, pack_id TEXT NOT NULL, path TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, kind TEXT NOT NULL,
    external_path TEXT NULL, UNIQUE (pack_id, path)
);
CREATE TABLE sync_pack_mods (
    pack_id TEXT NOT NULL, mod_id TEXT NOT NULL, data TEXT NOT NULL, version_overrides TEXT NOT NULL DEFAULT '{}', icon_url TEXT NULL,
    PRIMARY KEY (pack_id, mod_id)
);
CREATE TABLE sync_pack_mod_resolutions (
    pack_id TEXT NOT NULL, project_key TEXT NOT NULL, mc_version TEXT NOT NULL, loader TEXT NOT NULL, version_id TEXT NOT NULL,
    version_name TEXT NULL, filename TEXT NOT NULL, download_url TEXT NOT NULL, sha1 TEXT NULL, file_size INTEGER NULL,
    resolved_at INTEGER NOT NULL, PRIMARY KEY (pack_id, project_key, mc_version, loader)
);
CREATE TABLE profile_sync_packs (profile_id TEXT NOT NULL, pack_id TEXT NOT NULL, ordinal INTEGER NOT NULL, PRIMARY KEY (profile_id, pack_id));
CREATE TABLE profile_sync_mod_exclusions (profile_id TEXT NOT NULL, pack_id TEXT NOT NULL, mod_key TEXT NOT NULL, PRIMARY KEY (profile_id, pack_id, mod_key));
INSERT INTO sync_packs (id, name, enabled, created, updated) VALUES
 ('11111111-1111-4111-8111-111111111111', 'Shared', 1, 0, 0),
 ('22222222-2222-4222-8222-222222222222', 'Aus', 0, 0, 0);
INSERT INTO sync_pack_targets (id, pack_id, path, enabled, kind, external_path) VALUES
 ('t1', '11111111-1111-4111-8111-111111111111', 'resourcepacks', 1, '{"type":"dir_link","adopt":"backup_local"}', NULL),
 ('t2', '11111111-1111-4111-8111-111111111111', 'options.txt', 1, '{"type":"file_merge","format":"minecraft_options","local_keys":["resourcePacks"]}', NULL),
 ('t3', '11111111-1111-4111-8111-111111111111', 'servers.dat', 1, '{"type":"file_copy"}', NULL),
 ('t4', '11111111-1111-4111-8111-111111111111', 'mods', 1, '{"type":"mods"}', NULL),
 ('t5', '11111111-1111-4111-8111-111111111111', 'resourcepacks/inner', 1, '{"type":"file_copy"}', NULL),
 ('t6', '11111111-1111-4111-8111-111111111111', 'NoRiskClient', 1, '{"type":"dir_link"}', NULL),
 ('t7', '11111111-1111-4111-8111-111111111111', 'logs', 0, '{"type":"dir_link"}', NULL),
 ('t8', '22222222-2222-4222-8222-222222222222', 'shaderpacks', 1, '{"type":"dir_link"}', NULL);
INSERT INTO sync_pack_mods (pack_id, mod_id, data, version_overrides) VALUES
 ('11111111-1111-4111-8111-111111111111', 'u1', '{"id":"u1","source":{"type":"modrinth","project_id":"IRIS","version_id":"IRISOWN","file_name":"iris.jar","download_url":"x"},"enabled":true,"display_name":"Iris","game_versions":["1.21.5"]}', '{}'),
 ('11111111-1111-4111-8111-111111111111', 'u2', '{"id":"u2","source":{"type":"curse_forge","project_id":"306612","file_id":"5000","file_name":"fapi.jar","download_url":"x"},"enabled":true,"display_name":"CF Mod","game_versions":["26.3"]}', '{}'),
 ('11111111-1111-4111-8111-111111111111', 'u3', '{"id":"u3","source":{"type":"modrinth","project_id":"XAERO","version_id":"XV","file_name":"x.jar","download_url":"x"},"enabled":true,"display_name":"Xaero"}', '{"26.3":{"type":"disabled"}}'),
 ('11111111-1111-4111-8111-111111111111', 'u4', '{"id":"u4","source":{"type":"modrinth","project_id":"PINNED","version_id":"OLD","file_name":"p.jar","download_url":"x"},"enabled":true,"display_name":"Pinned"}', '{"26.3":{"type":"pin","version_id":"PINV"}}'),
 ('11111111-1111-4111-8111-111111111111', 'u5', '{"id":"u5","source":{"type":"modrinth","project_id":"EXCL","version_id":"EV","file_name":"e.jar","download_url":"x"},"enabled":true,"display_name":"Excluded"}', '{}'),
 ('11111111-1111-4111-8111-111111111111', 'u6', '{"id":"u6","source":{"type":"modrinth","project_id":"MODMENU","version_id":"PACKMM","file_name":"mm.jar","download_url":"x"},"enabled":true,"display_name":"Mod Menu"}', '{}'),
 ('11111111-1111-4111-8111-111111111111', 'u7', '{"id":"u7","source":{"type":"modrinth","project_id":"OFF","version_id":"OV","file_name":"o.jar","download_url":"x"},"enabled":false,"display_name":"Off"}', '{}'),
 ('22222222-2222-4222-8222-222222222222', 'w1', '{"id":"w1","source":{"type":"modrinth","project_id":"NOPE","version_id":"NV","file_name":"n.jar","download_url":"x"},"enabled":true}', '{}');
INSERT INTO sync_pack_mod_resolutions (pack_id, project_key, mc_version, loader, version_id, filename, download_url, resolved_at) VALUES
 ('11111111-1111-4111-8111-111111111111', 'modrinth:IRIS', '26.3', 'fabric', 'IRIS263', 'iris-263.jar', 'x', 0);
INSERT INTO profile_sync_packs VALUES
 ('p-main', '11111111-1111-4111-8111-111111111111', 0), ('p-main', '22222222-2222-4222-8222-222222222222', 1),
 ('p-hyp', '11111111-1111-4111-8111-111111111111', 0);
INSERT INTO profile_sync_mod_exclusions VALUES
 ('p-main', '11111111-1111-4111-8111-111111111111', 'u5'),
 ('p-main', '11111111-1111-4111-8111-111111111111', 'jar:excluded.jar');
