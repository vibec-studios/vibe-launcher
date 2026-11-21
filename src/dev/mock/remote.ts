import { emit } from "@tauri-apps/api/event";
import type { Server, ServerStatus } from "@/lib/types";
import { findRoute, ROUTES } from "@/features/remote/routes";
import type { RemoteAgent } from "@/features/remote/types";
import { mockAddServer } from "./servers";
import { setEmitRewrite, type Handlers } from "./util";

const now = Date.now();
const FP = "3f9a1c0e7b2d4a6f8e9c1b3d5f7a9c2e4b6d8f0a1c3e5a7b9d1f3c5e7a9b2c1";

function agent(key: string, extra: Partial<RemoteAgent>): RemoteAgent {
  const via = key.startsWith("v-") ? "vibe" : "direct";
  return {
    key,
    id: key.slice(2),
    name: key,
    via,
    address: null,
    fingerprint: via === "direct" ? FP : null,
    version: "0.1.0",
    os: "linux",
    arch: "x86_64",
    token_id: via === "direct" ? "tok_mock" : null,
    role: "owner",
    online: true,
    last_seen: now,
    added_at: now - 86400_000 * 2,
    conn: null,
    ...extra,
  };
}

const agents = new Map<string, RemoteAgent>([
  ["d-agt_pi", agent("d-agt_pi", { name: "Raspberry Pi", address: "192.168.1.42:25580", arch: "aarch64" })],
  ["v-agt_box", agent("v-agt_box", { name: "Mietserver", os: "linux" })],
]);

const owner = new Map<string, string>();
const conns = new Map<string, string>();

function srv(id: string, name: string, extra: Partial<Server>): Server {
  return {
    id,
    name,
    icon: null,
    accent: null,
    mc_version: "1.21.4",
    loader: { kind: "vanilla", version: null },
    memory_mb: 4096,
    java_path: null,
    jvm_args: null,
    port: 25565,
    auto_start: true,
    auto_restart: true,
    connection: "local",
    eula: true,
    install_state: "installed",
    created_at: now - 86400_000 * 9,
    last_started: now - 3600_000 * 5,
    source_instance: null,
    ...extra,
  };
}

function own(agentKey: string, s: Server, players: string[] = []) {
  owner.set(s.id, agentKey);
  mockAddServer(s, players);
}

own("d-agt_pi", srv("ra-pi-survival", "Pi Survival", { accent: "#7bd88f", loader: { kind: "fabric", version: "0.16.9" } }), ["Lena", "Tom"]);
own("d-agt_pi", srv("ra-pi-lobby", "Paper Lobby", { accent: "#8ab4ff", port: 25566, platform: { kind: "paper", build: null }, auto_start: false }));
own("v-agt_box", srv("ra-box-smp", "Freunde-SMP", { accent: "#ffb547", connection: "relay", mc_version: "1.21.1", loader: { kind: "neoforge", version: "21.1.77" } }), ["Henny"]);

const offline = () => {
  try {
    return localStorage.getItem("vl.mock.remote_offline") === "1";
  } catch {
    return false;
  }
};

function ws(agentKey: string, msg: unknown) {
  void emit("remote://ws", { agent: agentKey, data: JSON.stringify(msg) });
}

function agentOf(serverId: unknown): string | undefined {
  return typeof serverId === "string" ? owner.get(serverId) : undefined;
}

setEmitRewrite((name, payload) => {
  const p = payload as Record<string, unknown>;
  let key: string | undefined;
  if (name === "server://status" || name === "server://log") key = agentOf(p.server_id);
  else if (name === "servers://changed" || name === "servers://removed") key = agentOf(p.id);
  else if (name === "task://update" && typeof p.instance_id === "string" && p.instance_id.startsWith("server:")) key = agentOf(p.instance_id.slice(7));
  if (!key) return null;
  if (conns.get(key) === "online") ws(key, { t: "event", event: name, data: payload });
  return ["mock://swallowed", null];
});

function setState(key: string, state: string, error: string | null = null) {
  conns.set(key, state);
  void emit("remote://state", { agent: key, state, error });
}

const view = (a: RemoteAgent) => ({ ...a, conn: (conns.get(a.key) as RemoteAgent["conn"]) ?? null });
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const err = (kind: string, message: string) => ({ kind, message });

function info(a: RemoteAgent) {
  return { id: a.id, name: a.name, version: a.version, api_version: 1, os: a.os, arch: a.arch, tls: true, fingerprint: a.fingerprint, paired: true, gateway: { enabled: true, connected: a.via === "vibe" } };
}

function addVibeAgent(id: string, name: string) {
  const a = agent(`v-${id}`, { name, id });
  agents.set(a.key, a);
  return a;
}

export function withRemote(base: Handlers): Handlers {
  const local = (list: unknown) => (list as { id?: string; server_id?: string }[]).filter((x) => !owner.has(x.id ?? x.server_id ?? ""));
  const mine = (key: string, list: unknown) => (list as { id?: string; server_id?: string }[]).filter((x) => owner.get(x.id ?? x.server_id ?? "") === key);

  const request = async ({ agent: key, method, path, body, text }: Record<string, unknown>) => {
    const a = agents.get(String(key));
    if (!a) throw err("not_found", "Dieser Remote-Server ist nicht mehr verbunden.");
    if (offline() && a.via === "vibe") throw err("network", "Der Agent ist gerade offline.");
    const m = String(method);
    const p = String(path);
    if (m === "GET" && p === "/servers") {
      const statuses = base.server_statuses({}) as ServerStatus[];
      return mine(a.key, base.servers_list({})).map((s) => ({ ...s, status: statuses.find((x) => x.server_id === s.id) ?? null }));
    }
    if (m === "GET" && p === "/servers/statuses") return mine(a.key, base.server_statuses({}));
    if (m === "GET" && p === "/info") return info(a);
    if (m === "POST" && p === "/servers") {
      const slug = String((body as { name?: string })?.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "server";
      owner.set(slug, a.key);
      const created = base.server_create({ req: body }) as { server: Server; task_id: string };
      if (created.server.id !== slug) {
        owner.delete(slug);
        owner.set(created.server.id, a.key);
        void emit("servers://removed", { id: created.server.id });
        ws(a.key, { t: "event", event: "servers://changed", data: created.server });
      }
      return created;
    }
    if (m === "POST" && p === "/agent/gateway/link") {
      await delay(500);
      addVibeAgent(a.id, a.name);
      return { enabled: true, connected: true, linked: true };
    }
    if (m === "DELETE" && p.startsWith("/tokens/")) return null;
    const hit = findRoute(m, p);
    if (!hit) throw err("not_found", `Mock-Agent: ${m} ${p} unbekannt`);
    const h = base[hit.cmd];
    if (!h) throw err("not_found", `Mock: ${hit.cmd} fehlt`);
    const b = (body ?? {}) as Record<string, unknown>;
    const res = await h({ ...b, ...hit.args, patch: body, text });
    if (ROUTES[hit.cmd]?.task) return { task_id: res };
    if (hit.cmd === "server_get" || hit.cmd === "server_update") {
      const st = (base.server_statuses({}) as ServerStatus[]).find((x) => x.server_id === (res as Server).id);
      return { ...(res as Server), status: st ?? null };
    }
    if (hit.cmd === "server_addresses") return { ...(res as object), public: null, relay: null };
    return res ?? null;
  };

  return {
    ...base,
    servers_list: () => local(base.servers_list({})),
    server_statuses: () => local(base.server_statuses({})),
    remote_agents: () => [...agents.values()].map(view),
    remote_vibe_sync: async () => {
      await delay(200);
      return [...agents.values()].map(view);
    },
    remote_probe: async ({ address }) => {
      await delay(700);
      const addr = String(address).trim();
      if (!addr || addr.includes("fail")) throw err("network", `${addr} ist nicht erreichbar. Läuft der Vibe Server Agent und ist der Port freigegeben?`);
      return {
        address: /:\d+$/.test(addr) ? addr : `${addr}:25580`,
        fingerprint: FP,
        info: { id: "agt_gaming", name: "Gaming-PC", version: "0.1.0", api_version: 1, os: "windows", arch: "x86_64", tls: true, fingerprint: FP, paired: true },
      };
    },
    remote_pair: async ({ address, code }) => {
      await delay(800);
      const c = String(code).replace(/[^a-z0-9]/gi, "").toUpperCase();
      if (c === "AAAAAAAA") throw err("auth", "Der Kopplungscode stimmt nicht oder ist abgelaufen (15 Minuten gültig). Erzeuge auf dem Server mit „vibe-agent pair“ einen neuen.");
      const a = agent("d-agt_gaming", { name: "Gaming-PC", address: String(address), os: "windows" });
      agents.set(a.key, a);
      own(a.key, srv("ra-gaming-modded", "Modded mit Freunden", { accent: "#c792ea", loader: { kind: "fabric", version: "0.16.9" }, auto_start: false }));
      return view(a);
    },
    remote_vibe_link_code: async () => {
      await delay(400);
      setTimeout(() => {
        if (!agents.has("v-agt_cloud")) {
          addVibeAgent("agt_cloud", "Cloud-Server");
          own("v-agt_cloud", srv("ra-cloud-1", "Cloud Survival", { accent: "#56d4dd", connection: "relay" }));
        }
      }, 6000);
      return { code: "VIBE-7KQ2-M9XD", expires_at: Date.now() + 600_000 };
    },
    remote_gateway_link: (args) => request({ ...args, method: "POST", path: "/agent/gateway/link" }),
    remote_agent_rename: ({ agent: key, name }) => {
      const a = agents.get(String(key));
      if (!a) throw err("not_found", "weg");
      const next = { ...a, name: String(name).trim() };
      agents.set(a.key, next);
      return view(next);
    },
    remote_agent_remove: ({ agent: key }) => {
      agents.delete(String(key));
      conns.delete(String(key));
      for (const [sid, k] of owner) if (k === key) owner.delete(sid);
      return null;
    },
    remote_agent_info: ({ agent: key }) => {
      const a = agents.get(String(key));
      if (!a) throw err("not_found", "weg");
      return info(a);
    },
    remote_request: request,
    remote_ws_connect: ({ agent: key }) => {
      const k = String(key);
      setState(k, "connecting");
      setTimeout(() => {
        if (offline() && k.startsWith("v-")) setState(k, "offline", "Der Agent ist gerade offline.");
        else {
          setState(k, "online");
          const a = agents.get(k);
          if (a) ws(k, { t: "hello", agent: info(a), api_version: 1 });
        }
      }, 400);
      return null;
    },
    remote_ws_disconnect: ({ agent: key }) => {
      setState(String(key), "offline");
      return null;
    },
    remote_ws_subscribe: ({ agent: key, topics, on }) => {
      if (!on) return null;
      for (const t of topics as string[]) {
        if (!t.startsWith("log:")) continue;
        const id = t.slice(4);
        const lines = base.server_log({ id }) as unknown[];
        ws(String(key), { t: "event", event: "server://log", data: { server_id: id, lines: lines.slice(-200) } });
      }
      return null;
    },
  };
}
