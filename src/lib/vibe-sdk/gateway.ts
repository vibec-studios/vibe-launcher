// Übernommen aus @vibe-craft/sdk 0.1.0 (vibe-backend/packages/sdk/src/gateway.ts, MIT). Nur Importpfade angepasst.
import type { Activity, GatewayEvents, PresenceStatusSetting, ReadyPayload, ServerMessage } from "./types";
import type { VibeClient } from "./client";
import { Emitter } from "./emitter";

export type GatewayState = "idle" | "connecting" | "ready" | "reconnecting" | "closed";

/** Events des Gateway-Clients: alle Server-Events plus Verbindungsereignisse. */
export type GatewayClientEvents = GatewayEvents & {
  /** Neue Sitzung – Client sollte seinen Zustand (Freunde, Chats …) aus `ready` bzw. per REST neu laden */
  ready: ReadyPayload;
  /** Fortgesetzte Sitzung – verpasste Events wurden nachgeliefert */
  resumed: { sessionId: string; replayed: number };
  state: GatewayState;
  /** Verbindung getrennt (wird automatisch neu aufgebaut, außer bei `fatal`) */
  disconnected: { code: number; reason: string; fatal: boolean };
  error: { code: string; message: string };
};

export interface GatewayOptions {
  /** WebSocket-Implementierung (Standard: globales WebSocket; in Node < 22 z. B. das Paket `ws`) */
  WebSocket?: typeof WebSocket;
  /** Gateway-URL (Standard: baseUrl mit ws(s):// + /ws) */
  url?: string;
  /** Anfangs-Status/-Aktivität beim Verbinden */
  presence?: { status?: PresenceStatusSetting; activity?: Activity | null };
  /** maximale Wartezeit zwischen Reconnect-Versuchen in ms (Standard 30000) */
  maxBackoffMs?: number;
}

/** Close-Codes, nach denen nicht automatisch neu verbunden wird. */
const FATAL = new Set([4010, 4403]);

/**
 * Realtime-Client mit Heartbeat, automatischem Reconnect (exponentielles Backoff mit Jitter),
 * Resume (verpasste Events werden nachgeliefert) und Token-Erneuerung.
 *
 * ```ts
 * const gw = new VibeGateway(client);
 * gw.on("message.created", (m) => …);
 * gw.connect();
 * ```
 */
export class VibeGateway extends Emitter<GatewayClientEvents> {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private seq = 0;
  private heartbeatMs = 30_000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingPong = false;
  private attempts = 0;
  private wanted = false;
  private presence: GatewayOptions["presence"];
  private _state: GatewayState = "idle";

  constructor(
    private client: VibeClient,
    private opts: GatewayOptions = {},
  ) {
    super();
    this.presence = opts.presence;
  }

  get state() {
    return this._state;
  }

  private setState(s: GatewayState) {
    if (this._state === s) return;
    this._state = s;
    this.emit("state", s);
  }

  private url() {
    if (this.opts.url) return this.opts.url;
    return `${this.client.baseUrl.replace(/^http/, "ws")}/ws`;
  }

  /** Verbindung aufbauen (idempotent). */
  connect() {
    this.wanted = true;
    if (this.ws || this.reconnectTimer) return;
    void this.open();
  }

  /** Verbindung beenden, kein automatischer Reconnect. */
  disconnect() {
    this.wanted = false;
    this.clearTimers();
    this.sessionId = null;
    this.seq = 0;
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, "client");
    this.setState("closed");
  }

  /** Status/Aktivität setzen (wird auch nach Reconnects erneut gesendet). */
  setPresence(p: { status?: PresenceStatusSetting; activity?: Activity | null }) {
    this.presence = { ...this.presence, ...p };
    this.send({ op: "presence", d: p });
  }

  /** Tippen-Anzeige in einem Chat (Server drosselt auf 1×/2 s). */
  typing(chatId: string) {
    this.send({ op: "typing", d: { chatId } });
  }

  private send(m: unknown) {
    if (this.ws && this.ws.readyState === 1 && this._state === "ready") this.ws.send(JSON.stringify(m));
  }

  private clearTimers() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
  }

  private async open() {
    this.setState(this.sessionId ? "reconnecting" : "connecting");
    let token: string | null;
    try {
      token = await this.client.accessToken();
    } catch {
      return this.scheduleReconnect();
    }
    if (!this.wanted) return;
    if (!token) {
      this.wanted = false;
      this.setState("closed");
      this.emit("disconnected", { code: 4001, reason: "nicht angemeldet", fatal: true });
      return;
    }
    const WS = this.opts.WebSocket ?? globalThis.WebSocket;
    const ws = new WS(this.url());
    this.ws = ws;

    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      this.handle(ws, msg, token!);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      const fatal = FATAL.has(ev.code) || !this.wanted;
      this.emit("disconnected", { code: ev.code, reason: ev.reason, fatal });
      if (fatal) {
        this.wanted = false;
        this.sessionId = null;
        this.setState("closed");
        return;
      }
      // abgelaufenes Token: vor dem nächsten Versuch erneuern
      if (ev.code === 4001) void this.client.refresh().catch(() => {});
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose folgt */
    };
  }

  private handle(ws: WebSocket, msg: ServerMessage, token: string) {
    switch (msg.op) {
      case "hello": {
        this.heartbeatMs = msg.d.heartbeatInterval;
        const resume = this.sessionId ? { sessionId: this.sessionId, seq: this.seq } : undefined;
        ws.send(JSON.stringify({ op: "identify", d: { token, resume, presence: resume ? undefined : this.presence } }));
        break;
      }
      case "ready":
        this.sessionId = msg.d.sessionId;
        this.seq = 0;
        this.attempts = 0;
        this.startHeartbeat(ws);
        this.setState("ready");
        this.emit("ready", msg.d);
        break;
      case "resumed":
        this.attempts = 0;
        this.startHeartbeat(ws);
        this.setState("ready");
        this.emit("resumed", msg.d);
        if (this.presence) this.send({ op: "presence", d: this.presence });
        break;
      case "invalid_session":
        // Server sendet direkt danach ein neues `ready`
        this.sessionId = null;
        this.seq = 0;
        break;
      case "pong":
        this.awaitingPong = false;
        break;
      case "error":
        this.emit("error", msg.d);
        break;
      case "event":
        if (msg.s > this.seq) this.seq = msg.s;
        this.emit(msg.t, msg.d as never);
        break;
    }
  }

  private startHeartbeat(ws: WebSocket) {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.awaitingPong = false;
    this.heartbeatTimer = setInterval(() => {
      if (this.awaitingPong) {
        // keine Antwort auf den letzten Ping → Verbindung als tot betrachten
        ws.close(4000, "heartbeat");
        return;
      }
      this.awaitingPong = true;
      ws.send(JSON.stringify({ op: "ping", d: { seq: this.seq } }));
    }, this.heartbeatMs);
  }

  private scheduleReconnect() {
    if (!this.wanted || this.reconnectTimer) return;
    this.setState("reconnecting");
    const max = this.opts.maxBackoffMs ?? 30_000;
    const base = Math.min(max, 1000 * 2 ** Math.min(this.attempts, 5));
    const delay = Math.round(base / 2 + Math.random() * (base / 2));
    this.attempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, delay);
  }
}
