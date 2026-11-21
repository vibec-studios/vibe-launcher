import mockA from "./a";
import mockBedrock from "./bedrock";
import mockB from "./b";
import { fakeTask, mockEmit, tasks, type Handlers } from "./util";
import type { ContentItem, Instance } from "@/lib/types";
import { instances } from "./core";

const flag = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

const loose = ["terralith-2.5.zip", "dungeons-and-taverns.zip"];
const worldDatapacks = new Map<string, Map<string, Set<string>>>();
function worldPacks(instanceId: string, world: string) {
  if (!worldDatapacks.has(instanceId)) worldDatapacks.set(instanceId, new Map());
  const worlds = worldDatapacks.get(instanceId)!;
  if (!worlds.has(world)) worlds.set(world, new Set());
  return worlds.get(world)!;
}

type Target = Pick<Instance, "mc_version" | "loader">;
async function versionPreview(id: string, target: Target) {
  const mods = await mockB.content_list({ instanceId: id, kind: "mod" }) as ContentItem[];
  const items = mods.map((mod, i) => {
    const problem = !mod.source ? "unknown" : target.loader.kind === "vanilla" || (i % 5 === 0) ? "unavailable" : null;
    return { file_name: mod.file_name, title: mod.name, version: problem ? null : mod.version ?? "1.0.0", problem };
  });
  return { token: JSON.stringify([target, items]), items, dependencies: [] };
}

const migrationSnapshots = new Map<string, { id: string; name: string; created: number; auto: boolean; file_count: number; size: number; scopes: string[] }[]>();
const migrationVersions = new Map<string, Target>();
export function mockMigrationSnapshots(id: string) {
  return migrationSnapshots.get(id) ?? [];
}

export default {
  update_check: () => ({ version: "9.9.0", current_version: "1.0.0", channel: "release", notes: "- Neue Funktionen\n- Fehlerbehebungen", date: null }),
  update_blockers: () => {
    const f = flag("vl.mock.update_guard");
    if (f === "bedrock") return { servers: 0, games: 0, tasks: [], bedrock_swap: true };
    if (f === "none") return { servers: 0, games: 0, tasks: [], bedrock_swap: false };
    return { servers: 1, games: 1, tasks: ["Modpack „Create Plus“ wird installiert"], bedrock_swap: false };
  },
  update_install: () => fakeTask("update", "Launcher-Update", null, 4000),
  datadir_preview: (a) => ({
    current: "C:\\Users\\Steve\\AppData\\Roaming\\VibeLauncher",
    default: "C:\\Users\\Steve\\AppData\\Roaming\\VibeLauncher",
    locked: false,
    target: (a.target as string | null) ?? null,
    size: 23.4 * 1024 ** 3,
    free: a.target ? 412 * 1024 ** 3 : null,
    enough: true,
    problem: null,
    busy: flag("vl.mock.datadir_busy") ? ["Minecraft läuft"] : [],
    bedrock_warning: !!a.target && String(a.target).startsWith("D:"),
  }),
  datadir_move: () => fakeTask("datadir", "Speicherort ändern", null, 6000),
  gpu_settings_open: () => null,
  launch_skip_step: () => null,
  "plugin:dialog|open": (args) => ((args.options as { directory?: boolean } | undefined)?.directory ? "D:\\Spiele\\VibeLauncher" : mockB["plugin:dialog|open"](args)),
  datapacks_overview: ({ instanceId }) => {
    const worlds = (mockA.worlds_list({ instanceId }) as { folder: string; name: string }[]).map(({ folder, name }) => ({ folder, name }));
    const packs = instanceId === "survival" ? loose.map((file_name) => ({ file_name, in_worlds: worlds.filter((w) => worldPacks(String(instanceId), w.folder).has(file_name)).map((w) => w.folder) })) : [];
    return { packs, worlds };
  },
  datapacks_copy_to_worlds: ({ instanceId, files, worlds }) => {
    let copied = 0;
    for (const world of worlds as string[]) {
      const installed = worldPacks(String(instanceId), world);
      for (const file of files as string[]) {
        if (installed.has(file)) continue;
        installed.add(file);
        copied++;
      }
    }
    return copied;
  },
  world_datapacks_list: ({ instanceId, world }) => {
    const installed = worldPacks(String(instanceId), String(world));
    return { installed: [...installed].sort(), available: instanceId === "survival" ? loose.filter((f) => !installed.has(f)) : [] };
  },
  world_datapacks_add: ({ instanceId, world, path }) => {
    const installed = worldPacks(String(instanceId), String(world));
    const file = String(path).split(/[\\/]/).pop()!;
    if (installed.has(file)) throw { kind: "invalid", message: `Datapack ${file} ist bereits in der Welt` };
    installed.add(file);
  },
  world_datapacks_remove: ({ instanceId, world, file }) => { worldPacks(String(instanceId), String(world)).delete(String(file)); },
  instance_version_preview: ({ id, target }) => versionPreview(String(id), target as Target),
  instance_version_apply: async ({ id, target, token }) => {
    const iid = String(id);
    const next = target as Target;
    const preview = await versionPreview(iid, next);
    if (preview.token !== token) throw { kind: "invalid", message: "Öffne die Vorschau erneut." };
    return fakeTask("version_change", "Minecraft-Version wird gewechselt", iid, 1300, () => {
      const inst = instances.get(iid)!;
      const snapshot = { id: crypto.randomUUID(), name: `Vor Versionswechsel (${inst.mc_version} ${inst.loader.kind})`, created: Date.now(),
        auto: true, file_count: preview.items.length, size: 0, scopes: ["mods"] };
      migrationSnapshots.set(iid, [snapshot, ...mockMigrationSnapshots(iid)]);
      migrationVersions.set(snapshot.id, { mc_version: inst.mc_version, loader: inst.loader });
      const updated = { ...inst, ...next, install_state: "not_installed" as const, version_id: null };
      instances.set(iid, updated);
      for (const item of preview.items.filter((i) => i.problem && !i.file_name.endsWith(".disabled"))) {
        void mockB.content_set_enabled({ instanceId: iid, kind: "mod", fileName: item.file_name, enabled: false });
      }
      mockEmit("instance://changed", updated);
      mockEmit("content://changed", { instance_id: iid });
    });
  },
  snapshot_restore: ({ instanceId, snapshotId }) => {
    const iid = String(instanceId);
    const version = migrationVersions.get(String(snapshotId));
    const inst = instances.get(iid);
    if (!version || !inst) return null;
    const updated = { ...inst, ...version, install_state: "not_installed" as const, version_id: null };
    instances.set(iid, updated);
    mockEmit("instance://changed", updated);
    mockEmit("content://changed", { instance_id: iid });
    return null;
  },
  bedrock_status: (args) => {
    const s = mockBedrock.bedrock_status(args) as { channels: Record<string, unknown>[] };
    if (!flag("vl.mock.bedrock_locked")) return s;
    return { ...s, channels: s.channels.map((c) => (c.channel === "release" ? { ...c, active_instance: "bedrock-welten", swap_locked: true } : c)) };
  },
  instance_launch: async (args) => {
    const id = (await mockA.instance_launch(args)) as string;
    if (flag("vl.mock.prelaunch")) {
      const cur = tasks.get(id);
      if (cur) {
        const next = { ...cur, step: "auto_update", message: "Prüfe 142 Mods auf Updates …", progress: null };
        tasks.set(id, next);
        mockEmit("task://update", next);
      }
    }
    return id;
  },
} satisfies Handlers;
