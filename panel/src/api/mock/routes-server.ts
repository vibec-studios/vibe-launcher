import type { ServerCreate, ServerPatch, ServerPlayerList, Server } from "../types";
import type { MockAgent } from "./agent";
import { fail, type MockRouter } from "./router";
import { parseProperties, propertiesText, type ServerState } from "./state";

function syncProps(st: ServerState) {
  st.files.set("server.properties", { data: propertiesText(st.props), modified: Date.now() });
  st.players.whitelist_enabled = st.props.get("white-list") === "true";
}

function handleCommand(a: MockAgent, st: ServerState, cmd: string) {
  const c = cmd.replace(/^\//, "").trim();
  const [head, ...rest] = c.split(/\s+/);
  a.log(st, `> ${c}`, "launcher", "Konsole");
  switch (head) {
    case "list":
      a.log(st, `There are ${st.status.players.length} of a max of ${st.status.max_players ?? 20} players online: ${st.status.players.join(", ")}`);
      break;
    case "say":
      a.log(st, `[Server] ${rest.join(" ")}`);
      break;
    case "help":
      a.log(st, "/list, /say <Text>, /op <Name>, /whitelist add <Name>, /time set day, /weather clear, /stop");
      break;
    case "op":
      if (rest[0]) {
        if (!st.players.ops.some((p) => p.name === rest[0])) st.players.ops.push({ name: rest[0], uuid: null, level: 4, reason: null });
        a.log(st, `Made ${rest[0]} a server operator`);
      }
      break;
    case "whitelist":
      if (rest[0] === "add" && rest[1]) {
        st.players.whitelist.push({ name: rest[1], uuid: null, level: null, reason: null });
        a.log(st, `Added ${rest[1]} to the whitelist`);
      }
      break;
    case "time":
      a.log(st, "Set the time to 1000");
      break;
    case "weather":
      a.log(st, "Set the weather to clear");
      break;
    case "stop":
      a.stop(st);
      break;
    default:
      a.log(st, `Unknown or incomplete command, see below for error: ${c}<--[HERE]`, "error");
  }
}

export function registerServerRoutes(r: MockRouter, a: MockAgent) {
  r.on("GET", "/servers", () => [...a.servers.values()].map((st) => a.view(st)));
  r.on("GET", "/servers/statuses", () => [...a.servers.values()].map((st) => st.status));
  r.on("POST", "/servers", ({ body }) => {
    const req = body as ServerCreate;
    if (!req.name?.trim()) fail(400, "invalid", "Bitte gib dem Server einen Namen.");
    const id = a.nextId("srv");
    const port = req.port ?? 25565 + a.servers.size;
    if ([...a.servers.values()].some((s) => s.server.port === port)) fail(409, "conflict", `Port ${port} ist schon belegt.`);
    const server: Server = {
      id,
      name: req.name.trim(),
      icon: null,
      accent: null,
      mc_version: req.mc_version,
      loader: req.loader,
      platform: req.platform ?? null,
      memory_mb: req.memory_mb ?? 2048,
      java_path: null,
      jvm_args: null,
      port,
      auto_start: false,
      auto_restart: true,
      connection: "relay",
      eula: false,
      install_state: "installing",
      created_at: Date.now(),
      last_started: null,
      source_instance: null,
      relay_slot: null,
    };
    const st = a.createServerFrom(server, `${server.name} · Vibe`);
    const task_id = a.runTask(`${server.name} wird installiert`, "server_install", id, () => {
      st.server.install_state = "installed";
      a.changed(st);
    });
    a.addAudit("Henny", "server.create", server.name);
    a.changed(st);
    return { server, task_id };
  });
  r.on("GET", "/servers/:id", ({ params }) => a.view(a.get(params.id)));
  r.on("PATCH", "/servers/:id", ({ params, body }) => {
    const st = a.get(params.id);
    const patch = body as ServerPatch;
    if (patch.port !== undefined && [...a.servers.values()].some((s) => s !== st && s.server.port === patch.port)) fail(409, "conflict", `Port ${patch.port} ist schon belegt.`);
    Object.assign(st.server, patch);
    if (patch.port !== undefined) {
      st.props.set("server-port", String(patch.port));
      syncProps(st);
    }
    if (patch.connection !== undefined) a.pushStatus(st);
    a.changed(st);
    return st.server;
  });
  r.on("DELETE", "/servers/:id", ({ params }) => {
    const st = a.get(params.id);
    if (st.status.state !== "stopped" && st.status.state !== "crashed") fail(409, "server_running", "Bitte den Server zuerst stoppen.");
    a.servers.delete(params.id);
    a.emit("servers://removed", { id: params.id }, "servers");
    a.addAudit("Henny", "server.delete", st.server.name);
  });
  r.on("POST", "/servers/:id/install", ({ params }) => {
    const st = a.get(params.id);
    st.server.install_state = "installing";
    a.changed(st);
    return { task_id: a.runTask(`${st.server.name} wird neu installiert`, "server_install", st.server.id, () => ((st.server.install_state = "installed"), a.changed(st))) };
  });
  r.on("POST", "/servers/:id/eula", ({ params }) => {
    const st = a.get(params.id);
    st.server.eula = true;
    st.files.set("eula.txt", { data: "eula=true\n", modified: Date.now() });
    a.changed(st);
    return st.server;
  });
  r.on("POST", "/servers/:id/start", ({ params }) => {
    a.start(a.get(params.id));
    a.addAudit("Henny", "server.start", a.get(params.id).server.name);
  });
  r.on("POST", "/servers/:id/stop", ({ params }) => a.stop(a.get(params.id)));
  r.on("POST", "/servers/:id/kill", ({ params }) => a.stop(a.get(params.id), true));
  r.on("POST", "/servers/:id/restart", ({ params }) => {
    const st = a.get(params.id);
    a.stop(st);
    setTimeout(() => a.start(st), 1700);
  });
  r.on("POST", "/servers/:id/command", ({ params, body }) => {
    const st = a.get(params.id);
    if (st.status.state !== "running") fail(409, "server_not_running", "Der Server läuft nicht.");
    handleCommand(a, st, String((body as { command?: string }).command ?? ""));
  });
  r.on("GET", "/servers/:id/status", ({ params }) => a.get(params.id).status);
  r.on("GET", "/servers/:id/log", ({ params }) => a.get(params.id).log);
  r.on("GET", "/servers/:id/addresses", ({ params }) => {
    const st = a.get(params.id);
    const t = st.status.tunnel;
    return { local: `localhost:${st.server.port}`, lan: [`192.168.1.20:${st.server.port}`], public: a.key === "vps" ? `203.0.113.17:${st.server.port}` : null, relay: t?.kind === "relay" ? t.address : null };
  });

  r.on("GET", "/servers/:id/properties", ({ params }) => [...a.get(params.id).props]);
  r.on("PUT", "/servers/:id/properties", ({ params, body }) => {
    const st = a.get(params.id);
    for (const [k, v] of Object.entries((body as { values: Record<string, string> }).values)) st.props.set(k, v);
    syncProps(st);
    a.addAudit("Henny", "server.properties", st.server.name);
    return [...st.props];
  });
  r.on("GET", "/servers/:id/properties/raw", ({ params }) => propertiesText(a.get(params.id).props));
  r.on("PUT", "/servers/:id/properties/raw", ({ params, raw }) => {
    const st = a.get(params.id);
    st.props = parseProperties(String(raw ?? ""));
    syncProps(st);
  });

  r.on("GET", "/servers/:id/players", ({ params }) => {
    const st = a.get(params.id);
    return { ...st.players, online: [...st.status.players] };
  });
  r.on("POST", "/servers/:id/players/:list", ({ params, body }) => {
    const st = a.get(params.id);
    const list = params.list as ServerPlayerList;
    const b = body as { action: "add" | "remove"; name: string; reason?: string };
    const name = b.name.trim();
    if (!/^[A-Za-z0-9_.:]{2,39}$/.test(name)) fail(400, "invalid", "Dieser Name ist ungültig.");
    const arr = st.players[list];
    if (b.action === "add") {
      if (arr.some((p) => p.name.toLowerCase() === name.toLowerCase())) fail(409, "conflict", `${name} ist schon auf der Liste.`);
      arr.push({ name, uuid: null, level: list === "ops" ? 4 : null, reason: b.reason ?? null });
      if (list === "banned") st.status.players = st.status.players.filter((p) => p !== name);
    } else st.players[list] = arr.filter((p) => p.name !== name);
    a.addAudit("Henny", `players.${list}.${b.action}`, name);
    return { ...st.players, online: [...st.status.players] };
  });
  r.on("PUT", "/servers/:id/whitelist", ({ params, body }) => {
    const st = a.get(params.id);
    st.props.set("white-list", String((body as { enabled: boolean }).enabled));
    syncProps(st);
    return { ...st.players, online: [...st.status.players] };
  });

  r.on("GET", "/servers/:id/tunnel", ({ params }) => a.get(params.id).status.tunnel);
  r.on("POST", "/servers/:id/tunnel/reset", ({ params }) => {
    const st = a.get(params.id);
    if (st.status.tunnel) {
      st.status.tunnel = { ...st.status.tunnel, state: "connecting" };
      a.emit("server://status", { ...st.status }, "servers");
      setTimeout(() => a.pushStatus(st), 1200);
    }
  });
}
