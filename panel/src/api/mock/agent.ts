import type { AgentEventMap, AgentEventName, AgentInfo, AgentSettings, AuditEntry, GatewayStatus, Permission, Resources, Server, TaskInfo, User } from "../types";
import { MockRouter, fail } from "./router";
import { CHAT, SEEDS, makeServer } from "./seed";
import { logLine, newServerState, tunnelFor, type ServerState } from "./state";
import { registerAgentRoutes } from "./routes-agent";
import { registerServerRoutes } from "./routes-server";
import { registerContentRoutes } from "./routes-content";

export interface MockListener {
  topics: Set<string>;
  deliver(event: string, data: unknown): void;
}

export const ALL_PERMISSIONS: Permission[] = ["servers.read", "servers.control", "servers.manage", "files.read", "files.write", "agent.admin"];

export class MockAgent {
  readonly router = new MockRouter();
  readonly servers = new Map<string, ServerState>();
  readonly listeners = new Set<MockListener>();
  readonly tasks = new Map<string, TaskInfo>();
  readonly audit: AuditEntry[] = [];
  users: User[];
  info: AgentInfo;
  settings: AgentSettings;
  gatewayState: GatewayStatus;
  private timer: ReturnType<typeof setInterval> | null = null;
  private idSeq = 0;

  constructor(readonly key: string, name: string, os: string) {
    const now = Date.now();
    this.info = { id: `agt_${key}`, name, version: "0.1.0", api_version: 1, min_api_version: 1, os, arch: "x86_64", tls: true, fingerprint: "3f9a6c0e1b7d2a45c8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4c1", paired: true, gateway: { enabled: true, connected: true }, started_at: now - 5 * 86_400_000 };
    this.settings = { name, port: 25580, tls: true, gateway_enabled: true, relay: { configured: true, source: "gateway", name: "Henny" } };
    this.gatewayState = { enabled: true, connected: true, linked: true, vibe_user: { id: "vu_1", name: "Henny" }, last_error: null };
    this.users = [
      { id: "usr_owner", name: "Henny", role: "owner", servers: ["*"], created_at: now - 30 * 86_400_000, vibe_user_id: "vu_1" },
      { id: "usr_mia", name: "Mia", role: "admin", servers: ["*"], created_at: now - 12 * 86_400_000, vibe_user_id: "vu_2" },
      { id: "usr_tom", name: "Tom", role: "viewer", servers: ["*"], created_at: now - 3 * 86_400_000, vibe_user_id: null },
    ];
    (SEEDS[key] ?? []).forEach((seed, i) => {
      const id = `srv_${key}_${i + 1}`;
      const server = makeServer(id, seed, i);
      const st = newServerState(server, seed.motd, seed.players ?? [], seed.running);
      this.servers.set(id, st);
      if (seed.running) this.bootInstant(st, seed.players ?? []);
    });
    this.addAudit("Henny", "server.start", "Survival mit Freunden", "direct", now - 3 * 3_600_000);
    this.addAudit("Mia", "server.properties", "Survival mit Freunden", "gateway", now - 2 * 3_600_000);
    this.addAudit("Henny", "addon.install", "LuckPerms", "gateway", now - 50 * 60_000);
    registerAgentRoutes(this.router, this);
    registerServerRoutes(this.router, this);
    registerContentRoutes(this.router, this);
  }

  nextId(prefix: string) {
    this.idSeq += 1;
    return `${prefix}_${Date.now().toString(36)}${this.idSeq}`;
  }

  get(id: string): ServerState {
    const st = this.servers.get(id);
    if (!st) fail(404, "not_found", "Diesen Server gibt es nicht (mehr).");
    return st;
  }

  view(st: ServerState) {
    return { ...st.server, status: { ...st.status } };
  }

  addAudit(user: string, action: string, target: string | null, via: AuditEntry["via"] = "direct", at = Date.now()) {
    this.audit.unshift({ at, user_id: null, user_name: user, ip: via === "direct" ? "192.168.1.42" : null, via, action, target, ok: true, detail: null });
  }

  emit<E extends AgentEventName>(event: E, data: AgentEventMap[E], topic: string) {
    for (const l of this.listeners) if (l.topics.has(topic)) l.deliver(event, data);
  }

  attach(l: MockListener) {
    this.listeners.add(l);
    if (!this.timer) this.timer = setInterval(() => this.tick(), 2000);
  }

  detach(l: MockListener) {
    this.listeners.delete(l);
    if (this.listeners.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  log(st: ServerState, text: string, level: "info" | "warn" | "error" | "launcher" = "info", thread?: string) {
    const line = logLine(st, text, level, thread);
    this.emit("server://log", { server_id: st.server.id, lines: [line] }, `log:${st.server.id}`);
  }

  pushStatus(st: ServerState) {
    st.status.tunnel = tunnelFor(st.server, st.status.state === "running");
    this.emit("server://status", { ...st.status }, "servers");
  }

  changed(st: ServerState) {
    this.emit("servers://changed", { ...st.server }, "servers");
  }

  private bootInstant(st: ServerState, players: string[]) {
    st.status = { ...st.status, state: "running", pid: 4000 + this.servers.size, started_at: Date.now() - 3 * 3_600_000, players: [...players], max_players: 20 };
    st.status.tunnel = tunnelFor(st.server, true);
    st.cpu = 18;
    const lines = [
      `Starting minecraft server version ${st.server.mc_version}`,
      "Loading properties",
      "Default game type: SURVIVAL",
      `Starting Minecraft server on *:${st.server.port}`,
      'Preparing level "world"',
      "Preparing spawn area: 100%",
      "Done (4.218s)! For help, type \"help\"",
      ...players.map((p) => `${p} joined the game`),
    ];
    for (const l of lines) logLine(st, l);
  }

  start(st: ServerState) {
    if (st.status.state === "running" || st.status.state === "starting") fail(409, "conflict", "Der Server läuft bereits.");
    if (!st.server.eula) fail(400, "invalid", "Bitte zuerst die Minecraft-EULA akzeptieren.");
    if (st.server.install_state !== "installed") fail(409, "conflict", "Der Server wird noch installiert.");
    st.status = { ...st.status, state: "starting", pid: 5000 + Math.floor(Math.random() * 999), started_at: Date.now(), players: [], exit_code: null };
    st.server.last_started = Date.now();
    this.pushStatus(st);
    this.log(st, "Server wird gestartet …", "launcher", "vibe-agent");
    const steps = [
      `Starting minecraft server version ${st.server.mc_version}`,
      "Loading properties",
      `Starting Minecraft server on *:${st.server.port}`,
      'Preparing level "world"',
      "Preparing spawn area: 37%",
      "Preparing spawn area: 81%",
    ];
    steps.forEach((s, i) => setTimeout(() => st.status.state === "starting" && this.log(st, s), 300 + i * 350));
    setTimeout(() => {
      if (st.status.state !== "starting") return;
      this.log(st, 'Done (2.941s)! For help, type "help"');
      st.status.state = "running";
      st.cpu = 22;
      this.pushStatus(st);
    }, 2800);
  }

  stop(st: ServerState, kill = false) {
    if (st.status.state === "stopped" || st.status.state === "crashed") fail(409, "server_not_running", "Der Server läuft nicht.");
    st.status.state = "stopping";
    this.pushStatus(st);
    this.log(st, kill ? "Server wird hart beendet." : "Stopping the server", kill ? "warn" : "info");
    setTimeout(
      () => {
        if (!kill) this.log(st, "Saving worlds");
        st.status = { ...st.status, state: "stopped", pid: null, started_at: null, players: [], exit_code: kill ? 137 : 0 };
        st.players.online = [];
        st.cpu = 0;
        this.pushStatus(st);
      },
      kill ? 200 : 1500,
    );
  }

  runTask(title: string, kind: string, serverId: string | null, done?: () => void, ms = 3200): string {
    const id = this.nextId("task");
    const task: TaskInfo = { id, kind, title, instance_id: serverId ? `server:${serverId}` : null, progress: 0, message: null, status: "running", error: null, started_at: Date.now() };
    this.tasks.set(id, task);
    this.emit("task://update", { ...task }, "tasks");
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      setTimeout(() => {
        task.progress = i / steps;
        task.message = i < steps ? `${Math.round((i / steps) * 100)} %` : null;
        if (i === steps) {
          task.status = "done";
          done?.();
        }
        this.emit("task://update", { ...task }, "tasks");
      }, (ms / steps) * i);
    }
    return id;
  }

  resources(): Resources {
    const servers = [...this.servers.values()].map((st) => ({
      id: st.server.id,
      pid: st.status.pid,
      cpu_percent: st.status.state === "running" ? st.cpu : 0,
      mem_bytes: st.status.state === "running" ? Math.round((st.server.memory_mb ?? 2048) * 0.72 * 1_048_576) : 0,
    }));
    const used = servers.reduce((a, s) => a + s.mem_bytes, 0) + 1_900_000_000;
    return {
      cpu_percent: Math.min(100, 6 + servers.reduce((a, s) => a + s.cpu_percent, 0) / 2),
      cpu_cores: this.key === "vps" ? 8 : 12,
      mem_total: (this.key === "vps" ? 32 : 16) * 1_073_741_824,
      mem_used: used,
      disk_total: 512 * 1_073_741_824,
      disk_free: 318 * 1_073_741_824,
      uptime_s: Math.round((Date.now() - this.info.started_at) / 1000),
      servers,
    };
  }

  private tick() {
    for (const st of this.servers.values()) {
      if (st.status.state !== "running") continue;
      st.cpu = Math.max(4, Math.min(85, st.cpu + (Math.random() - 0.5) * 10));
      if (Math.random() < 0.35 && st.status.players.length > 0) {
        const line = CHAT[Math.floor(Math.random() * CHAT.length)];
        this.log(st, line, line.startsWith("Can't keep up") ? "warn" : "info");
      }
    }
    this.emit("agent://resources", this.resources(), "resources");
  }

  createServerFrom(server: Server, motd: string) {
    const st = newServerState(server, motd, [], false);
    this.servers.set(server.id, st);
    return st;
  }
}
