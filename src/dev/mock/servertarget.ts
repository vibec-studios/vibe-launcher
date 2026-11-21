import type { Server } from "@/lib/types";
import { instances } from "./core";
import { mockAddonStore } from "./servers";
import { fakeTask, type Handlers } from "./util";

type Hit = { source: "modrinth" | "hangar"; id: string; slug: string; title: string; description: string; author: string; icon_url: string | null; downloads: number; updated: string; page_url: string };

const iso = new Date().toISOString();
const mods: Hit[] = [
  { source: "modrinth", id: "P7dR8mSH", slug: "fabric-api", title: "Fabric API", description: "Lightweight and modular API providing common hooks.", author: "modmuss50", icon_url: "https://cdn.modrinth.com/data/P7dR8mSH/icon.png", downloads: 288_600_000, updated: iso, page_url: "https://modrinth.com/mod/fabric-api" },
  { source: "modrinth", id: "gvQqBUqZ", slug: "lithium", title: "Lithium", description: "No-compromises game logic optimization mod.", author: "jellysquid3", icon_url: "https://cdn.modrinth.com/data/gvQqBUqZ/icon.png", downloads: 144_200_000, updated: iso, page_url: "https://modrinth.com/mod/lithium" },
  { source: "modrinth", id: "fALzjamp", slug: "chunky", title: "Chunky", description: "Pre-generates chunks, quickly and efficiently.", author: "pop4959", icon_url: null, downloads: 12_400_000, updated: iso, page_url: "https://modrinth.com/mod/chunky" },
  { source: "modrinth", id: "l6YH9Als", slug: "spark", title: "spark", description: "A performance profiler for Minecraft clients, servers and proxies.", author: "lucko", icon_url: null, downloads: 30_100_000, updated: iso, page_url: "https://modrinth.com/mod/spark" },
  { source: "modrinth", id: "Ha28R6CL", slug: "krypton", title: "Krypton", description: "A mod to optimize the Minecraft networking stack.", author: "astei", icon_url: null, downloads: 9_800_000, updated: iso, page_url: "https://modrinth.com/mod/krypton" },
  { source: "modrinth", id: "9s6osm5g", slug: "servercore", title: "ServerCore", description: "Server-side optimizations and features.", author: "Wesley1808", icon_url: null, downloads: 3_100_000, updated: iso, page_url: "https://modrinth.com/mod/servercore" },
];
const plugins: Hit[] = [
  { source: "modrinth", id: "Vebnzrzj", slug: "luckperms", title: "LuckPerms", description: "A permissions plugin for Minecraft servers.", author: "Luck", icon_url: null, downloads: 4_200_000, updated: iso, page_url: "https://modrinth.com/plugin/luckperms" },
  { source: "modrinth", id: "UmLGoGij", slug: "chunky", title: "Chunky", description: "Pre-generates chunks, quickly and efficiently.", author: "pop4959", icon_url: null, downloads: 12_400_000, updated: iso, page_url: "https://modrinth.com/plugin/chunky" },
  { source: "modrinth", id: "MubyTbnA", slug: "freedomchat", title: "FreedomChat", description: "Liberate your server from the chat-reporting bourgeoisie.", author: "Oharass", icon_url: null, downloads: 1_100_000, updated: iso, page_url: "https://modrinth.com/plugin/freedomchat" },
  { source: "modrinth", id: "hXiIvTyT", slug: "essentialsx", title: "EssentialsX", description: "The essential plugin suite for Minecraft servers.", author: "EssentialsX Team", icon_url: null, downloads: 6_400_000, updated: iso, page_url: "https://modrinth.com/plugin/essentialsx" },
];
const hangar: Hit[] = [
  { source: "hangar", id: "ViaVersion/ViaVersion", slug: "ViaVersion", title: "ViaVersion", description: "Allow newer clients to join older server versions.", author: "ViaVersion", icon_url: null, downloads: 2_300_000, updated: iso, page_url: "https://hangar.papermc.io/ViaVersion/ViaVersion" },
  { source: "hangar", id: "GeyserMC/Geyser", slug: "Geyser", title: "Geyser", description: "A bridge between Minecraft: Bedrock Edition and Minecraft: Java Edition.", author: "GeyserMC", icon_url: null, downloads: 1_900_000, updated: iso, page_url: "https://hangar.papermc.io/GeyserMC/Geyser" },
  { source: "hangar", id: "jmp/MiniMOTD", slug: "MiniMOTD", title: "MiniMOTD", description: "Simple and lightweight MOTD plugin.", author: "jmp", icon_url: null, downloads: 410_000, updated: iso, page_url: "https://hangar.papermc.io/jmp/MiniMOTD" },
];
const all = [...mods, ...plugins, ...hangar];

function details(h: Hit) {
  return {
    ...h,
    follows: Math.round(h.downloads / 400),
    categories: ["utility"],
    project_type: h.source === "hangar" || plugins.includes(h) ? "plugin" : "mod",
    created: iso,
    game_versions: ["1.21.4", "1.21.1"],
    loaders: h.source === "hangar" || plugins.includes(h) ? ["paper", "spigot", "bukkit"] : ["fabric", "quilt"],
    body: `## ${h.title}\n\n${h.description}\n\nMock-Beschreibung für den Server-Modus der Entdecken-Seite.`,
    body_format: "markdown",
    gallery: [],
    links: { website: null, source: null, issues: null, wiki: null, discord: null, donations: [] },
    license: "MIT",
    published: iso,
  };
}

function addonFrom(h: Hit) {
  return {
    file_name: `${h.slug}-1.0.0.jar`,
    enabled: true,
    size: 300_000 + h.slug.length * 40_000,
    modified: Date.now(),
    sha1: null,
    name: h.title,
    version: "1.0.0",
    authors: [h.author],
    description: h.description,
    icon: h.icon_url,
    source: h.source,
    project_id: h.id,
    slug: h.slug,
    version_id: null,
    title: h.title,
    page_url: h.page_url,
  };
}

type Snap = { name: string; created: number; size: number; label: string | null; mc_version: string | null; loader: Server["loader"] | null };
const manifests = new Map<string, { name: string; version_name: string | null; format: string; mc_version: string; loader: Server["loader"]; files: string[]; applied_at: number }>();
const snapshots = new Map<string, Snap[]>();

function packPreview(input: { kind: string; id?: string; path?: string }, serverId: string | null) {
  const inst = input.kind === "instance" ? instances.get(String(input.id)) : null;
  const name = inst?.name ?? String(input.path ?? "Pack").split(/[\\/]/).pop()!.replace(/\.(mrpack|zip|vlpack)$/i, "");
  const mc = inst?.mc_version ?? "1.21.1";
  const loader = inst?.loader ?? { kind: "fabric" as const, version: "0.16.9" };
  const entries = [
    ["Fabric API", "both", 2_100_000],
    ["Lithium", "both", 690_000],
    ["Sodium", "client", 1_200_000],
    ["Iris Shaders", "client", 2_400_000],
    ["FerriteCore", "both", 140_000],
    ["Chunky", "server", 320_000],
    ["Mod Menu", "client", 590_000],
    ["Create", "both", 15_400_000],
  ].map(([n, side, size]) => ({
    path: `mods/${String(n).toLowerCase().replace(/\s+/g, "-")}.jar`,
    name: String(n),
    side,
    enabled: true,
    include: side !== "client",
    origin: inst ? "local" : "download",
    size,
  }));
  let target = null;
  if (serverId) {
    const s = mockAddonStore.server(serverId);
    const m = manifests.get(s.id);
    target = {
      server_id: s.id,
      name: s.name,
      mc_from: s.mc_version,
      loader_from: s.loader,
      platform: s.platform?.kind ?? null,
      changes_software: !!s.platform || s.mc_version !== mc || s.loader.kind !== loader.kind,
      running: mockAddonStore.running(s.id),
      managed: m?.name ?? null,
      removes: m ? m.files : mockAddonStore.items(s.id).map((a) => `mods/${a.file_name}`),
    };
  }
  return {
    name,
    version_name: inst ? null : "2.4.0",
    format: inst ? "instance" : String(input.path ?? "").endsWith(".zip") ? "curseforge" : "mrpack",
    mc_version: mc,
    loader,
    entries,
    config_files: 42,
    config_dirs: ["config", "defaultconfigs", "kubejs"],
    client_skipped: inst ? 2 : 5,
    missing: inst ? [] : ["OptiFine_1.21.1_HD_U_J1.jar"],
    warnings: [],
    worlds: inst ? ["Neue Welt", "Bauprojekt"] : [],
    target,
  };
}

export function serverTargetMock(base: Handlers): Handlers {
  return {
    server_addon_search: ({ id, source, query, offset }) => {
      const s = mockAddonStore.server(String(id));
      const pool = source === "hangar" ? hangar : s.platform ? plugins : mods;
      const q = String(query ?? "").toLowerCase();
      const hits = pool.filter((h) => !q || h.title.toLowerCase().includes(q));
      return { hits: Number(offset ?? 0) > 0 ? [] : hits, total: hits.length, offset: Number(offset ?? 0) };
    },
    server_addon_install: async ({ id, source, project }) => {
      await new Promise((r) => setTimeout(r, 700));
      const h = all.find((x) => x.id === project && x.source === source);
      if (!h) throw { kind: "not_found", message: "Projekt nicht gefunden" };
      const items = [...mockAddonStore.items(String(id))];
      const files = [addonFrom(h).file_name];
      if (!items.some((a) => a.project_id === h.id)) items.push(addonFrom(h) as (typeof items)[number]);
      if (h.slug === "lithium" && !items.some((a) => a.slug === "fabric-api")) {
        items.push(addonFrom(mods[0]) as (typeof items)[number]);
        files.push(addonFrom(mods[0]).file_name);
      }
      mockAddonStore.set(String(id), items);
      return files;
    },
    server_addon_check: ({ id, source, project }) => {
      const s = mockAddonStore.server(String(id));
      const items = mockAddonStore.items(s.id);
      const h = all.find((x) => x.id === project);
      const installed = items.some((a) => a.project_id === project || (h && a.title === h.title));
      const isPlugin = !!h && (h.source === "hangar" || plugins.includes(h));
      if (!s.platform && s.loader.kind === "vanilla") return { ok: false, reason: "vanilla", version: null, installed, deps: 0, message: null };
      if (source === "hangar" && !s.platform) return { ok: false, reason: "hangar", version: null, installed, deps: 0, message: null };
      if (String(project).toLowerCase().includes("sodium") || project === "AANobbMI") return { ok: false, reason: "client_only", version: null, installed, deps: 0, message: null };
      if (s.platform && h && !isPlugin) return { ok: false, reason: "not_plugin", version: null, installed, deps: 0, message: null };
      if (!s.platform && h && isPlugin) return { ok: false, reason: "loader", version: null, installed, deps: 0, message: null };
      return { ok: true, reason: null, version: "1.0.0", installed, deps: h?.slug === "lithium" ? 1 : 0, message: null };
    },
    server_addon_project: ({ project }) => {
      const h = hangar.find((x) => x.id === project);
      if (!h) throw { kind: "not_found", message: "Hangar-Projekt nicht gefunden" };
      return details(h);
    },
    server_addon_update: ({ id, files }) => {
      const items = mockAddonStore.items(String(id));
      const list = (files as string[] | null) ?? items.filter((a) => a.slug === "lithium").map((a) => a.file_name);
      mockAddonStore.set(String(id), items.map((a) => (list.includes(a.file_name) && a.slug === "lithium" ? { ...a, version: "0.15.0", slug: "lithium-updated" } : a)));
      return list.length;
    },
    content_project: async (args) => {
      const h = all.find((x) => x.id === args.id && x.source === "modrinth");
      if (h) return details(h);
      return base.content_project(args);
    },
    server_pack_preview: ({ input, serverId }) => packPreview(input as { kind: string }, (serverId as string | null) ?? null),
    server_pack_apply: ({ req }) => {
      const r = req as { input: { kind: string }; target: { kind: string; name?: string; id?: string }; options: { selected: string[] | null } };
      const p = packPreview(r.input, r.target.kind === "existing" ? String(r.target.id) : null);
      let s: Server;
      if (r.target.kind === "new") {
        const id = String(r.target.name ?? p.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "server";
        const base = mockAddonStore.server("survival-smp");
        s = mockAddonStore.save({ ...base, id, name: String(r.target.name), mc_version: p.mc_version, loader: p.loader, platform: null, eula: false, install_state: "not_installed", connection: "local", created_at: Date.now(), last_started: null, accent: "#a78bfa" });
      } else {
        s = mockAddonStore.server(String(r.target.id));
        const list = snapshots.get(s.id) ?? [];
        list.unshift({ name: `vor-modpack_${Date.now()}.zip`, created: Date.now(), size: 48_000_000, label: `Vor „${p.name}“`, mc_version: s.mc_version, loader: s.loader });
        snapshots.set(s.id, list);
      }
      const selected = r.options.selected ?? p.entries.filter((e) => e.include).map((e) => e.path);
      const task = fakeTask("server", `„${p.name}“ wird auf „${s.name}“ aufgespielt`, `server:${s.id}`, 2600, () => {
        manifests.set(s.id, { name: p.name, version_name: p.version_name, format: p.format, mc_version: p.mc_version, loader: p.loader, files: selected, applied_at: Date.now() });
        mockAddonStore.save({ ...mockAddonStore.server(s.id), mc_version: p.mc_version, loader: p.loader, platform: null, install_state: "installed" });
      });
      return { server_id: s.id, task_id: task };
    },
    server_pack_bundle: ({ input }) => {
      const p = packPreview(input as { kind: string }, null);
      return { path: `C:\\Users\\mock\\cache\\server-packs\\${p.name}-server.mrpack`, file_name: `${p.name}-server.mrpack`, size: 52_000_000, sha256: "0".repeat(64), name: p.name, mc_version: p.mc_version, loader: p.loader, files: 5, embedded: 2 };
    },
    server_pack_status: ({ id }) => ({ manifest: manifests.get(String(id)) ?? null, snapshots: snapshots.get(String(id)) ?? [] }),
    server_pack_restore: ({ id, name }) => fakeTask("server", "Modpack-Snapshot wird wiederhergestellt", `server:${id}`, 1600, () => {
      snapshots.set(String(id), (snapshots.get(String(id)) ?? []).filter((x) => x.name !== name));
      manifests.delete(String(id));
    }),
    server_pack_snapshot_delete: ({ id, name }) => {
      snapshots.set(String(id), (snapshots.get(String(id)) ?? []).filter((x) => x.name !== name));
      return null;
    },
  };
}
