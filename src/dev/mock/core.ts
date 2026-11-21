// Mock: Kern-Commands (Instanzen, Einstellungen, Aufgaben, System). OWNER: Integrator.
import type { Instance, Settings } from "@/lib/types";
import { mockAppearance } from "./appearance";
import { normalizeLang } from "@/i18n/languages";
import { STORE_URL } from "@/lib/domains";
import { mockEmit, tasks, type Handlers } from "./util";

const now = Date.now();
function mockFlag(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function inst(id: string, name: string, mc: string, kind: Instance["loader"]["kind"], ver: string | null, extra: Partial<Instance> = {}): Instance {
  return {
    auto_update_content: null,
    id,
    name,
    icon: null,
    accent: null,
    group: null,
    mc_version: mc,
    loader: { kind, version: ver },
    java: { path: null, min_memory_mb: null, max_memory_mb: null, jvm_args: null, env: {} },
    window: { width: null, height: null, fullscreen: null },
    hooks: { pre_launch: null, post_exit: null, wrapper: null },
    source: null,
    install_state: "installed",
    version_id: null,
    created_at: now - 86400000 * 20,
    last_played: null,
    play_time_secs: 0,
    notes: null,
    ...extra,
  };
}

export const instances = new Map<string, Instance>(
  [
    inst("survival", "Survival 1.21", "1.21.4", "fabric", "0.16.9", { last_played: now - 3600_000, play_time_secs: 36000, accent: "#3fe0c5", icon: "block:grass@sky" }),
    inst("hh-armors", "H&H Armors Test", "1.21.11", "fabric", "0.17.2", { last_played: now - 86400_000 * 2, play_time_secs: 5400, accent: "#ff6b9a", icon: "block:amethyst@night" }),
    inst("all-the-mods", "All the Mods 10", "1.21.1", "neoforge", "21.1.77", {
      source: { kind: "curseforge", project_id: "925200", version_id: "1", name: "All the Mods 10", version_name: "2.3" },
      install_state: "not_installed",
    }),
    inst("vanilla", "Vanilla", "1.21.4", "vanilla", null),
    inst("old-forge", "Forge 1.12.2", "1.12.2", "forge", "14.23.5.2860", { group: "Alt", icon: "block:bricks" }),
    inst("creative", "Kreativ-Welt", "1.21.4", "vanilla", null, { icon: "block:stars", accent: "#5aa9ff" }),
    inst("pvp", "PvP Training", "1.8.9", "forge", "11.15.1.2318", { icon: "block:sword@sunset", group: "Alt" }),
    inst("skyblock", "Skyblock", "1.20.1", "fabric", "0.16.9"),
  ].map((i) => [i.id, i]),
);

function updateInstance(id: string, patch: Partial<Instance>) {
  const next = { ...instances.get(id)!, ...patch };
  instances.set(next.id, next);
  mockEmit("instance://changed", next);
  return next;
}

let settings: Settings = {
  // Screenshots: localStorage vl.mock.lang = en
  language: normalizeLang(mockFlag("vl.mock.lang") ?? mockFlag("lang")) ?? "de",
  min_memory_mb: 512,
  max_memory_mb: 4096,
  jvm_args: "",
  game_width: 1280,
  game_height: 720,
  fullscreen: false,
  java_overrides: {},
  auto_java: true,
  launch_behavior: "keep",
  show_snapshots: false,
  concurrent_downloads: 16,
  curseforge_api_key: null,
  msa_client_id: null,
  check_updates: true,
  update_channel: "release",
  vibe: { enabled: true, social: true, presence: true, hosting: true, sharing: true },
  discord_rpc: true,
  discord_details: true,
  discord_large: "logo",
  discord_pack_icon: true,
  discord_small: "head",
  discord_image: null,
  wrapper_command: null,
  open_log_on_launch: false,
  console_on_launch: false,
  reduce_motion: false,
  auto_update_content: false,
  snapshot_keep: 10,
  fix_backup: { mode: "recommended", areas: ["mods", "configs", "options"] },
  world_backup_on_launch: false,
  world_backups_keep: 5,
  minecraftcapes: true,
  // Screenshots: localStorage vl.mock.mode = simple|expert, vl.mock.onboarding = 1 (Erststart)
  ui_mode: mockFlag("vl.mock.mode") === "simple" ? "simple" : "expert",
  onboarding_done: mockFlag("vl.mock.onboarding") !== "1",
  simple_hint_seen: mockFlag("vl.mock.hint") !== "1",
  simple_tour_done: mockFlag("vl.mock.tour") !== "1",
  // Screenshots: localStorage vl.mock.notices = 1 -> Umzugs-Hinweis schon weggeklickt
  dismissed_notices: mockFlag("vl.mock.notices") === "1" ? ["domain-move-2026-11"] : [],
  // Screenshots: vl.mock.design / vl.mock.theme / vl.mock.custom, Variante per window.__VL_MOCK_APPEARANCE (siehe ./appearance.ts)
  appearance: mockAppearance(),
  stores: [{ id: "vibe-craft-studios", name: "Vibe Craft Studios", url: STORE_URL, enabled: true, icon: null }],
};

const handlers: Handlers = {
  instances_list: () => [...instances.values()],
  instance_get: ({ id }) => {
    const i = instances.get(id as string);
    if (!i) throw { kind: "not_found", message: "Instanz nicht gefunden" };
    return i;
  },
  instance_create: ({ req }) => {
    const r = req as { name: string; mc_version: string; loader: Instance["loader"]; icon?: string; accent?: string; group?: string };
    const id = r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "instance";
    const i = inst(id, r.name, r.mc_version, r.loader.kind, r.loader.version, { install_state: "not_installed", icon: r.icon ?? null, accent: r.accent ?? null, group: r.group ?? null, created_at: Date.now() });
    instances.set(id, i);
    mockEmit("instance://changed", i);
    return i;
  },
  instance_update: ({ id, patch }) => updateInstance(id as string, patch as Partial<Instance>),
  instance_delete: ({ id }) => {
    instances.delete(id as string);
    mockEmit("instance://removed", { id: id as string });
  },
  instance_duplicate: ({ id, name }) => {
    const src = instances.get(id as string)!;
    const n = (name as string) || `${src.name} (Kopie)`;
    const i = { ...src, id: src.id + "-2", name: n, last_played: null };
    instances.set(i.id, i);
    mockEmit("instance://changed", i);
    return i;
  },
  instance_set_icon: ({ id, path }) => updateInstance(id as string, { icon: path ? "/logo.png" : null }),
  instance_open_folder: () => null,
  settings_get: () => settings,
  stores_list: () => settings.stores.map((store) => ({
    ...store,
    builtin: store.id === "vibe-craft-studios",
    homepage: null,
    description: null,
    project_count: null,
    error: null,
  })),
  discord_available: () => true,
  appearance_import_background: ({ path }) => path as string,
  app_icon_import: ({ path }) => path as string,
  app_icon_preview: ({ motif, color }) =>
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="1.4" fill="${color}"/><rect x="4" y="4" width="8" height="8" fill="${motif === "penguin" ? "#2c3342" : motif === "custom" ? "#ffffff" : "#8f9aa6"}"/></svg>`,
    ),
  settings_set: ({ settings: s }) => {
    settings = s as Settings;
    mockEmit("settings://changed", settings);
    return settings;
  },
  system_info: () => ({
    version: "1.0.0",
    data_dir: "C:\\Users\\steve\\AppData\\Roaming\\VibeLauncher",
    os: "windows",
    arch: "x86_64",
    total_memory_mb: 32768,
    curseforge_available: !!settings.curseforge_api_key,
    msa_available: !!settings.msa_client_id,
  }),
  tasks_list: () => [...tasks.values()],
  task_cancel: ({ id }) => {
    const t = tasks.get(id as string);
    if (t) {
      const c = { ...t, status: "cancelled" as const };
      tasks.set(t.id, c);
      mockEmit("task://update", c);
    }
    return true;
  },
  tasks_clear: () => {
    for (const [k, t] of tasks) if (t.status !== "running") tasks.delete(k);
  },
  open_path: () => null,
  open_data_dir: () => null,
};

export default handlers;
