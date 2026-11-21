import type { AgentSocket, SocketState } from "./transport";
import type { AgentEventMap, AgentEventName } from "./types";

type Handler = (data: unknown) => void;

export class EventHub {
  private handlers = new Map<string, Set<Handler>>();
  private stateHandlers = new Set<(s: SocketState) => void>();
  state: SocketState = "connecting";

  on<E extends AgentEventName>(event: E, handler: (data: AgentEventMap[E]) => void): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as Handler);
    this.handlers.set(event, set);
    return () => set.delete(handler as Handler);
  }

  onState(handler: (s: SocketState) => void): () => void {
    this.stateHandlers.add(handler);
    handler(this.state);
    return () => this.stateHandlers.delete(handler);
  }

  emit(event: string, data: unknown) {
    this.handlers.get(event)?.forEach((h) => h(data));
  }

  setState(s: SocketState) {
    this.state = s;
    this.stateHandlers.forEach((h) => h(s));
  }
}

export interface WsOptions {
  url: string | (() => string | Promise<string>);
  token?: string | null;
}

export class WsSocket extends EventHub implements AgentSocket {
  private ws: WebSocket | null = null;
  private topics = new Map<string, number>();
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(private readonly opts: WsOptions) {
    super();
    this.connect();
  }

  private async connect() {
    this.setState("connecting");
    let url: string;
    try {
      url = typeof this.opts.url === "function" ? await this.opts.url() : this.opts.url;
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.closed) return;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      if (this.opts.token) ws.send(JSON.stringify({ t: "auth", token: this.opts.token }));
      const topics = [...this.topics.keys()];
      if (topics.length) ws.send(JSON.stringify({ t: "subscribe", topics }));
      this.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: "ping" })), 25_000);
      this.setState("open");
    };
    ws.onmessage = (msg) => {
      try {
        const m = JSON.parse(String(msg.data)) as { t: string; event?: string; data?: unknown };
        if (m.t === "event" && m.event) this.emit(m.event, m.data);
      } catch {
        /* ungültige Nachricht */
      }
    };
    ws.onclose = () => {
      if (this.ping) clearInterval(this.ping);
      this.ws = null;
      this.setState("closed");
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.closed) return;
    const delay = Math.min(15_000, 500 * 2 ** this.retry++);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  subscribe(topics: string[]) {
    const fresh: string[] = [];
    for (const t of topics) {
      const n = this.topics.get(t) ?? 0;
      if (n === 0) fresh.push(t);
      this.topics.set(t, n + 1);
    }
    if (fresh.length) this.send({ t: "subscribe", topics: fresh });
  }

  unsubscribe(topics: string[]) {
    const gone: string[] = [];
    for (const t of topics) {
      const n = (this.topics.get(t) ?? 1) - 1;
      if (n <= 0) {
        this.topics.delete(t);
        gone.push(t);
      } else this.topics.set(t, n);
    }
    if (gone.length) this.send({ t: "unsubscribe", topics: gone });
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
  }
}

export function wsUrl(httpBase: string, path: string): string {
  const u = new URL(httpBase + path, location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}
