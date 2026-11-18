// Mock: Werkzeuge der Instanzseite (Modpack-Update, Abhängigkeits-Check, Mod-Sets, Performance, Backups, Configs,
// Serverliste). Macht „survival“ zu einer realistisch gefüllten Modpack-Instanz. Nur für VITE_MOCK=1.
import type { ConfigEntry, DepIssue, Instance, ModSets, PerfCandidate, ProjectVersion, ServerEntry, SnapshotInfo, WorldBackup } from "@/lib/types";
import { instances } from "./core";
import { fakeTask, type Handlers } from "./util";

const now = Date.now();
const survival = instances.get("survival");
if (survival) {
  const next: Instance = {
    ...survival,
    name: "Cobblemon Abenteuer",
    source: { kind: "modrinth", project_id: "cobble-pack", version_id: "v1", name: "Cobblemon Abenteuer", version_name: "1.4.2" },
  };
  instances.set("survival", next);
}

const version = (n: string): ProjectVersion => ({
  source: "modrinth",
  id: `cobble-pack-${n}`,
  project_id: "cobble-pack",
  name: `Cobblemon Abenteuer ${n}`,
  version_number: n,
  game_versions: ["1.21.4"],
  loaders: ["fabric"],
  release_type: "release",
  date: new Date(now - 86400_000).toISOString(),
  downloads: 12000,
  files: [],
  dependencies: [],
  changelog: null,
});

const deps: DepIssue[] = [
  {
    kind: "missing_dependency",
    severity: "error",
    file_name: "create-fabric-0.5.1.jar",
    mod_name: "Create",
    target: "porting_lib",
    message: "Create benötigt Porting Lib, das nicht installiert ist.",
    fixes: [{ action: "install", source: "modrinth", project_id: "porting-lib", title: "Porting Lib" }, { action: "disable", file_name: "create-fabric-0.5.1.jar" }],
  },
  {
    kind: "duplicate",
    severity: "warning",
    file_name: "sodium-0.6.0.jar",
    mod_name: "Sodium",
    target: null,
    message: "Sodium ist zweimal installiert (0.6.0 und 0.5.11).",
    fixes: [{ action: "remove", file_names: ["sodium-0.5.11.jar"] }],
  },
];

let modsets: ModSets = {
  active: "pvp",
  active_modified: true,
  sets: [
    { id: "pvp", name: "PvP-Abend", created: now - 86400_000 * 4, enabled_count: 84, total_count: 120 },
    { id: "full", name: "Alles an", created: now - 86400_000 * 9, enabled_count: 120, total_count: 120 },
  ],
};

const snapshots: SnapshotInfo[] = [
  { id: "s1", name: "Vor Modpack-Update 1.4.2", created: now - 86400_000 * 3, auto: true, file_count: 412, size: 734_003_200 },
  { id: "s2", name: "Stabiler Stand", created: now - 86400_000 * 11, auto: false, file_count: 398, size: 702_545_920 },
];
const worldBackups: WorldBackup[] = [
  { id: "w1", folder: "Neue Welt", world_name: "Neue Welt", created: now - 3600_000 * 5, size: 182_452_224, auto: true },
  { id: "w2", folder: "Insel", world_name: "Insel", created: now - 86400_000 * 2, size: 52_428_800, auto: false },
];
const configs: ConfigEntry[] = [
  { path: "config", is_dir: true, size: 0, modified: now, has_backup: false, binary: false },
  { path: "config/sodium-options.json", is_dir: false, size: 1240, modified: now - 3600_000, has_backup: true, binary: false },
  { path: "config/cobblemon", is_dir: true, size: 0, modified: now, has_backup: false, binary: false },
  { path: "config/cobblemon/main.json", is_dir: false, size: 8120, modified: now - 86400_000, has_backup: false, binary: false },
  { path: "config/iris.properties", is_dir: false, size: 320, modified: now - 86400_000 * 2, has_backup: false, binary: false },
  { path: "options.txt", is_dir: false, size: 5120, modified: now - 7200_000, has_backup: false, binary: false },
];
const servers: ServerEntry[] = [
  { name: "Vibe Craft SMP", ip: "smp.vibecraft.de", icon: null, accept_textures: true, hidden: false },
  { name: "Cobble-Freunde", ip: "192.168.0.24:25565", icon: null, accept_textures: null, hidden: false },
];

const perf: PerfCandidate[] = [
  { project_id: "sodium", slug: "sodium", title: "Sodium", description: "Moderne Rendering-Engine", icon_url: null, version_number: "0.6.0", available: true, installed: true, recommended: true, note: null },
  { project_id: "lithium", slug: "lithium", title: "Lithium", description: "Optimiert Spiellogik", icon_url: null, version_number: "0.14.3", available: true, installed: false, recommended: true, note: null },
  { project_id: "ferrite", slug: "ferrite-core", title: "FerriteCore", description: "Weniger Speicherverbrauch", icon_url: null, version_number: "7.1.1", available: true, installed: false, recommended: true, note: null },
];

const handlers: Handlers = {
  modpack_check: ({ instanceId }) =>
    instanceId === "survival" ? { source: "modrinth", project_id: "cobble-pack", current_version: "1.4.2", current_version_id: "v1", latest: version("1.5.0") } : null,
  modpack_update_preview: () => ({
    current_version: "1.4.2",
    target: version("1.5.0"),
    mc_from: "1.21.4",
    mc_to: "1.21.4",
    loader_from: { kind: "fabric", version: "0.16.9" },
    loader_to: { kind: "fabric", version: "0.16.10" },
    files: [
      { path: "mods/cobblemon-1.6.1.jar", name: "Cobblemon", change: "updated", old_path: "mods/cobblemon-1.6.0.jar", side: "both" },
      { path: "mods/journeymap-6.0.jar", name: "JourneyMap", change: "added", old_path: null, side: "client" },
      { path: "mods/old-lib.jar", name: "Old Lib", change: "removed", old_path: null, side: "both" },
    ],
    unchanged: 117,
    overrides: [{ path: "config/cobblemon/main.json", status: "conflict" }],
    user_files: 3,
    missing: [],
    legacy: false,
  }),
  modpack_update: ({ instanceId }) => fakeTask("modpack_update", "Modpack aktualisieren", instanceId as string, 2500),
  content_check_deps: ({ instanceId }) => (instanceId === "survival" ? deps : []),
  content_sides: () => [],
  content_set_pinned: () => null,
  content_update_counts: () => ({ survival: 3 }),
  modsets_list: ({ instanceId }) => (instanceId === "survival" ? modsets : { active: null, active_modified: false, sets: [] }),
  modset_apply: ({ setId }) => (modsets = { ...modsets, active: setId as string, active_modified: false }),
  modset_create: ({ name }) => (modsets = { ...modsets, sets: [...modsets.sets, { id: String(name), name: String(name), created: Date.now(), enabled_count: 1, total_count: 1 }] }),
  modset_save: () => (modsets = { ...modsets, active_modified: false }),
  modset_rename: ({ setId, name }) => (modsets = { ...modsets, sets: modsets.sets.map((s) => (s.id === setId ? { ...s, name: String(name) } : s)) }),
  modset_delete: ({ setId }) => (modsets = { ...modsets, active: null, sets: modsets.sets.filter((s) => s.id !== setId) }),
  perf_preview: () => perf,
  perf_install: ({ instanceId }) => fakeTask("perf_install", "Performance-Mods installieren", instanceId as string, 2000),
  snapshots_list: ({ instanceId }) => (instanceId === "survival" ? snapshots : []),
  snapshot_create: () => null,
  snapshot_delete: () => null,
  snapshot_restore: () => null,
  world_backups_list: ({ instanceId }) => (instanceId === "survival" ? worldBackups : []),
  backups_open_folder: () => null,
  config_tree: () => configs,
  config_read: ({ path }) => ({ path, content: `{\n  "example": true\n}\n`, has_backup: false }),
  config_search: () => [],
  instance_servers_list: () => servers,
  instance_servers_save: () => null,
  servers_recent: () => [],
  playtime_sessions: () => [],
  optsync_get: () => ({ config: { master: {}, source: null, updated_at: null, instances: {} }, categories: [], counts: {} }),
  screenshots_list: () => [],
  crash_analyze: () => [],
};

export default handlers;
