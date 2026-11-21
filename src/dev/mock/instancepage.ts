// Mock: Werkzeuge der Instanzseite (Modpack-Update, Abhängigkeits-Check, Mod-Sets, Performance, Backups, Dateien,
// Serverliste). Macht „survival“ zu einer realistisch gefüllten Modpack-Instanz. Nur für VITE_MOCK=1.
import type { DepIssue, Diagnosis, FileEntry, FixBackup, FixPlan, FixReport, Instance, ModSets, OptSyncInfo, PerfCandidate, ProjectVersion, ServerEntry, SnapshotInfo, SnapshotScope, SyncKey, WorldBackup } from "@/lib/types";
import { instances } from "./core";
import { emptyState, latestState, states } from "./sessions";
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
  { id: "s0", name: "Vor „Probleme beheben“", created: now - 3600_000 * 6, auto: true, file_count: 214, size: 389_021_696, scopes: ["mods", "configs", "options"] },
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
// Absturz (Screenshots: localStorage vl.mock.crash = "survival"): Vibey Client 0.3.0 + Centered Crosshair
// (Mixin-Konflikt beim Start), dazu eine zu alte Abhängigkeit und eine kaputte Config
const CRASH_FILE = "crash-2026-11-18_19.44.02-client.txt";
const crashDiags: Diagnosis[] = [
  {
    id: "mixin_conflict",
    confidence: 93,
    culprit: { mod_id: "centered-crosshair", name: "Centered Crosshair", file: "centered-crosshair-1.3.1+1.21.4.jar" },
    params: { other_id: "vibeyclient", other_name: "Vibey Client", other_file: "vibeyclient-fabric-1.21.4-0.3.0.jar" },
    actions: [{ kind: "disable_mod", file: "centered-crosshair-1.3.1+1.21.4.jar" }, { kind: "upload" }],
    evidence:
      "[19:44:01] [Render thread/WARN]: @Redirect conflict. Skipping centeredcrosshair.mixins.json:InGameHudMixin from mod centered-crosshair->@Redirect::redirectCrosshair(…) with priority 1000, already redirected by vibeyclient.mixins.json:hud.InGameHudMixin from mod vibeyclient",
    source: "logs/latest.log",
    line: 214,
    rule: "mixin_redirect_conflict",
  },
  {
    id: "outdated_dependency",
    confidence: 93,
    culprit: { mod_id: "roughlyenoughitems", name: "REI", file: "rei-17.0.794.jar" },
    params: { dependency: "cloth-config", dependency_name: "Cloth Config v15", range: "15.0.140 or later", present: "15.0.127", dependency_file: "cloth-config-15.0.127-fabric.jar" },
    actions: [{ kind: "update_mod", file: "cloth-config-15.0.127-fabric.jar", mod_id: "cloth-config" }, { kind: "upload" }],
    evidence: "- Mod 'REI' (roughlyenoughitems) 17.0.794 requires version 15.0.140 or later of mod 'Cloth Config v15' (cloth-config), but only the wrong version is present: 15.0.127!",
    source: "logs/latest.log",
    line: 188,
    rule: "fabric_wrong_version",
  },
  {
    id: "broken_config",
    confidence: 84,
    culprit: null,
    params: { path: "config/sodium-options.json" },
    actions: [{ kind: "reset_config", path: "config/sodium-options.json" }, { kind: "upload" }],
    evidence: "com.google.gson.JsonSyntaxException: com.google.gson.stream.MalformedJsonException: Unterminated object at line 12 column 5 path $.quality",
    source: `crash-reports/${CRASH_FILE}`,
    line: 31,
    rule: "config_parse",
  },
];
const crashPlan: FixPlan = {
  crash: true,
  causes: crashDiags,
  steps: [
    { id: "c1", reason: "mixin_conflict", name: "Centered Crosshair", required_by: [], action: { kind: "disable", file_name: "centered-crosshair-1.3.1+1.21.4.jar" }, alt: { kind: "disable", file_name: "vibeyclient-fabric-1.21.4-0.3.0.jar" }, alt_name: "Vibey Client", confirm: true, selected: false, from_crash: true, cause: 0, detail: null },
    { id: "c2", reason: "version_mismatch", name: "Cloth Config v15", required_by: ["REI"], action: { kind: "replace", file_name: "cloth-config-15.0.127-fabric.jar", source: "modrinth", project_id: "9s6osm5g", version_id: "cc140", title: "Cloth Config API", from_version: "15.0.127", to_version: "15.0.140", manual: false }, alt: null, alt_name: null, confirm: false, selected: true, from_crash: true, cause: 1, detail: null },
    { id: "c3", reason: "broken_config", name: "", required_by: [], action: { kind: "reset_config", path: "config/sodium-options.json" }, alt: null, alt_name: null, confirm: true, selected: false, from_crash: true, cause: 2, detail: null },
    { id: "c4", reason: "missing_dependency", name: "Porting Lib", required_by: ["Create", "Create Deco"], action: { kind: "install", source: "modrinth", project_id: "porting-lib", title: "Porting Lib" }, alt: null, alt_name: null, confirm: false, selected: true, from_crash: false, cause: null, detail: null },
  ],
  unfixable: [],
};
const crashFlag = (() => {
  try {
    return localStorage.getItem("vl.mock.crash");
  } catch {
    return null;
  }
})();
if (crashFlag && instances.has(crashFlag)) {
  const t = Date.now() - 4 * 60_000;
  const st = emptyState(crashFlag, {
    created_at: t,
    started_at: t,
    ended_at: t + 60_000,
    exit_code: -1,
    crashed: true,
    crash_report: `C:\\Users\\steve\\AppData\\Roaming\\VibeLauncher\\instances\\${crashFlag}\\minecraft\\crash-reports\\${CRASH_FILE}`,
  });
  states.set(st.run_id, st);
}
const crashedNow = (id: unknown) => id === "survival" && !!latestState("survival")?.crashed && (!fixReport || fixReport.undone);

let fixReport: FixReport | null = null;
let repaired = false;

// Synchronisieren: zwei Instanzen mit Packs/Servern, ein Konflikt (Screenshots: localStorage vl.mock.sync = "empty")
const ALL_SCOPES: SnapshotScope[] = ["mods", "configs", "resourcepacks", "shaderpacks", "datapacks", "options"];
function mockScopes(b: FixBackup | null | undefined): SnapshotScope[] {
  switch (b?.mode ?? "recommended") {
    case "none":
      return [];
    case "mods":
      return ["mods"];
    case "all":
      return ALL_SCOPES;
    case "custom":
      return ALL_SCOPES.filter((s) => b!.areas.includes(s));
    default:
      return ["mods", "configs", "options"];
  }
}
const syncEmpty = (() => {
  try {
    return localStorage.getItem("vl.mock.sync") === "empty";
  } catch {
    return false;
  }
})();
const MB = 1024 * 1024;
let sync: OptSyncInfo = {
  config: {
    master: syncEmpty ? {} : Object.fromEntries([...Array(48)].map((_, i) => [`key_key.mock${i}`, "key.keyboard.a"]).concat([["lang", "de_de"], ["forceUnicodeFont", "false"], ["soundCategory_music", "0.3"]])),
    source: syncEmpty ? null : "survival",
    updated_at: syncEmpty ? null : now - 3600_000 * 2,
    instances: syncEmpty
      ? {}
      : {
          survival: { enabled: true, categories: ["controls", "sound", "language", "accessibility", "resourcepacks", "servers", "screenshots"] },
          vanilla: { enabled: true, categories: ["controls", "sound", "language", "resourcepacks", "servers"] },
          "old-forge": { enabled: true, categories: ["controls", "resourcepacks"] },
        },
    resource_packs: syncEmpty ? null : ["vanilla", "file/Faithful 32x.zip", "file/Fresh Animations.zip"],
    shader: syncEmpty ? null : { pack: "ComplementaryReimagined_r5.4.zip", enabled: true },
    optifine: {},
  },
  categories: ["controls", "sound", "video", "language", "accessibility"],
  areas: ["resourcepacks", "shaderpacks", "servers", "screenshots"],
  counts: syncEmpty ? {} : { controls: 48, sound: 1, language: 2, resourcepacks: 2 },
  shared: syncEmpty
    ? [
        { area: "resourcepacks", count: 0, size: 0 },
        { area: "shaderpacks", count: 0, size: 0 },
        { area: "screenshots", count: 0, size: 0 },
        { area: "servers", count: 0, size: 0 },
      ]
    : [
        { area: "resourcepacks", count: 4, size: 87 * MB },
        { area: "shaderpacks", count: 2, size: 41 * MB },
        { area: "screenshots", count: 37, size: 92 * MB },
        { area: "servers", count: 6, size: 0 },
      ],
  states: syncEmpty
    ? {}
    : {
        survival: { last_sync: now - 50 * 60_000, conflicts: [{ at: now - 50 * 60_000, area: "resourcepacks", name: "Faithful 32x.zip", renamed: "Faithful 32x (Cobblemon Abenteuer).zip" }], errors: [] },
        vanilla: { last_sync: now - 86400_000, conflicts: [], errors: [] },
        "old-forge": { last_sync: null, conflicts: [], errors: [] },
      },
};

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
  autofix_plan: ({ instanceId, ignoreCrash }) =>
    !ignoreCrash && crashedNow(instanceId)
      ? crashPlan
      : instanceId === "survival" && (!fixReport || fixReport.undone)
      ? fixPlan
      : instanceId === "hh-armors" && !repaired
        ? repairPlan
        : { crash: false, steps: [], unfixable: [] },
  autofix_apply: ({ instanceId, actions, backup }) =>
    fakeTask("autofix", "Probleme beheben", instanceId as string, 2200, () => {
      const list = actions as FixReport["results"][number]["action"][];
      if (instanceId === "hh-armors") repaired = true;
      const loader = list.find((a) => a.kind === "set_loader");
      const inst = instances.get(instanceId as string);
      if (loader && inst) instances.set(inst.id, { ...inst, loader: { ...inst.loader, version: loader.to } });
      const scopes = mockScopes(backup as FixBackup | null);
      fixReport = {
        created: Date.now(),
        snapshot_id: scopes.length ? "fix-1" : null,
        snapshot_scopes: scopes.length && scopes.length < ALL_SCOPES.length ? scopes : null,
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
  optsync_get: () => sync,
  optsync_set_instance: ({ instanceId, enabled, categories }) => {
    const id = instanceId as string;
    sync = {
      ...sync,
      config: { ...sync.config, instances: { ...sync.config.instances, [id]: { enabled: !!enabled, categories: categories as SyncKey[] } } },
      states: enabled ? { ...sync.states, [id]: sync.states[id] ?? { last_sync: Date.now(), conflicts: [], errors: [] } } : sync.states,
    };
    return sync;
  },
  optsync_capture: () => (sync = { ...sync, config: { ...sync.config, updated_at: Date.now() } }),
  optsync_apply_all: () => Object.values(sync.config.instances).filter((x) => x.enabled).length,
  optsync_sync_now: ({ instanceId }) => {
    const ids = instanceId ? [instanceId as string] : Object.keys(sync.config.instances).filter((k) => sync.config.instances[k].enabled);
    sync = { ...sync, states: { ...sync.states, ...Object.fromEntries(ids.map((k) => [k, { ...(sync.states[k] ?? { conflicts: [], errors: [] }), last_sync: Date.now() }])) } };
    return { instances: ids.length, changes: 3, conflicts: 0, errors: [], running: [] };
  },
  optsync_open_folder: () => null,
  optsync_clear_conflicts: ({ instanceId }) => {
    const id = instanceId as string;
    sync = { ...sync, states: { ...sync.states, [id]: { ...sync.states[id], conflicts: [], errors: [] } } };
    return sync;
  },
  screenshots_list: () => [],
  // Die Analyse liest weiter dasselbe Log – auch nach dem Beheben (erst der nächste Start ändert es)
  crash_analyze: ({ instanceId }) => (instanceId === "survival" && latestState("survival")?.crashed ? crashDiags : []),
};

export default handlers;
