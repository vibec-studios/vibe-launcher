import type { AddonCompat, AddonSource, AddonTarget, FileEntry, LoaderKind, LoaderVersion, PlatformKind, Server } from "../types";
import type { MockAgent } from "./agent";
import { fail, type MockRouter } from "./router";
import { CATALOG, MC_VERSIONS, type CatalogEntry } from "./seed";
import { makeAddon, type ServerState } from "./state";

export function targetOf(s: Server): AddonTarget {
  if (s.platform) {
    const loaders = s.platform.kind === "folia" ? ["folia"] : s.platform.kind === "purpur" ? ["purpur", "paper", "spigot", "bukkit"] : ["paper", "spigot", "bukkit"];
    return { folder: "plugins", plugins: true, loaders, mc: s.mc_version, hangar: s.platform.kind === "folia" ? null : "PAPER" };
  }
  return { folder: "mods", plugins: false, loaders: s.loader.kind === "vanilla" ? [] : [s.loader.kind], mc: s.mc_version, hangar: null };
}

function compat(s: Server, e: CatalogEntry): AddonCompat {
  const t = targetOf(s);
  if (!t.loaders.length) return { ok: false, reason: "Vanilla-Server können keine Mods oder Plugins laden.", version: null };
  if (e.side === "client") return { ok: false, reason: "Nur für Spieler (Client-Mod) – auf dem Server nutzlos.", version: null };
  if (!e.loaders.some((l) => t.loaders.includes(l))) return { ok: false, reason: t.plugins ? "Kein Plugin für diese Server-Software." : `Gibt es nicht für ${s.loader.kind}.`, version: null };
  if (!e.mc.includes(s.mc_version)) return { ok: false, reason: `Keine Version für Minecraft ${s.mc_version}.`, version: null };
  return { ok: true, reason: null, version: `${e.title.replace(/\s/g, "")}-${s.mc_version}` };
}

function normPath(p: string | undefined): string {
  const s = (p ?? "").replace(/^\/+|\/+$/g, "");
  if (s.split("/").some((x) => x === "..") || s.includes("\\")) fail(403, "path_denied", "Dieser Pfad ist nicht erlaubt.");
  return s;
}

function listDir(st: ServerState, dir: string): FileEntry[] {
  const prefix = dir ? `${dir}/` : "";
  const out = new Map<string, FileEntry>();
  for (const d of st.dirs) {
    if (!d.startsWith(prefix) || d === dir) continue;
    const name = d.slice(prefix.length).split("/")[0];
    if (!out.has(name)) out.set(name, { name, dir: true, size: 0, modified: Date.now() - 3_600_000 });
  }
  for (const [path, f] of st.files) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (rest.includes("/")) {
      const name = rest.split("/")[0];
      if (!out.has(name)) out.set(name, { name, dir: true, size: 0, modified: f.modified });
      continue;
    }
    out.set(rest, { name: rest, dir: false, size: typeof f.data === "string" ? new Blob([f.data]).size : f.data.size, modified: f.modified });
  }
  return [...out.values()].sort((x, y) => Number(y.dir) - Number(x.dir) || x.name.localeCompare(y.name));
}

function addDirs(st: ServerState, path: string) {
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) st.dirs.add(parts.slice(0, i).join("/"));
}

export function registerContentRoutes(r: MockRouter, a: MockAgent) {
  r.on("GET", "/servers/:id/worlds", ({ params }) => [{ name: a.get(params.id).props.get("level-name") ?? "world", size: 196_000_000, active: true }]);
  r.on("GET", "/servers/:id/backups", ({ params }) => a.get(params.id).backups);
  r.on("POST", "/servers/:id/backups", ({ params }) => {
    const st = a.get(params.id);
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const name = `world-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.zip`;
    a.addAudit("Henny", "backup.create", st.server.name);
    return { task_id: a.runTask(`Backup von ${st.server.name}`, "server", st.server.id, () => st.backups.unshift({ name, world: "world", size: 188_000_000, created: Date.now() }), 2400) };
  });
  r.on("DELETE", "/servers/:id/backups/:name", ({ params }) => {
    const st = a.get(params.id);
    st.backups = st.backups.filter((b) => b.name !== params.name);
  });
  r.on("POST", "/servers/:id/backups/:name/restore", ({ params }) => {
    const st = a.get(params.id);
    if (st.status.state !== "stopped" && st.status.state !== "crashed") fail(409, "server_running", "Bitte den Server zuerst stoppen.");
    return { task_id: a.runTask(`Backup ${params.name} wird wiederhergestellt`, "server", st.server.id) };
  });
  r.on("GET", "/servers/:id/backups/:name/download", ({ params }) => new Blob([`Mock-Backup ${params.name}`], { type: "application/zip" }));

  r.on("GET", "/servers/:id/files", ({ params, query }) => {
    const st = a.get(params.id);
    const path = normPath(query.path);
    if (path && !st.dirs.has(path)) fail(404, "not_found", "Ordner nicht gefunden.");
    return { path, entries: listDir(st, path) };
  });
  r.on("GET", "/servers/:id/files/content", ({ params, query }) => {
    const st = a.get(params.id);
    const f = st.files.get(normPath(query.path));
    if (!f) fail(404, "not_found", "Datei nicht gefunden.");
    return typeof f.data === "string" ? new Blob([f.data], { type: "text/plain" }) : f.data;
  });
  r.on("PUT", "/servers/:id/files/content", ({ params, query, raw }) => {
    const st = a.get(params.id);
    const path = normPath(query.path);
    if (path === "vibe-server.json") fail(403, "path_denied", "Diese Datei ist geschützt.");
    if (path === "server.properties") fail(403, "path_denied", "Bitte server.properties über „Einstellungen“ ändern.");
    addDirs(st, path);
    st.files.set(path, { data: raw ?? "", modified: Date.now() });
    a.addAudit("Henny", "file.write", path);
  });
  r.on("POST", "/servers/:id/files/mkdir", ({ params, body }) => {
    const st = a.get(params.id);
    const path = normPath((body as { path: string }).path);
    addDirs(st, `${path}/x`);
  });
  r.on("POST", "/servers/:id/files/rename", ({ params, body }) => {
    const st = a.get(params.id);
    const { from, to } = body as { from: string; to: string };
    const f = normPath(from);
    const t = normPath(to);
    if (st.files.has(f)) {
      st.files.set(t, st.files.get(f)!);
      st.files.delete(f);
    } else if (st.dirs.has(f)) {
      for (const d of [...st.dirs]) if (d === f || d.startsWith(`${f}/`)) (st.dirs.delete(d), st.dirs.add(t + d.slice(f.length)));
      for (const [p, v] of [...st.files]) if (p.startsWith(`${f}/`)) (st.files.delete(p), st.files.set(t + p.slice(f.length), v));
    } else fail(404, "not_found", "Nicht gefunden.");
  });
  r.on("DELETE", "/servers/:id/files", ({ params, query }) => {
    const st = a.get(params.id);
    const p = normPath(query.path);
    if (!p) fail(403, "path_denied", "Der Server-Ordner selbst kann nicht gelöscht werden.");
    st.files.delete(p);
    for (const d of [...st.dirs]) if (d === p || d.startsWith(`${p}/`)) st.dirs.delete(d);
    for (const k of [...st.files.keys()]) if (k.startsWith(`${p}/`)) st.files.delete(k);
  });

  r.on("GET", "/servers/:id/addons", ({ params }) => {
    const st = a.get(params.id);
    if (!st.server.platform && st.server.loader.kind === "vanilla") fail(400, "invalid", "Ungültige Eingabe: Vanilla-Server haben keine Plugins oder Mods.");
    return { target: targetOf(st.server), items: st.addons };
  });
  r.on("GET", "/servers/:id/addons/search", async ({ params, query }) => {
    const st = a.get(params.id);
    const q = (query.query ?? "").toLowerCase();
    const source = query.source as AddonSource;
    const t = targetOf(st.server);
    const hits = CATALOG.filter((e) => (source === "hangar" ? e.source === "hangar" : e.source === "modrinth"))
      .filter((e) => (t.plugins ? e.kind === "plugin" : true))
      .filter((e) => !q || e.title.toLowerCase().includes(q) || e.description.toLowerCase().includes(q))
      .map((e) => ({
        source: e.source,
        id: e.id,
        slug: e.id.toLowerCase(),
        title: e.title,
        description: e.description,
        author: e.author,
        icon_url: null,
        downloads: e.downloads,
        updated: new Date(Date.now() - 9 * 86_400_000).toISOString(),
        page_url: e.source === "hangar" ? `https://hangar.papermc.io/${e.author}/${e.id}` : `https://modrinth.com/project/${e.id}`,
        compat: compat(st.server, e),
      }));
    return { hits, total: hits.length, offset: 0 };
  });
  r.on("POST", "/servers/:id/addons", ({ params, body }) => {
    const st = a.get(params.id);
    const { project } = body as { source: AddonSource; project: string };
    const e = CATALOG.find((x) => x.id === project);
    if (!e) fail(404, "not_found", "Projekt nicht gefunden.");
    const c = compat(st.server, e);
    if (!c.ok) fail(400, "invalid", c.reason ?? "Nicht kompatibel.");
    const t = targetOf(st.server);
    const files = [`${e.title.replace(/\s/g, "")}-${st.server.mc_version}.jar`];
    if (e.loaders.includes("fabric") && st.server.loader.kind === "fabric" && e.id !== "fabric-api" && !st.addons.some((x) => x.project_id === "fabric-api")) files.push(`fabric-api-0.110.0+${st.server.mc_version}.jar`);
    for (const f of files) {
      if (st.addons.some((x) => x.file_name === f)) continue;
      const add = makeAddon(f, f.startsWith("fabric-api") ? "Fabric API" : e.title, st.server.mc_version, f.startsWith("fabric-api") ? "fabric-api" : e.id, e.source, e.description);
      st.addons.push(add);
      st.files.set(`${t.folder}/${f}`, { data: new Blob([new Uint8Array(add.size)]), modified: Date.now() });
    }
    a.addAudit("Henny", "addon.install", e.title);
    return files;
  });
  r.on("POST", "/servers/:id/addons/upload", ({ params, query, raw }) => {
    const st = a.get(params.id);
    const name = query.filename ?? "upload.jar";
    if (!name.endsWith(".jar")) fail(400, "invalid", "Nur .jar-Dateien.");
    const add = makeAddon(name, name.replace(/\.jar$/, ""), "?", "", "modrinth", "Selbst hochgeladen");
    add.source = null;
    add.project_id = null;
    add.page_url = null;
    add.size = raw instanceof Blob ? raw.size : add.size;
    st.addons.push(add);
    return name;
  });
  r.on("PATCH", "/servers/:id/addons/:file", ({ params, body }) => {
    const st = a.get(params.id);
    const ad = st.addons.find((x) => x.file_name === params.file);
    if (!ad) fail(404, "not_found", "Datei nicht gefunden.");
    const enabled = (body as { enabled: boolean }).enabled;
    ad.enabled = enabled;
    ad.file_name = enabled ? ad.file_name.replace(/\.disabled$/, "") : ad.file_name.endsWith(".disabled") ? ad.file_name : `${ad.file_name}.disabled`;
    return ad.file_name;
  });
  r.on("DELETE", "/servers/:id/addons/:file", ({ params }) => {
    const st = a.get(params.id);
    st.addons = st.addons.filter((x) => x.file_name !== params.file);
  });

  r.on("POST", "/servers/import", ({ query, raw }) => {
    const format = query.format;
    if (!["mrpack", "zip", "vlpack"].includes(format)) fail(400, "invalid", "Unbekanntes Format.");
    if (query.server) {
      const st = a.get(query.server);
      if (st.status.state !== "stopped" && st.status.state !== "crashed") fail(409, "server_running", "Bitte den Server zuerst stoppen.");
      return { server: st.server, task_id: a.runTask(`Modpack wird auf ${st.server.name} übertragen`, "server", st.server.id, undefined, 4000) };
    }
    const id = a.nextId("srv");
    const name = query.name?.trim() || (raw instanceof File ? raw.name.replace(/\.(mrpack|zip)$/i, "") : "Modpack-Server");
    const server: Server = { id, name, icon: null, accent: null, mc_version: "1.21.1", loader: { kind: "neoforge", version: "21.1.77" }, platform: null, memory_mb: 6144, java_path: null, jvm_args: null, port: 25565 + a.servers.size, auto_start: false, auto_restart: true, connection: "local", eula: false, install_state: "not_installed", created_at: Date.now(), last_started: null, source_instance: null, relay_slot: a.servers.size + 1 };
    const st = a.createServerFrom(server, `${name} · Modpack`);
    st.addons = ["create-6.0.4.jar", "jei-19.21.jar", "ferritecore-7.1.1.jar"].map((f) => makeAddon(f, f.split("-")[0], "1.21.1", f.split("-")[0], "modrinth", "Aus dem Modpack"));
    const task_id = a.runTask(`Modpack „${name}“ wird eingerichtet`, "server", id, () => ((st.server.install_state = "installed"), a.changed(st)), 4500);
    a.changed(st);
    return { server, task_id };
  });

  r.on("GET", "/catalog/minecraft", () => MC_VERSIONS.map((id, i) => ({ id, type: "release", release_time: new Date(Date.now() - (i + 1) * 60 * 86_400_000).toISOString() })));
  r.on("GET", "/catalog/loaders/:kind", ({ params, query }) => {
    const k = params.kind as LoaderKind;
    if (!["vanilla", "fabric", "quilt", "forge", "neoforge"].includes(k)) fail(400, "invalid", `Unbekannter Loader: ${k}`);
    if (!query.mc?.trim()) fail(400, "invalid", "Parameter mc fehlt.");
    const v = (version: string, stable = true): LoaderVersion => ({ version, stable });
    if (k === "fabric") return [v("0.16.10"), v("0.16.9"), v("0.15.11")];
    if (k === "quilt") return [v("0.27.2-beta.1", false), v("0.27.1"), v("0.26.4")];
    if (k === "neoforge") return [v("21.1.80-beta", false), v("21.1.77"), v("21.1.65")];
    if (k === "forge") return [v("52.0.40"), v("51.0.33")];
    return [];
  });
  r.on("GET", "/catalog/platforms/:kind", ({ params }) => {
    const k = params.kind as PlatformKind;
    const list = k === "folia" ? ["1.21.4", "1.21.1", "1.20.6"] : MC_VERSIONS.slice(0, 8);
    return list.map((id, i) => ({ id, release: true, supported: i < 4, java_min: 21 }));
  });
}
