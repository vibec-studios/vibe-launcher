import type { AppAction, Instance, ModpackPreview } from "@/lib/types";
import { instances } from "./core";
import { fakeTask, mockEmit, type Handlers } from "./util";

type Input = { kind: "file"; path: string } | { kind: "url"; url: string };

let schemeEnabled = false;

const isPackwiz = (i: Input) => (i.kind === "url" ? i.url : i.path).toLowerCase().split(/[?#]/)[0].endsWith(".toml");

function preview(inst: Instance, input: Input): ModpackPreview {
  const pw = isPackwiz(input);
  const number = pw ? "2.1.0" : (input.kind === "file" ? input.path.split(/[\\/]/).pop()!.replace(/\.(mrpack|zip|vlpack)$/i, "") : "2.0.0");
  return {
    current_version: inst.source?.version_name ?? null,
    target: {
      source: "modrinth",
      id: pw ? "packwiz:3f2a91c0de" : "file",
      project_id: "",
      name: inst.name,
      version_number: number,
      game_versions: [inst.mc_version],
      loaders: [inst.loader.kind],
      release_type: "release",
      date: new Date().toISOString(),
      downloads: 0,
      files: [],
      dependencies: [],
      changelog: null,
    },
    mc_from: inst.mc_version,
    mc_to: inst.mc_version,
    loader_from: inst.loader,
    loader_to: inst.loader,
    files: [
      { path: "mods/sodium-fabric-0.6.5.jar", name: "Sodium", change: "updated", old_path: "mods/sodium-fabric-0.6.3.jar", side: "client" },
      { path: "mods/create-fabric-6.0.4.jar", name: "Create", change: "updated", old_path: "mods/create-fabric-6.0.2.jar", side: "both" },
      { path: "mods/jei-19.21.0.jar", name: "jei-19.21.0.jar", change: "added", old_path: null, side: "both" },
      { path: "mods/old-minimap.jar", name: "Old Minimap", change: "removed", old_path: null, side: "client" },
    ],
    unchanged: 84,
    overrides: [
      { path: "config/sodium-options.json", status: "update" },
      { path: "config/create-client.toml", status: "conflict" },
    ],
    user_files: 2,
    missing: [],
    legacy: !inst.source,
  };
}

const handlers: Handlers = {
  modpack_from_preview: async ({ instanceId, input }) => {
    await new Promise((r) => setTimeout(r, 700));
    const inst = instances.get(instanceId as string);
    if (!inst) throw { kind: "not_found", message: "Instanz nicht gefunden" };
    const i = input as Input;
    if (i.kind === "url" && /fail/i.test(i.url)) throw { kind: "invalid", message: "HTTP 404 für " + i.url };
    return preview(inst, i);
  },
  modpack_from_update: ({ instanceId, input }) => {
    const id = instanceId as string;
    const i = input as Input;
    return fakeTask("update", "Modpack aktualisieren", id, 2500, () => {
      const inst = instances.get(id);
      if (!inst) return;
      const p = preview(inst, i);
      const source: Instance["source"] = isPackwiz(i)
        ? { kind: "packwiz", project_id: i.kind === "url" ? i.url : i.path, version_id: "3f2a91c0de", name: inst.name, version_name: p.target.version_number }
        : { kind: inst.source?.kind === "packwiz" ? "local" : (inst.source?.kind ?? "local"), project_id: inst.source?.kind === "packwiz" ? null : (inst.source?.project_id ?? null), version_id: null, name: inst.source?.name ?? inst.name, version_name: p.target.version_number };
      const next = { ...inst, source };
      instances.set(id, next);
      mockEmit("instance://changed", next);
    });
  },
  modpack_remote_check: ({ instanceId }) => {
    const inst = instances.get(instanceId as string);
    if (inst?.source?.kind !== "packwiz") return null;
    let flag: string | null = null;
    try {
      flag = localStorage.getItem("vl.mock.packwiz-update");
    } catch {
      flag = null;
    }
    return flag ? { location: inst.source.project_id ?? "", name: inst.name, current_version: inst.source.version_name, latest_version: flag } : null;
  },
  modrinth_links_status: () => ({ supported: true, enabled: schemeEnabled, other: schemeEnabled ? null : "Modrinth App" }),
  modrinth_links_set: async ({ enabled }) => {
    await new Promise((r) => setTimeout(r, 300));
    schemeEnabled = !!enabled;
    return { supported: true, enabled: schemeEnabled, other: schemeEnabled ? null : "Modrinth App" };
  },
  app_link_parse: ({ url }) => parse(String(url)),
  content_version_project: ({ versionId }) => {
    if (versionId === "missing0") throw { kind: "not_found", message: "Version nicht gefunden" };
    return "AANobbMI";
  },
};

const TYPES = ["mod", "modpack", "plugin", "resourcepack", "shader", "datapack", "project"];

function parse(raw: string): AppAction | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const web = u.protocol === "https:" && /^(www\.)?modrinth\.com$/.test(u.hostname);
  if (u.protocol !== "modrinth:" && !web) return null;
  const parts = (web ? [] : [u.hostname]).concat(u.pathname.split("/").filter(Boolean)).filter(Boolean);
  const [kind, id, sub, ver] = parts;
  if (!web && kind === "version" && id) return { kind: "install_version", source: "modrinth", version_id: id };
  if (!kind || !id || !TYPES.includes(kind)) return null;
  const version = sub === "version" && ver && (!web || /^[A-Za-z0-9]{8}$/.test(ver)) ? ver : null;
  return { kind: "install", source: "modrinth", project_id: id, version };
}

export default handlers;
