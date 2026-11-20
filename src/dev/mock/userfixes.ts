import { fakeTask, type Handlers } from "./util";

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
  datapacks_overview: ({ instanceId }) =>
    instanceId === "survival"
      ? { packs: [{ file_name: "terralith-2.5.zip", in_worlds: [] }, { file_name: "dungeons-and-taverns.zip", in_worlds: [] }], worlds: [{ folder: "Neue Welt", name: "Neue Welt" }, { folder: "Creative", name: "Creative" }] }
      : { packs: [], worlds: [] },
  datapacks_copy_to_worlds: ({ files, worlds }) => (files as string[]).length * (worlds as string[]).length,
} satisfies Handlers;
