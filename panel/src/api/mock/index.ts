import type { AccountApi } from "../gateway";
import { EventHub } from "../socket";
import { ApiError, type AgentSocket, type RequestOptions, type Transport } from "../transport";
import type { GatewayAgent, VibeAccount } from "../types";
import { MockAgent, type MockListener } from "./agent";

const agents = new Map<string, MockAgent>();

function agentFor(key: string): MockAgent {
  let a = agents.get(key);
  if (!a) {
    const meta = { home: ["Zu Hause", "windows"], vps: ["Hetzner-VPS", "linux"], laptop: ["Laptop", "windows"] }[key] ?? ["Agent", "linux"];
    a = new MockAgent(key, meta[0], meta[1]);
    agents.set(key, a);
  }
  return a;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

class MockSocket extends EventHub implements AgentSocket, MockListener {
  topics = new Set<string>();

  constructor(private readonly agent: MockAgent) {
    super();
    agent.attach(this);
    setTimeout(() => this.setState("open"), 150);
  }

  deliver(event: string, data: unknown) {
    setTimeout(() => this.emit(event, structuredClone(data)), 20);
  }

  subscribe(topics: string[]) {
    for (const t of topics) {
      this.topics.add(t);
      if (t.startsWith("log:")) {
        const st = this.agent.servers.get(t.slice(4));
        if (st) this.deliver("server://log", { server_id: st.server.id, lines: st.log.slice(-200) });
      }
      if (t === "resources") this.deliver("agent://resources", this.agent.resources());
    }
  }

  unsubscribe(topics: string[]) {
    for (const t of topics) this.topics.delete(t);
  }

  close() {
    this.agent.detach(this);
    this.setState("closed");
  }
}

async function shape<T>(result: unknown, opts: RequestOptions): Promise<T> {
  if (opts.as === "text") return (result instanceof Blob ? await result.text() : String(result ?? "")) as T;
  if (opts.as === "blob") return (result instanceof Blob ? result : new Blob([String(result ?? "")])) as T;
  return (result === undefined ? undefined : structuredClone(result)) as T;
}

export function createMockTransport(key: string, offline = false): Transport {
  const agent = agentFor(key);
  return {
    kind: "mock",
    async request<T>(method: string, path: string, opts: RequestOptions = {}) {
      await wait(90 + Math.random() * 160);
      if (offline) throw new ApiError(503, "agent_offline", "Dieser Agent ist gerade nicht mit Vibe verbunden.");
      if (opts.onProgress) {
        for (let i = 1; i <= 5; i++) {
          await wait(160);
          opts.onProgress(i / 5);
        }
      }
      const raw = opts.raw instanceof Blob && !(opts.raw instanceof File) && opts.contentType?.startsWith("text") ? await opts.raw.text() : opts.raw;
      return shape<T>(await agent.router.handle(method, path, { ...opts, raw }), opts);
    },
    openSocket: () => new MockSocket(agent),
  };
}

const SESSION_KEY = "vibe-panel.mock.session";
const ACCOUNT: VibeAccount = { id: "vu_1", name: "Henny", avatar_url: null };

function readSession(): VibeAccount | null {
  try {
    return sessionStorage.getItem(SESSION_KEY) ? ACCOUNT : null;
  } catch {
    return null;
  }
}

export function consumeMockLoginRedirect() {
  const url = new URL(location.href);
  if (url.searchParams.get("mock_login") !== "microsoft") return;
  try {
    sessionStorage.setItem(SESSION_KEY, "microsoft");
  } catch {
    /* privat */
  }
  url.searchParams.delete("mock_login");
  try {
    const access = url.searchParams.get("mock_access");
    if (access) sessionStorage.setItem("vibe-panel.mock.access", access);
  } catch {
    /* privat */
  }
  url.searchParams.delete("mock_access");
  history.replaceState(null, "", url.pathname + url.search + "#/agents");
}

export function createMockAccount(): AccountApi {
  const now = Date.now();
  const owner = { id: ACCOUNT.id, name: ACCOUNT.name };
  const list: GatewayAgent[] = [
    { id: "home", name: "Zu Hause", online: true, version: "0.1.0", os: "windows", hostname: "HENNY-PC", myRole: "owner", owner, lastSeenAt: now, summary: { servers: 3, running: 1, players: 2 }, disabled: false },
    { id: "vps", name: "Hetzner-VPS", online: true, version: "0.1.0", os: "linux", hostname: "vibe-vps-01", myRole: "owner", owner, lastSeenAt: now, summary: { servers: 1, running: 1, players: 4 }, disabled: false },
    { id: "laptop", name: "Mias Laptop", online: false, version: "0.1.0", os: "windows", hostname: "MIA-LAPTOP", myRole: "admin", owner: { id: "vu_2", name: "Mia" }, lastSeenAt: now - 2 * 86_400_000, summary: { servers: 0, running: 0 }, disabled: false },
  ];
  const polls = new Map<string, number>();
  const guard = async () => {
    await wait(120);
    if (!readSession()) throw new ApiError(401, "unauthorized", "Bitte melde dich an.");
  };
  const find = (id: string) => list.find((x) => x.id === id) ?? (() => { throw new ApiError(404, "not_found", "Agent nicht gefunden."); })();
  return {
    async me() {
      await guard();
      return ACCOUNT;
    },
    async logout() {
      await wait(80);
      sessionStorage.removeItem(SESSION_KEY);
    },
    async deviceStart() {
      await wait(200);
      const deviceToken = `dev_${Date.now()}`;
      polls.set(deviceToken, 0);
      return { code: "K7Q2-M9XD", deviceToken, expiresIn: 900, interval: 2 };
    },
    async devicePoll(deviceToken) {
      await wait(100);
      const n = (polls.get(deviceToken) ?? 0) + 1;
      polls.set(deviceToken, n);
      if (n < 3) return "pending";
      sessionStorage.setItem(SESSION_KEY, "device");
      return "authorized";
    },
    async agents() {
      await guard();
      const access = sessionStorage.getItem("vibe-panel.mock.access");
      if (access === "pending") throw new ApiError(403, "ACCESS_PENDING", "Dein Beta-Zugang wird noch geprüft.");
      return structuredClone(list);
    },
    async claim(code, name) {
      await guard();
      if (code.replace(/[-\s]/g, "").length !== 8) throw new ApiError(404, "pairing_invalid", "Der Code stimmt nicht oder ist abgelaufen.");
      const a: GatewayAgent = { id: `new${list.length}`, name: name?.trim() || "Neuer Server", online: false, version: "0.1.0", os: "linux", hostname: "srv01", myRole: "owner", owner, lastSeenAt: null, summary: null, disabled: false };
      list.push(a);
      setTimeout(() => {
        a.online = true;
        a.lastSeenAt = Date.now();
        a.summary = { servers: 0, running: 0 };
      }, 4000);
      return { ...a };
    },
    async renameAgent(id, name) {
      await guard();
      const a = find(id);
      a.name = name;
      return { ...a };
    },
    async unlinkAgent(id) {
      await guard();
      list.splice(list.indexOf(find(id)), 1);
    },
    microsoftLoginUrl: () => `${location.pathname}?mode=gateway&mock_login=microsoft${new URLSearchParams(location.search).get("mock_access") ? `&mock_access=${new URLSearchParams(location.search).get("mock_access")}` : ""}`,
    agentTransport: (id) => createMockTransport(id, !list.find((x) => x.id === id)?.online),
  };
}
