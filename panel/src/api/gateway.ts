import { httpRequest } from "./http";
import { WsSocket, wsUrl } from "./socket";
import { ApiError, buildQuery, type RequestOptions, type Transport } from "./transport";
import type { DeviceStart, GatewayAgent, VibeAccount } from "./types";

export interface AccountApi {
  me(): Promise<VibeAccount>;
  logout(): Promise<void>;
  deviceStart(): Promise<DeviceStart>;
  devicePoll(deviceToken: string): Promise<"pending" | "authorized">;
  agents(): Promise<GatewayAgent[]>;
  claim(code: string, name?: string): Promise<GatewayAgent>;
  renameAgent(id: string, name: string): Promise<GatewayAgent>;
  unlinkAgent(id: string): Promise<void>;
  microsoftLoginUrl(): string;
  agentTransport(agentId: string): Transport;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface TokenPair {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

const TOKENS_KEY = "vibe-panel.vibe-tokens";
const INLINE_LIMIT = 8 * 1024 * 1024;

export function vibeOrigin(): string {
  const override = import.meta.env.VITE_VIBE_URL as string | undefined;
  return override ? override.replace(/\/+$/, "") : "";
}

function loadTokens(): StoredTokens | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as StoredTokens) : null;
  } catch {
    return null;
  }
}

function saveTokens(t: StoredTokens | null) {
  try {
    if (t) localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKENS_KEY);
  } catch {
    /* privat */
  }
}

function toStored(p: TokenPair): StoredTokens {
  return { accessToken: p.accessToken, refreshToken: p.refreshToken, expiresAt: Date.now() + p.expiresIn * 1000 };
}

export function csrfToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)vibe_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export const WEB_LOGIN_PATH = "/auth/login?return=/panel/";

export function createGatewayAccount(onUnauthorized: () => void): AccountApi {
  const base = `${vibeOrigin()}/api/v1`;
  const enc = encodeURIComponent;
  let refreshing: Promise<string | null> | null = null;
  let web: { token: string; expiresAt: number } | null = null;
  let webPending: Promise<string | null> | null = null;
  let hadSession = false;

  const csrfHeaders = (): Record<string, string> => {
    const c = csrfToken();
    return c ? { "X-CSRF-Token": c } : {};
  };

  function webToken(): Promise<string | null> {
    if (web && web.expiresAt - Date.now() > 60_000) return Promise.resolve(web.token);
    webPending ??= httpRequest<{ accessToken: string; expiresIn: number }>(base, "POST", "/auth/web/token", { credentials: "same-origin", headers: csrfHeaders() })
      .then((r) => {
        web = { token: r.accessToken, expiresAt: Date.now() + r.expiresIn * 1000 };
        return web.token;
      })
      .catch(() => {
        web = null;
        return null;
      })
      .finally(() => (webPending = null));
    return webPending;
  }

  async function deviceToken(): Promise<string | null> {
    const t = loadTokens();
    if (!t) return null;
    if (t.expiresAt - Date.now() > 30_000) return t.accessToken;
    refreshing ??= httpRequest<TokenPair>(base, "POST", "/auth/refresh", {}, { body: { refreshToken: t.refreshToken } })
      .then((p) => {
        const s = toStored(p);
        saveTokens(s);
        return s.accessToken;
      })
      .catch((e) => {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) saveTokens(null);
        return null;
      })
      .finally(() => (refreshing = null));
    return refreshing;
  }

  async function access(): Promise<string | null> {
    return (await deviceToken()) ?? (await webToken());
  }

  const lost = () => {
    if (hadSession) {
      hadSession = false;
      if (!loadTokens() && csrfToken()) location.assign(`${vibeOrigin()}${WEB_LOGIN_PATH}`);
    }
    onUnauthorized();
  };

  async function req<T>(method: string, path: string, opts?: RequestOptions, root = base): Promise<T> {
    const bearer = await access();
    const r = await httpRequest<T>(root, method, path, { bearer, credentials: "same-origin", headers: bearer ? undefined : csrfHeaders(), onUnauthorized: lost }, opts);
    hadSession = true;
    return r;
  }

  async function chunkedUpload<T>(agentId: string, method: string, path: string, opts: RequestOptions): Promise<T> {
    const blob = opts.raw instanceof Blob ? opts.raw : new Blob([opts.raw ?? ""]);
    const a = `/agents/${enc(agentId)}`;
    const up = await req<{ uploadId: string; chunkSize: number }>("POST", `${a}/uploads`, {
      body: { method, path: path.replace(/^\//, ""), query: buildQuery(opts.query).slice(1) || undefined, contentType: opts.contentType ?? "application/octet-stream", size: blob.size },
    });
    try {
      for (let off = 0; off < blob.size; off += up.chunkSize) {
        await req("PUT", `${a}/uploads/${enc(up.uploadId)}`, { query: { offset: off }, raw: blob.slice(off, off + up.chunkSize) });
        opts.onProgress?.(Math.min(1, (off + up.chunkSize) / blob.size));
      }
      return await req<T>("POST", `${a}/uploads/${enc(up.uploadId)}/complete`);
    } catch (e) {
      await req("DELETE", `${a}/uploads/${enc(up.uploadId)}`).catch(() => undefined);
      throw e;
    }
  }

  const mapAgent = (a: RawAgent): GatewayAgent => ({
    id: a.id,
    name: a.name,
    hostname: a.hostname ?? null,
    os: a.os ?? null,
    version: a.version ?? null,
    online: !!a.online,
    lastSeenAt: a.lastSeenAt ? Date.parse(a.lastSeenAt) : null,
    owner: a.owner ?? null,
    myRole: a.myRole ?? "viewer",
    summary: a.summary ?? null,
    disabled: !!a.disabled,
  });

  return {
    me: () => req<VibeAccount>("GET", "/me"),
    async logout() {
      hadSession = false;
      const t = loadTokens();
      if (t) await req<void>("POST", "/auth/logout", { body: { refreshToken: t.refreshToken } }).catch(() => undefined);
      saveTokens(null);
      if (csrfToken()) await httpRequest<void>(base, "POST", "/auth/web/logout", { credentials: "same-origin", headers: csrfHeaders() }).catch(() => undefined);
      web = null;
    },
    deviceStart: () => httpRequest<DeviceStart>(base, "POST", "/auth/device/start", {}),
    async devicePoll(deviceToken) {
      const r = await httpRequest<{ status: "pending" } | { status: "authorized"; tokens: TokenPair }>(base, "POST", "/auth/device/poll", {}, { body: { deviceToken } });
      if (r.status === "authorized") saveTokens(toStored(r.tokens));
      return r.status;
    },
    agents: async () => (await req<{ agents: RawAgent[] }>("GET", "/agents")).agents.map(mapAgent),
    claim: async (code, name) => mapAgent(await req<RawAgent>("POST", "/agents/claim", { body: { code, name } })),
    renameAgent: async (id, name) => mapAgent(await req<RawAgent>("PATCH", `/agents/${enc(id)}`, { body: { name } })),
    unlinkAgent: (id) => req<void>("DELETE", `/agents/${enc(id)}`),
    microsoftLoginUrl: () => `${vibeOrigin()}${WEB_LOGIN_PATH}`,
    agentTransport(agentId) {
      const proxy = `${base}/agents/${enc(agentId)}/proxy`;
      return {
        kind: "gateway",
        request<T>(method: string, path: string, opts: RequestOptions = {}) {
          if (opts.raw instanceof Blob && opts.raw.size > INLINE_LIMIT) return chunkedUpload<T>(agentId, method, path, opts);
          return req<T>(method, path, opts, proxy);
        },
        openSocket() {
          return new WsSocket({
            url: async () => {
              const token = await access();
              return wsUrl(`${base}/agents/${enc(agentId)}`, `/ws${token ? `?token=${enc(token)}` : ""}`);
            },
          });
        },
      };
    },
  };
}

interface RawAgent {
  id: string;
  name: string;
  hostname?: string | null;
  os?: string | null;
  version?: string | null;
  online?: boolean;
  lastSeenAt?: string | null;
  owner?: { id: string; name: string } | null;
  myRole?: GatewayAgent["myRole"];
  summary?: GatewayAgent["summary"];
  disabled?: boolean;
}
