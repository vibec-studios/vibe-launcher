// Mock: Einstellungen aus anderen Launchern (Import-Dialog „Übernimmt …“, Hinweis unten links, Liste „Ansehen“).
// Screenshots: localStorage vl.mock.isx = 0 -> keine abweichenden Instanzen (Hinweis erscheint nicht).
import type { DataEntry, ExtSettings, ExternalInstance, ExternalLauncher, SettingsOffer } from "@/lib/types";
import { instances } from "./core";
import type { Handlers } from "./util";

const flag = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

const H = 3600_000;
const D = 24 * H;
const now = Date.now();

const none: ExtSettings = {
  min_memory_mb: null,
  max_memory_mb: null,
  java_path: null,
  java_version: null,
  jvm_args: null,
  env: {},
  width: null,
  height: null,
  fullscreen: null,
  pre_launch: null,
  post_exit: null,
  wrapper: null,
  notes: null,
  group: null,
  inherited: [],
};
const set = (p: Partial<ExtSettings>): ExtSettings => ({ ...none, ...p });

const ext = (source_path: string, name: string, mc: string, kind: ExternalInstance["loader"]["kind"], ver: string | null, extra: Partial<ExternalInstance>): ExternalInstance => ({
  source_path,
  name,
  mc_version: mc,
  loader: { kind, version: ver },
  icon: null,
  mod_count: 0,
  last_played: null,
  play_time_secs: null,
  size: null,
  warning: null,
  imported_as: null,
  settings: null,
  ...extra,
});

const PRISM = "C:\\Users\\steve\\AppData\\Roaming\\PrismLauncher";
const launchers: ExternalLauncher[] = [
  {
    id: "prism",
    name: "Prism Launcher",
    path: PRISM,
    instances: [
      ext(`${PRISM}\\instances\\ATM9`, "All the Mods 9", "1.20.1", "forge", "47.3.0", {
        mod_count: 412,
        last_played: now - 2 * H,
        settings: set({
          min_memory_mb: 2048,
          max_memory_mb: 8192,
          java_path: "C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.12.7-hotspot\\bin\\javaw.exe",
          java_version: "17.0.12",
          jvm_args: "-XX:+UseG1GC -XX:MaxGCPauseMillis=50",
          width: 1920,
          height: 1080,
          pre_launch: "%INST_DIR%\\sync-config.bat",
          group: "Modpacks",
        }),
      }),
      ext(`${PRISM}\\instances\\Fabulously`, "Fabulously Optimized", "1.21.4", "fabric", "0.16.10", {
        mod_count: 86,
        last_played: now - 3 * D,
        settings: set({ max_memory_mb: 4096, min_memory_mb: 512, inherited: ["memory"], env: { MESA_GLTHREAD: "true" }, fullscreen: true }),
      }),
      ext(`${PRISM}\\instances\\Skyblock`, "Skyblock 1.8.9", "1.8.9", "forge", "11.15.1.2318", {
        mod_count: 24,
        last_played: now - 40 * D,
        settings: set({ max_memory_mb: 3072, notes: "Nur für Hypixel" }),
      }),
    ],
  },
  {
    id: "modrinth",
    name: "Modrinth App",
    path: "C:\\Users\\steve\\AppData\\Roaming\\ModrinthApp",
    instances: [
      ext("C:\\Users\\steve\\AppData\\Roaming\\ModrinthApp\\profiles\\Cobblemon", "Cobblemon Abenteuer", "1.21.1", "fabric", "0.16.9", {
        mod_count: 140,
        last_played: now - 6 * H,
        settings: set({ max_memory_mb: 6144, width: 1600, height: 900, wrapper: "prime-run" }),
      }),
      ext("C:\\Users\\steve\\AppData\\Roaming\\ModrinthApp\\profiles\\Vanilla", "Vanilla 1.21.4", "1.21.4", "vanilla", null, {
        last_played: now - 9 * D,
        imported_as: "vanilla",
      }),
    ],
  },
];

const MB = 1024 * 1024;
const entry = (path: string, kind: DataEntry["kind"], status: DataEntry["status"], size: number, p: Partial<DataEntry> = {}): DataEntry => {
  const missing = status === "missing" || status === "removed";
  return {
    path,
    kind,
    name: null,
    status,
    size,
    missing_files: missing ? (kind === "file" ? 1 : 12) : 0,
    missing_size: missing ? size : 0,
    overwrite_files: missing ? 0 : kind === "file" ? 1 : 3,
    overwrite_size: missing ? 0 : size,
    default_on: status === "missing" || status === "partial",
    ...p,
  };
};

/** NoRisk-Import aus v1.0.0-beta.4: Mod-Daten und neue Welt fehlen. */
const NORISK = "C:\Users\steve\AppData\Roaming\norisk\NoRiskClientV3\data\profiles\noriskclient\new";
const noriskData: DataEntry[] = [
  entry("XaeroWaypoints", "dir", "missing", 1.2 * MB, { missing_files: 38 }),
  entry("journeymap", "dir", "missing", 46 * MB, { missing_files: 912 }),
  entry("xaero", "dir", "missing", 3.4 * MB, { missing_files: 64 }),
  entry("schematics", "dir", "partial", 0.8 * MB, { missing_files: 2, missing_size: 0.2 * MB, overwrite_files: 1, overwrite_size: 0.1 * MB }),
  entry("options.txt", "file", "changed", 6_120),
  entry("screenshots", "dir", "removed", 22 * MB, { missing_files: 31 }),
  entry("saves/Bedwars Map", "world", "missing", 18 * MB, { name: "Bedwars Map", missing_files: 140 }),
  entry("saves/Neue Welt", "world", "newer", 312 * MB, { name: "Survival mit Freunden", overwrite_files: 2140 }),
];

const offers = (): SettingsOffer[] =>
  flag("vl.mock.isx") === "0"
    ? []
    : [
        {
          instance_id: "old-forge",
          instance_name: instances.get("old-forge")?.name ?? "Forge 1.12.2",
          launcher: "prism",
          launcher_name: "Prism Launcher",
          source_path: `${PRISM}\\instances\\Forge 1.12.2`,
          changes: [
            { key: "memory", old: { min: null, max: null }, new: { min: 2048, max: 6144 }, default_on: true, inherited: false },
            { key: "java", old: { path: null }, new: { path: "C:\\Program Files\\Java\\jre1.8.0_421\\bin\\javaw.exe", version: "1.8.0_421" }, default_on: true, inherited: false },
            { key: "window", old: { width: null, height: null, fullscreen: null }, new: { width: 1920, height: 1080, fullscreen: null }, default_on: true, inherited: false },
            { key: "jvm_args", old: null, new: "-XX:+UseG1GC", default_on: true, inherited: true },
            { key: "hooks", old: { pre_launch: null, post_exit: null, wrapper: null }, new: { pre_launch: "%INST_DIR%\\backup.bat", post_exit: null, wrapper: null }, default_on: false, inherited: false },
          ],
          data: [entry("config", "dir", "changed", 2.1 * MB, { overwrite_files: 14 }), entry("options.txt", "file", "changed", 5_210)],
          notes: [],
        },
        {
          instance_id: "survival",
          instance_name: instances.get("survival")?.name ?? "Survival 1.21",
          launcher: "modrinth",
          launcher_name: "Modrinth App",
          source_path: "C:\\Users\\steve\\AppData\\Roaming\\ModrinthApp\\profiles\\Survival",
          changes: [
            { key: "memory", old: { min: null, max: 3072 }, new: { min: null, max: 6144 }, default_on: false, inherited: false },
            { key: "env", old: {}, new: { MESA_GLTHREAD: "true" }, default_on: true, inherited: false },
            { key: "group", old: null, new: "Survival", default_on: true, inherited: false },
          ],
          data: [],
          notes: ["Java 8 passt nicht zu Minecraft 1.21.4 – Vibe wählt Java automatisch."],
        },
        {
          instance_id: "hh-armors",
          instance_name: instances.get("hh-armors")?.name ?? "H&H Armors Test",
          launcher: "norisk",
          launcher_name: "NoRisk Client",
          source_path: `${NORISK}#p-main`,
          changes: [],
          data: noriskData,
          notes: [],
        },
      ];

let applied = new Set<string>();

const handlers: Handlers = {
  launchers_detect: () => launchers,
  import_settings_pending: () => offers().filter((o) => !applied.has(o.instance_id)),
  import_settings_offer: ({ instanceId }) => {
    const o = offers().find((x) => x.instance_id === instanceId);
    if (!o) return null;
    return applied.has(o.instance_id) ? { ...o, changes: [], data: [] } : o;
  },
  import_settings_apply: ({ instanceId }) => {
    applied = new Set([...applied, String(instanceId)]);
    return instances.get(String(instanceId));
  },
};

export default handlers;
