import type { ApiErrorBody, TokenPair } from "../types";
import { VibeError } from "./errors";
import { MemoryTokenStore, type StoredTokens, type TokenStore, type VibeClientOptions } from "./tokens";
import { enc, type Query, type RequestOptions } from "./http";

export class VibeClientCore {
  readonly baseUrl: string;
  private store: TokenStore;
  protected fetchImpl: typeof fetch;
  private refreshing: Promise<StoredTokens | null> | null = null;

  constructor(private opts: VibeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.store = opts.tokens ?? new MemoryTokenStore();
    this.fetchImpl = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  }

  // ---------------- Token-Verwaltung ----------------

  async getTokens(): Promise<StoredTokens | null> {
    return this.store.get();
  }

  async setTokens(t: StoredTokens | null) {
    await this.store.set(t);
    this.opts.onTokens?.(t);
  }

  async isLoggedIn() {
    return !!(await this.store.get());
  }

  protected toStored(p: TokenPair): StoredTokens {
    return { accessToken: p.accessToken, refreshToken: p.refreshToken, expiresAt: Date.now() + p.expiresIn * 1000, sessionId: p.sessionId };
  }

  /** Gültiges Access-Token (erneuert bei Bedarf). null = nicht angemeldet. */
  async accessToken(): Promise<string | null> {
    const t = await this.store.get();
    if (!t) return null;
    if (t.expiresAt - Date.now() > 30_000) return t.accessToken;
    return (await this.refresh())?.accessToken ?? null;
  }

  /** Erneuert die Tokens (Single-Flight). */
  refresh(): Promise<StoredTokens | null> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const t = await this.store.get();
      if (!t) return null;
      try {
        const pair = await this.request<TokenPair>("POST", "/api/v1/auth/refresh", { body: { refreshToken: t.refreshToken }, auth: false });
        const next = this.toStored(pair);
        await this.setTokens(next);
        return next;
      } catch (e) {
        if (e instanceof VibeError && (e.status === 401 || e.status === 403)) {
          await this.setTokens(null);
          this.opts.onAuthLost?.({ code: e.code, message: e.message });
          return null;
        }
        throw e;
      }
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  // ---------------- HTTP ----------------

  async request<T>(method: string, path: string, o: RequestOptions = {}, retried = false): Promise<T> {
    let url = this.baseUrl + path;
    if (o.query) {
      const q = Object.entries(o.query)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${enc(k)}=${enc(String(v))}`)
        .join("&");
      if (q) url += `?${q}`;
    }
    const headers: Record<string, string> = { accept: "application/json" };
    if (o.auth !== false) {
      const token = await this.accessToken();
      if (!token && o.auth !== "optional") throw new VibeError(401, "unauthorized", "Nicht angemeldet");
      if (token) headers.authorization = `Bearer ${token}`;
    }
    let body: RequestInit["body"];
    if (o.form) body = o.form;
    else if (o.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(o.body);
    }
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 15_000);
    const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method, headers, body, signal });
    } catch (e) {
      throw new VibeError(0, "network", `Server nicht erreichbar: ${(e as Error).message}`);
    }
    if (res.status === 204) return undefined as T;
    if (res.ok && o.binary) return (await res.blob()) as T;
    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        if (!res.ok) throw new VibeError(res.status, "bad_response", text.slice(0, 200));
        return text as T;
      }
    }
    if (res.ok) return json as T;
    const err = (json as ApiErrorBody | undefined)?.error;
    const e = new VibeError(res.status, err?.code ?? "http_error", err?.message ?? `HTTP ${res.status}`, err?.details, err?.retryAfter);
    if (res.status === 401 && o.auth !== false && !retried && (e.code === "token_expired" || e.code === "invalid_token")) {
      const next = await this.refresh();
      if (next) return this.request<T>(method, path, o, true);
    }
    if (e.code === "banned" && o.auth !== false) {
      await this.setTokens(null);
      this.opts.onAuthLost?.({ code: e.code, message: e.message });
    }
    throw e;
  }

  protected get<T>(path: string, query?: Query, auth = true) {
    return this.request<T>("GET", path, { query, auth });
  }
  protected post<T>(path: string, body?: unknown, auth = true) {
    return this.request<T>("POST", path, { body: body ?? {}, auth });
  }
  protected patch<T>(path: string, body: unknown) {
    return this.request<T>("PATCH", path, { body });
  }
  protected put<T>(path: string, body?: unknown) {
    return this.request<T>("PUT", path, { body: body ?? {} });
  }
  protected del<T = void>(path: string) {
    return this.request<T>("DELETE", path);
  }
}
