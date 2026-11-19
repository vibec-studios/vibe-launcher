// Mock: Werkzeuge der Instanzseite (Modpack-Update, Abhängigkeits-Check, Mod-Sets, Performance, Backups, Dateien,
// Serverliste). Macht „survival“ zu einer realistisch gefüllten Modpack-Instanz. Nur für VITE_MOCK=1.
import type { DepIssue, FileEntry, FixPlan, FixReport, Instance, ModSets, PerfCandidate, ProjectVersion, ServerEntry, SnapshotInfo, WorldBackup } from "@/lib/types";
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
    kind: "version_mismatch",
    severity: "error",
    file_name: "create-fabric-0.5.1.jar",
    mod_name: "Create",
    target: "fabricloader",
    message: "Create braucht Fabric >=0.16.10, installiert ist 0.16.9",
    fixes: [],
  },
  {
    kind: "wrong_loader",
    severity: "error",
    file_name: "waystones-forge-1.21.4-21.4.2.jar",
    mod_name: "Waystones",
    target: null,
    message: "Waystones ist eine Forge-Mod, die Instanz nutzt Fabric",
    fixes: [{ action: "disable", file_name: "waystones-forge-1.21.4-21.4.2.jar" }],
  },
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
const fe = (path: string, is_dir: boolean, size = 0, ago = 0, has_backup = false): FileEntry => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  is_dir,
  size,
  modified: now - ago,
  kind: is_dir ? "dir" : path.endsWith(".png") ? "image" : path.endsWith(".jar") || path.endsWith(".dat") ? "binary" : "text",
  children: is_dir ? 3 : null,
  has_backup,
});
const files: Record<string, FileEntry[]> = {
  "": [fe("config", true), fe("mods", true), fe("saves", true), fe("options.txt", false, 5120, 7200_000), fe("servers.dat", false, 412, 86400_000)],
  config: [fe("config/cobblemon", true), fe("config/iris.properties", false, 320, 86400_000 * 2), fe("config/sodium-options.json", false, 1240, 3600_000, true)],
  "config/cobblemon": [fe("config/cobblemon/main.json", false, 8120, 86400_000)],
  mods: [fe("mods/cobblemon-1.6.jar", false, 18_400_000, 86400_000 * 4)],
  saves: [fe("saves/Neue Welt", true)],
};
const servers: ServerEntry[] = [
  { name: "Vibe Craft SMP", ip: "smp.vibecraft.de", icon: null, accept_textures: true, hidden: false },
  { name: "Cobble-Freunde", ip: "192.168.0.24:25565", icon: null, accept_textures: null, hidden: false },
  // Alte Relay-Adresse (Domain-Umzug): zeigt den Hinweis „Auf .axolite.cc umstellen“
  { name: "Hennys Welt", ip: "mossy-otter-27.vibey.henny.dev", icon: null, accept_textures: null, hidden: false },
];

const perf: PerfCandidate[] = [
  { project_id: "sodium", slug: "sodium", title: "Sodium", description: "Moderne Rendering-Engine", icon_url: null, version_number: "0.6.0", available: true, installed: true, recommended: true, note: null },
  { project_id: "lithium", slug: "lithium", title: "Lithium", description: "Optimiert Spiellogik", icon_url: null, version_number: "0.14.3", available: true, installed: false, recommended: true, note: null },
  { project_id: "ferrite", slug: "ferrite-core", title: "FerriteCore", description: "Weniger Speicherverbrauch", icon_url: null, version_number: "7.1.1", available: true, installed: false, recommended: true, note: null },
];

const fixPlan: FixPlan = {
  crash: false,
  steps: [
    // Loader: Create und Cobblemon verlangen ein neueres Fabric als installiert
    { id: "l1", reason: "loader_too_old", name: "Fabric", required_by: ["Create", "Cobblemon"], action: { kind: "set_loader", loader: "fabric", from: "0.16.9", to: "0.16.14" }, alt: null, alt_name: null, confirm: false, selected: true, from_crash: false, detail: "Create >=0.16.10, Cobblemon >=0.16.12" },
    // Forge-Mod in der Fabric-Instanz: deaktivieren und die Fabric-Version holen
    { id: "w1", reason: "wrong_loader", name: "Waystones", required_by: [], action: { kind: "disable", file_name: "waystones-forge-1.21.4-21.4.2.jar" }, alt: null, alt_name: null, confirm: false, selected: true, from_crash: false, detail: "forge" },
    { id: "w2", reason: "wrong_loader", name: "Waystones", required_by: [], action: { kind: "install", source: "modrinth", project_id: "waystones", title: "Waystones" }, alt: null, alt_name: null, confirm: false, selected: true, from_crash: false, detail: "forge" },
    { id: "s1", reason: "duplicate", name: "Sodium", required_by: [], action: { kind: "disable", file_name: "sodium-0.5.11.jar" }, alt: null, alt_name: null, confirm: false, selected: true, from_crash: false, detail: null },
    { id: "s2", reason: "wrong_minecraft", name: "Xaero's Minimap", required_by: [], action: { kind: "replace", file_name: "xaerominimap-24.5.0-1.21.1.jar", source: "modrinth", project_id: "xaeros-minimap", version_id: "x2", title: "Xaero's Minimap", from_version: "24.5.0", to_version: "25.2.6", manual: false }, alt: null, alt_name: null, confirm: false, selected: true, from_crash: false, detail: null },
    { id: "s3", reason: "missing_dependency", name: "Porting Lib", required_by: ["Create", "Create Deco"], action: { kind: "install", source: "modrinth", project_id: "porting-lib", title: "Porting Lib" }, alt: null, alt_name: null, confirm: false, selected: true, from_crash: false, detail: null },
    { id: "s4", reason: "disabled_dependency", name: "Cloth Config", required_by: ["Mod Menu"], action: { kind: "enable", file_name: "cloth-config-15.0.140.jar.disabled" }, alt: null, alt_name: null, confirm: false, selected: true, from_crash: false, detail: null },
    { id: "s5", reason: "java_version", name: "Java 21", required_by: [], action: { kind: "set_java", major: 21, path: null }, alt: null, alt_name: null, confirm: false, selected: true, from_crash: true, detail: null },
    { id: "s6", reason: "known_conflict", name: "OptiFabric", required_by: [], action: { kind: "disable", file_name: "optifabric-1.14.3.jar" }, alt: { kind: "disable", file_name: "sodium-0.6.0.jar" }, alt_name: "Sodium", confirm: true, selected: false, from_crash: false, detail: null },
  ],
  unfixable: [],
};

// Zweite Instanz: Loader-Installation beschädigt (abgebrochener Download) -> neu installieren
const repairPlan: FixPlan = {
  crash: false,
  steps: [
    { id: "r1", reason: "loader_files_broken", name: "Fabric", required_by: [], action: { kind: "repair_loader", loader: "fabric", version: "0.17.2" }, alt: null, alt_name: null, confirm: false, selected: true, from_crash: false, detail: "3" },
  ],
  unfixable: [{ reason: "loader_version", name: "Fabric", detail: "Old Combat >=0.15 <0.16, Armor HUD >=0.17.0" }],
};
const repairDeps: DepIssue[] = [
  { kind: "loader_files", severity: "error", file_name: "", mod_name: "Fabric", target: "fabric", message: "Fabric 0.17.2: Die Installation ist beschädigt (3 Datei(en))", fixes: [] },
];
let fixReport: FixReport | null = null;
let repaired = false;

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
  autofix_quick: ({ instanceId }) => ({ errors: instanceId === "survival" && (!fixReport || fixReport.undone) ? 3 : instanceId === "hh-armors" && !repaired ? 1 : 0, warnings: 0, crashed: false }),
  autofix_plan: ({ instanceId }) =>
    instanceId === "survival" && (!fixReport || fixReport.undone)
      ? fixPlan
      : instanceId === "hh-armors" && !repaired
        ? repairPlan
        : { crash: false, steps: [], unfixable: [] },
  autofix_apply: ({ instanceId, actions }) =>
    fakeTask("autofix", "Probleme beheben", instanceId as string, 2200, () => {
      const list = actions as FixReport["results"][number]["action"][];
      if (instanceId === "hh-armors") repaired = true;
      const loader = list.find((a) => a.kind === "set_loader");
      const inst = instances.get(instanceId as string);
      if (loader && inst) instances.set(inst.id, { ...inst, loader: { ...inst.loader, version: loader.to } });
      fixReport = {
        created: Date.now(),
        snapshot_id: "fix-1",
        results: list.map((action) => ({ action, ok: true, error: null })),
        manual: [{ file_name: "better-end-4.0.jar", project_name: "Better End", page_url: "https://www.curseforge.com/minecraft/mc-mods/betterend/files/1", kind: "mod", version_number: "4.0.11", is_update: true }],
        prev_java: null,
        prev_loader: loader && inst ? inst.loader : null,
        undone: false,
      };
    }),
  autofix_last: () => fixReport,
  autofix_undo: ({ instanceId }) =>
    fakeTask("autofix", "Rückgängig", instanceId as string, 1200, () => {
      if (fixReport) fixReport = { ...fixReport, undone: true };
    }),
  content_check_deps: ({ instanceId }) =>
    instanceId === "survival" && (!fixReport || fixReport.undone) ? deps : instanceId === "hh-armors" && !repaired ? repairDeps : [],
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
  files_list: ({ dir }) => files[dir as string] ?? [],
  files_stat: ({ path }) => {
    const e = Object.values(files).flat().find((f) => f.path === path);
    if (!e) throw { kind: "not_found", message: "Nicht gefunden" };
    return e;
  },
  files_find: () => ({ entries: [], truncated: false }),
  files_search: () => ({ hits: [], truncated: false, files_scanned: 0, files_skipped: 0 }),
  files_read: ({ path }) => ({
    path,
    content: `{\n  "example": true\n}\n`,
    size: 24,
    modified: now,
    has_backup: false,
    kind: "text",
    language: "json",
    readonly: false,
    readonly_reason: null,
  }),
  files_validate: () => [],
  instance_servers_list: () => [...servers],
  instance_servers_save: () => null,
  instance_servers_modernize: () => {
    let n = 0;
    servers.forEach((e, i) => {
      const m = e.ip.match(/^(.+)\.vibey\.henny\.dev(:\d+)?$/i);
      if (m) {
        // Neues Objekt wie bei echter IPC (sonst rendert die memoisierte Zeile nicht neu)
        servers[i] = { ...e, ip: `${m[1].toLowerCase()}.axolite.cc${m[2] ?? ""}` };
        n++;
      }
    });
    return n;
  },
  servers_recent: () => [],
  playtime_sessions: () => [],
  optsync_get: () => ({ config: { master: {}, source: null, updated_at: null, instances: {} }, categories: [], counts: {} }),
  screenshots_list: () => [],
  crash_analyze: () => [],
};

export default handlers;
