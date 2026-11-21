// Mock: Minecraft Bedrock (Status, Instanzen, Add-ons, Welten, Sicherungen, CurseForge-Suche). Nur für VITE_MOCK=1.
// Screenshots: localStorage vl.mock.bedrock = "missing" (nicht installiert) | "unsupported" (kein Windows),
// vl.mock.cf = 1 (CurseForge-Schlüssel vorhanden).
import type { Instance, ProjectHit, WorldBackup } from "@/lib/types";
import core, { instances } from "./core";
import { fakeTask, mockEmit, type Handlers } from "./util";

const flag = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const mode = flag("vl.mock.bedrock");
const now = Date.now();

function bedrockInst(id: string, name: string, extra: Partial<Instance>): Instance {
  return {
    id,
    name,
    icon: null,
    accent: "#7fb0ff",
    group: null,
    mc_version: "bedrock",
    loader: { kind: "vanilla", version: null },
    java: { path: null, min_memory_mb: null, max_memory_mb: null, jvm_args: null, env: {} },
    window: { width: null, height: null, fullscreen: null },
    hooks: { pre_launch: null, post_exit: null, wrapper: null },
    source: null,
    install_state: "installed",
    version_id: null,
    created_at: now - 86400000 * 6,
    last_played: now - 3600_000 * 5,
    play_time_secs: 4 * 3600 + 1200,
    notes: null,
    auto_update_content: false,
    bedrock: { channel: "release", profile: "isolated" },
    ...extra,
  };
}

instances.set("bedrock-welten", bedrockInst("bedrock-welten", "Bedrock – Meine Welten", { accent: "#5fbf4a" }));
instances.set("bedrock-preview", bedrockInst("bedrock-preview", "Bedrock Preview", { bedrock: { channel: "preview", profile: "isolated" }, last_played: null, play_time_secs: 0, accent: "#e05cff" }));

/** Pixel-Icon als data:-URL (sieht aus wie ein pack_icon.png). */
function pixelIcon(a: string, b: string, c: string): string {
  const cells: string[] = [];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const v = (x * 7 + y * 13 + x * y) % 5;
      cells.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${v < 2 ? a : v < 4 ? b : c}"/>`);
    }
  return "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">${cells.join("")}</svg>`);
}

function worldIcon(sky: string, ground: string, hill: string): string {
  return (
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9" shape-rendering="crispEdges"><rect width="16" height="9" fill="${sky}"/><rect y="6" width="16" height="3" fill="${ground}"/><rect x="2" y="4" width="4" height="2" fill="${hill}"/><rect x="9" y="3" width="5" height="3" fill="${hill}"/><rect x="12" y="1" width="2" height="1" fill="#fff8"/></svg>`,
    )
  );
}

type Pack = {
  id: string;
  kind: "resource" | "behavior" | "skin" | "world_template";
  name: string;
  description: string;
  uuid: string;
  version: number[];
  min_engine: string | null;
  dev: boolean;
  size: number;
  icon: string | null;
  modified: number;
  source: { project_id: string; file_id: string; title: string | null } | null;
};
type World = { folder: string; name: string; icon: string | null; size: number; last_played: number | null; user: string; resource_packs: string[]; behavior_packs: string[] };

const packs = new Map<string, Pack[]>();
const worlds = new Map<string, World[]>();
const backups = new Map<string, WorldBackup[]>();

packs.set("bedrock-welten", [
  { id: "resource_packs/Klare Kanten", kind: "resource", name: "Klare Kanten", description: "Schärfere Texturen in 32×32", uuid: "a1", version: [2, 1, 0], min_engine: "1.20.0", dev: false, size: 8_400_000, icon: pixelIcon("#5aa9ff", "#2f6fbf", "#cde6ff"), modified: now - 86400000 * 2, source: { project_id: "1", file_id: "1", title: null } },
  { id: "behavior_packs/Mehr Tiere", kind: "behavior", name: "Mehr Tiere", description: "Zwölf neue Tiere für die Oberwelt", uuid: "b1", version: [1, 4, 2], min_engine: "1.21.0", dev: false, size: 3_100_000, icon: pixelIcon("#ffb547", "#c2771e", "#fff1d6"), modified: now - 86400000 * 3, source: { project_id: "2", file_id: "2", title: null } },
  { id: "resource_packs/Mehr Tiere RP", kind: "resource", name: "Mehr Tiere (Ressourcen)", description: "Modelle und Texturen zu Mehr Tiere", uuid: "a2", version: [1, 4, 2], min_engine: "1.21.0", dev: false, size: 5_900_000, icon: pixelIcon("#ffb547", "#7ee07a", "#fff1d6"), modified: now - 86400000 * 3, source: null },
  { id: "behavior_packs/Baumfäller", kind: "behavior", name: "Baumfäller", description: "Ganze Bäume mit einem Schlag fällen", uuid: "b2", version: [3, 0, 0], min_engine: "1.21.50", dev: false, size: 410_000, icon: pixelIcon("#7ee07a", "#3d8b37", "#d9f7d3"), modified: now - 86400000 * 9, source: null },
  { id: "skin_packs/Ritter", kind: "skin", name: "Ritter-Skins", description: "Acht Skins im Ritter-Stil", uuid: "s1", version: [1, 0, 0], min_engine: null, dev: false, size: 980_000, icon: pixelIcon("#ff6b9a", "#a83a62", "#ffe0ea"), modified: now - 86400000 * 20, source: null },
]);
worlds.set("bedrock-welten", [
  { folder: "Xk3Lm9AbQ0c=", name: "Insel mit Leuchtturm", icon: worldIcon("#7ec8ff", "#5fbf4a", "#3d8b37"), size: 48_200_000, last_played: now - 3600_000 * 5, user: "2535411112222333", resource_packs: ["a1", "a2"], behavior_packs: ["b1"] },
  { folder: "p0Qr7TuVw1E=", name: "Kreativ-Baustelle", icon: worldIcon("#ffd28a", "#c9a35f", "#8a6a3a"), size: 12_900_000, last_played: now - 86400000 * 2, user: "2535411112222333", resource_packs: ["a1"], behavior_packs: [] },
  { folder: "Zz9Yy8Xx7Ww=", name: "Hardcore mit Freunden", icon: worldIcon("#2b2f4a", "#4b5a3a", "#2c3a24"), size: 210_500_000, last_played: now - 86400000 * 12, user: "2535411112222333", resource_packs: [], behavior_packs: ["b1", "b2"] },
]);
backups.set("bedrock-welten", [
  { id: "Xk3Lm9AbQ0c=/2026-11-18_20-14-03-120", folder: "Xk3Lm9AbQ0c=", world_name: "Insel mit Leuchtturm", created: now - 86400000, size: 41_000_000, auto: false },
  { id: "Xk3Lm9AbQ0c=/2026-11-12_18-02-44-008", folder: "Xk3Lm9AbQ0c=", world_name: "Insel mit Leuchtturm", created: now - 86400000 * 7, size: 39_500_000, auto: true },
  { id: "Zz9Yy8Xx7Ww=/2026-11-07_21-40-10-500", folder: "Zz9Yy8Xx7Ww=", world_name: "Hardcore mit Freunden", created: now - 86400000 * 12, size: 180_000_000, auto: false },
]);

const CLASSES = [
  { id: 4984, name: "Add-ons", slug: "addons" },
  { id: 6929, name: "Texture Packs", slug: "texture-packs" },
  { id: 6913, name: "Maps", slug: "maps" },
  { id: 6925, name: "Skins", slug: "skins" },
  { id: 6940, name: "Scripts", slug: "scripts" },
];

function hit(id: number, title: string, author: string, description: string, downloads: number, cats: string[], icon: string, manual = false): ProjectHit {
  return {
    source: "curseforge",
    id: String(id),
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title,
    description,
    author,
    icon_url: icon,
    downloads,
    follows: Math.round(downloads / 120),
    categories: cats,
    project_type: "mod",
    updated: new Date(now - 86400000 * (id % 30)).toISOString(),
    game_versions: [],
    loaders: [],
    banner_url: null,
    color: null,
    created: null,
    manual_download: manual,
  };
}

const HITS: Record<number, ProjectHit[]> = {
  4984: [
    hit(901, "Möbel & Deko", "Blockbauer", "Über 200 Möbelstücke für dein Zuhause – Sofas, Lampen, Küchen.", 4_820_000, ["Dekoration", "Blöcke"], pixelIcon("#c2771e", "#ffb547", "#fff1d6")),
    hit(902, "Mehr Erze", "Grubenkönig", "Neue Erze, Werkzeuge und Rüstungen für das Überleben.", 2_310_000, ["Items", "Survival"], pixelIcon("#8f9aa6", "#5aa9ff", "#2c3342")),
    hit(903, "Drachenreiter", "Himmelsschmied", "Zähme und reite eigene Drachen.", 1_970_000, ["Kreaturen"], pixelIcon("#7ee07a", "#3d8b37", "#ff6b9a")),
    hit(904, "Rucksäcke", "Packesel", "Tragbare Rucksäcke mit 27 Plätzen.", 1_150_000, ["Items"], pixelIcon("#a8743a", "#6d4a22", "#e0b07a"), true),
    hit(905, "Mini-Karte", "Kartograf", "Eine kleine Karte oben rechts, mit Wegpunkten.", 860_000, ["Werkzeuge"], pixelIcon("#5fbf4a", "#7ec8ff", "#ffffff")),
    hit(906, "Bessere Dörfer", "Dorfplaner", "Größere Dörfer mit Märkten und neuen Berufen.", 640_000, ["Welt"], pixelIcon("#e0b07a", "#ffb547", "#5fbf4a")),
  ],
  6929: [
    hit(911, "Weiche Schatten", "Lichtgestalt", "Sanftere Beleuchtung und Wasser ohne Shader.", 3_400_000, ["Realistisch"], pixelIcon("#5aa9ff", "#2f6fbf", "#cde6ff")),
    hit(912, "Pastell-Welt", "Farbklecks", "Die ganze Welt in hellen Pastellfarben.", 980_000, ["Bunt"], pixelIcon("#ff6b9a", "#ffd28a", "#cde6ff")),
  ],
};

const handlers: Handlers = {
  system_info: () => {
    const s = core.system_info({}) as Record<string, unknown>;
    return { ...s, os: mode === "unsupported" ? "linux" : s.os, curseforge_available: flag("vl.mock.cf") === "1" || !!s.curseforge_available };
  },
  bedrock_status: () => ({
    supported: mode !== "unsupported",
    simulated: false,
    blocked: null,
    channels: (["release", "preview"] as const).map((ch) => ({
      channel: ch,
      installed: mode !== "missing" && ch === "release",
      version: mode !== "missing" && ch === "release" ? "1.21.120" : null,
      layout: "gdk",
      data_dir: ch === "release" ? "C:\\Users\\steve\\AppData\\Roaming\\Minecraft Bedrock" : "C:\\Users\\steve\\AppData\\Roaming\\Minecraft Bedrock Preview",
      has_data: ch === "release",
      active_instance: null,
      running: false,
      store_url: "ms-windows-store://pdp/?productid=9NBLGGH2JHXJ",
    })),
  }),
  bedrock_home_summary: () => ({ worlds: 3, packs: 5, size: 285_000_000 }),
  bedrock_create: ({ name, channel, profile }) => {
    const id = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-") || "bedrock";
    const inst = bedrockInst(id, String(name), { last_played: null, play_time_secs: 0, bedrock: { channel: channel as "release", profile: profile as "isolated" } });
    instances.set(id, inst);
    mockEmit("instance://changed", inst);
    return inst;
  },
  bedrock_packs: ({ instanceId }) => packs.get(instanceId as string) ?? [],
  bedrock_pack_remove: ({ instanceId, packId }) => {
    packs.set(instanceId as string, (packs.get(instanceId as string) ?? []).filter((p) => p.id !== packId));
    mockEmit("content://changed", { instance_id: instanceId as string });
    return null;
  },
  bedrock_pack_export: () => null,
  bedrock_import_files: ({ paths }) => ({ packs: (paths as string[]).map((p) => p.split(/[\\/]/).pop() ?? p), worlds: [], updated: [] }),
  bedrock_worlds: ({ instanceId }) => worlds.get(instanceId as string) ?? [],
  bedrock_can_import_worlds: ({ instanceId }) => (worlds.get(instanceId as string) ?? []).length > 0,
  bedrock_world_delete: () => null,
  bedrock_world_export: () => null,
  bedrock_world_pack_set: ({ instanceId, folder, packId, enabled }) => {
    const p = (packs.get(instanceId as string) ?? []).find((x) => x.id === packId);
    const w = (worlds.get(instanceId as string) ?? []).find((x) => x.folder === folder);
    if (p && w) {
      const list = p.kind === "behavior" ? w.behavior_packs : w.resource_packs;
      const i = list.indexOf(p.uuid);
      if (enabled && i < 0) list.unshift(p.uuid);
      if (!enabled && i >= 0) list.splice(i, 1);
    }
    return null;
  },
  bedrock_backups: ({ instanceId }) => backups.get(instanceId as string) ?? [],
  bedrock_backup_create: ({ instanceId, folder }) => {
    const w = (worlds.get(instanceId as string) ?? []).find((x) => x.folder === folder);
    const b: WorldBackup = { id: `${folder}/${Date.now()}`, folder: folder as string, world_name: w?.name ?? "Welt", created: Date.now(), size: w?.size ?? 0, auto: false };
    backups.set(instanceId as string, [b, ...(backups.get(instanceId as string) ?? [])]);
    return b;
  },
  bedrock_backup_restore: () => null,
  bedrock_backup_delete: ({ instanceId, backupId }) => {
    backups.set(instanceId as string, (backups.get(instanceId as string) ?? []).filter((b) => b.id !== backupId));
    return null;
  },
  bedrock_open_folder: () => null,
  bedrock_recover: () => false,
  bedrock_open_store: () => null,
  bedrock_cf_classes: () => CLASSES,
  bedrock_cf_search: ({ query, classId }) => {
    const q = String(query ?? "").toLowerCase();
    const list = (HITS[Number(classId)] ?? HITS[4984]).filter((h) => !q || h.title.toLowerCase().includes(q) || h.description.toLowerCase().includes(q));
    return { hits: list, total: list.length, offset: 0, limit: 30 };
  },
  bedrock_cf_install: ({ instanceId, title }) => {
    return fakeTask("content", `${title} wird installiert`, instanceId as string, 1800, () => mockEmit("content://changed", { instance_id: instanceId as string }));
  },
};

export const priority = 1;

export default handlers;
