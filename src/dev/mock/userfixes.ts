import mockA from "./a";
import mockB from "./b";
import { fakeTask, mockEmit, tasks, type Handlers } from "./util";

const flag = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

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
  datapacks_overview: ({ instanceId }) =>
    instanceId === "survival"
      ? { packs: [{ file_name: "terralith-2.5.zip", in_worlds: [] }, { file_name: "dungeons-and-taverns.zip", in_worlds: [] }], worlds: [{ folder: "Neue Welt", name: "Neue Welt" }, { folder: "Creative", name: "Creative" }] }
      : { packs: [], worlds: [] },
  datapacks_copy_to_worlds: ({ files, worlds }) => (files as string[]).length * (worlds as string[]).length,
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
