// Tauri-Anbindung des SDK: HTTP und WebSocket laufen über Rust (vibe/mod.rs, vibe/ws.rs), Tokens liegen im
// OS-Schlüsselbund. So greift die CSP der Webview nicht, jede `api_url` funktioniert, und der Hauptschalter
// in den Einstellungen sperrt jede Verbindung schon in Rust.
import { listen } from "@tauri-apps/api/event";
import { api } from "@/lib/api";
import type { VibeTokens, VibeWsEvent } from "@/lib/types";
import type { StoredTokens, TokenStore } from "./client";

// ------------------------------------------------------------------ fetch

/** `fetch`-Ersatz für `VibeClient` (nur Text-Bodies; Multipart-Uploads macht Rust direkt). */
export const tauriFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const signal = init?.signal;
  if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
  const body = init?.body;
  if (body != null && typeof body !== "string") throw new TypeError("Nur Text-Bodies werden unterstützt");
  const req = api.vibeHttp({ method: init?.method ?? "GET", url, headers, body: body ?? null });
  const res = await new Promise<Awaited<typeof req>>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Zeitüberschreitung", "AbortError"));
    signal?.addEventListener("abort", onAbort, { once: true });
    req.then(resolve, (e) => reject(new TypeError(typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e)))).finally(() =>
      signal?.removeEventListener("abort", onAbort),
    );
  });
  const h = new Headers();
  if (res.content_type) h.set("content-type", res.content_type);
  if (res.retry_after) h.set("retry-after", res.retry_after);
  const noBody = res.status === 204 || res.status === 304;
  return new Response(noBody ? null : res.body, { status: res.status, headers: h });
};

// ------------------------------------------------------------------ WebSocket

type Listener = (ev: VibeWsEvent) => void;
const sockets = new Map<string, Listener>();
let listening: Promise<unknown> | null = null;
function ensureListener() {
  listening ??= listen<VibeWsEvent>("vibe://ws", (e) => sockets.get(e.payload.id)?.(e.payload));
  return listening;
}

let wsSeq = 0;

/** Minimaler `WebSocket` (Teilmenge, die `VibeGateway` nutzt) über die Rust-Brücke. */
export class TauriWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly url: string;
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private id = `gw-${Date.now().toString(36)}-${(++wsSeq).toString(36)}`;

  constructor(url: string) {
    this.url = url;
    sockets.set(this.id, (ev) => this.handle(ev));
    ensureListener()
      .then(() => api.vibeWsOpen(this.id, url))
      .catch((e) => {
        this.handle({ type: "close", id: this.id, code: 1006, reason: String((e as { message?: string })?.message ?? e) });
      });
  }

  private handle(ev: VibeWsEvent) {
    if (ev.type === "open") {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen?.(new Event("open"));
    } else if (ev.type === "message") {
      if (this.readyState !== 1) return;
      this.onmessage?.(new MessageEvent("message", { data: ev.data }));
    } else {
      if (this.readyState === 3) return;
      this.readyState = 3;
      sockets.delete(this.id);
      if (ev.code === 1006) this.onerror?.(new Event("error"));
      this.onclose?.(new CloseEvent("close", { code: ev.code, reason: ev.reason, wasClean: ev.code !== 1006 }));
    }
  }

  send(data: string) {
    if (this.readyState !== 1) return;
    api.vibeWsSend(this.id, data).catch(() => {});
  }

  close(code?: number, reason?: string) {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    api.vibeWsClose(this.id, code, reason).catch(() => {});
    // Falls Rust nie antwortet (Verbindung hing noch im Aufbau): nach 3 s lokal schließen
    setTimeout(() => this.handle({ type: "close", id: this.id, code: code ?? 1000, reason: reason ?? "" }), 3000);
  }
}

// ------------------------------------------------------------------ Tokens

/** TokenStore über den OS-Schlüsselbund (Rust), mit Cache im Speicher. */
export function keyringTokenStore(): TokenStore {
  let cache: StoredTokens | null | undefined;
  return {
    async get() {
      if (cache === undefined) cache = (await api.vibeTokensGet().catch(() => null)) as StoredTokens | null;
      return cache;
    },
    async set(t) {
      cache = t;
      await api.vibeTokensSet(t as VibeTokens | null);
    },
  };
}
