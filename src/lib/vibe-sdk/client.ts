// Übernommen aus @vibe-craft/sdk 0.1.0 (vibe-backend/packages/sdk/src/client.ts, MIT). Nur Importpfade angepasst.
import type {
  AcceptInviteResult,
  ApiErrorBody,
  AuthResult,
  Chat,
  ChallengeResult,
  ClientInfo,
  CreateInviteBody,
  CreateReportBody,
  DeviceSession,
  Friend,
  FriendRequest,
  HostingLimits,
  HostSession,
  Invite,
  Me,
  Message,
  Notification,
  Pack,
  PackDownload,
  PackVersion,
  PackVisibility,
  Presence,
  PublicUser,
  ServerMeta,
  SetPresenceBody,
  TokenPair,
  UpdateMeBody,
  UpdatePackBody,
  UserWithRelationship,
  VlpackManifest,
} from "./types";
import type {
  CloudSettings, DevicePoll, DeviceStart, DiscoveryCategory, DiscoveryInput, DiscoveryServer, DiscoverySubmission,
  FeedEventType, FeedPage, FeedPreferences, Screenshot, ScreenshotList, ScreenshotReport, ScreenshotVisibility,
} from "./types";

/** Gespeicherte Anmeldedaten. `expiresAt` = Ablauf des Access-Tokens (ms seit 1970). */
export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  sessionId: string;
}

/** Ablage für Tokens – z. B. OS-Keyring im Launcher, localStorage im Web. */
export interface TokenStore {
  get(): StoredTokens | null | Promise<StoredTokens | null>;
  set(tokens: StoredTokens | null): void | Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  private t: StoredTokens | null = null;
  constructor(initial?: StoredTokens | null) {
    this.t = initial ?? null;
  }
  get() {
    return this.t;
  }
  set(t: StoredTokens | null) {
    this.t = t;
  }
}

export interface VibeClientOptions {
  /** z. B. "https://vibe.axolite.app" */
  baseUrl: string;
  tokens?: TokenStore;
  /** eigene fetch-Implementierung (z. B. Tauri-HTTP-Plugin) */
  fetch?: typeof fetch;
  /** Wird aufgerufen, wenn die Anmeldung endgültig verloren ist (Refresh fehlgeschlagen, gesperrt, abgemeldet). */
  onAuthLost?: (reason: { code: string; message: string }) => void;
  /** Wird nach jedem Login/Refresh mit den neuen Tokens aufgerufen. */
  onTokens?: (tokens: StoredTokens | null) => void;
  /** Timeout pro Anfrage in ms (Standard 15000) */
  timeoutMs?: number;
}

/** Fehler der Vibe-API (einheitliches Format `{ error: { code, message } }`). */
export class VibeError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "VibeError";
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;
interface RequestOptions {
  query?: Query;
  body?: unknown;
  auth?: boolean | "optional";
  binary?: boolean;
  /** FormData wird unverändert gesendet */
  form?: FormData;
  signal?: AbortSignal;
}

const enc = encodeURIComponent;

/**
 * REST-Client für die Vibe-API. Erneuert Access-Tokens automatisch (eine Erneuerung gleichzeitig),
 * wiederholt Anfragen nach `token_expired` einmal und meldet endgültigen Login-Verlust über `onAuthLost`.
 */
export class VibeClient {
  readonly baseUrl: string;
  private store: TokenStore;
  private fetchImpl: typeof fetch;
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

  startDevicePairing() {
    return this.request<DeviceStart>("POST", "/api/v1/auth/device/start", { auth: false });
  }

  approveDevicePairing(code: string) {
    return this.request<void>("POST", "/api/v1/auth/device/approve", { body: { code } });
  }

  async pollDevicePairing(deviceToken: string, signal?: AbortSignal) {
    const result = await this.request<DevicePoll>("POST", "/api/v1/auth/device/poll", { auth: false, body: { deviceToken }, signal });
    if (result.status === "authorized") await this.setTokens(this.toStored(result.tokens));
    return result;
  }

  uploadScreenshot(file: Blob, visibility: ScreenshotVisibility = "private") {
    const form = new FormData();
    form.set("visibility", visibility);
    form.set("file", file);
    return this.request<Screenshot>("POST", "/api/v1/screenshots", { form });
  }

  listScreenshots(query?: { limit?: number; offset?: number }) {
    return this.request<ScreenshotList>("GET", "/api/v1/screenshots", { query });
  }

  setScreenshotVisibility(id: string, visibility: ScreenshotVisibility) {
    return this.request<Screenshot>("PATCH", `/api/v1/screenshots/${enc(id)}`, { body: { visibility } });
  }

  downloadScreenshot(id: string, key?: string) {
    return this.request<Blob>("GET", `/api/v1/screenshots/${enc(id)}/image`, { query: { key }, auth: key ? "optional" : true, binary: true });
  }

  reportScreenshot(id: string, body: ScreenshotReport) {
    return this.request<void>("POST", `/api/v1/screenshots/${enc(id)}/report`, { body });
  }

  deleteScreenshot(id: string) {
    return this.request<void>("DELETE", `/api/v1/screenshots/${enc(id)}`);
  }

  feedPreferences() {
    return this.request<FeedPreferences>("GET", "/api/v1/feed/preferences");
  }

  setFeedPreferences(enabled: boolean) {
    return this.request<FeedPreferences>("PUT", "/api/v1/feed/preferences", { body: { enabled } });
  }

  publishFeedEvent(type: FeedEventType) {
    return this.request<void>("POST", "/api/v1/feed/events", { body: { type } });
  }

  feed(query?: { limit?: number; before?: string }) {
    return this.request<FeedPage>("GET", "/api/v1/feed", { query });
  }

  discoverServers(query?: { category?: DiscoveryCategory; limit?: number; offset?: number }) {
    return this.request<{ servers: DiscoveryServer[] }>("GET", "/api/v1/discovery/servers", { auth: false, query });
  }

  submitServer(body: DiscoveryInput) {
    return this.request<DiscoverySubmission>("POST", "/api/v1/discovery/submissions", { body });
  }

  listServerSubmissions(query?: { limit?: number; offset?: number }) {
    return this.request<{ submissions: DiscoverySubmission[] }>("GET", "/api/v1/discovery/submissions", { query });
  }

  getCloudSettings() {
    return this.request<CloudSettings>("GET", "/api/v1/cloud-settings");
  }

  putCloudSettings(body: CloudSettings) {
    return this.request<CloudSettings>("PUT", "/api/v1/cloud-settings", { body });
  }

  private toStored(p: TokenPair): StoredTokens {
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

  private get<T>(path: string, query?: Query, auth = true) {
    return this.request<T>("GET", path, { query, auth });
  }
  private post<T>(path: string, body?: unknown, auth = true) {
    return this.request<T>("POST", path, { body: body ?? {}, auth });
  }
  private patch<T>(path: string, body: unknown) {
    return this.request<T>("PATCH", path, { body });
  }
  private put<T>(path: string, body?: unknown) {
    return this.request<T>("PUT", path, { body: body ?? {} });
  }
  private del<T = void>(path: string) {
    return this.request<T>("DELETE", path);
  }

  // ---------------- Auth ----------------

  readonly auth = {
    /** Schritt 1: serverId holen */
    challenge: () => this.post<ChallengeResult>("/api/v1/auth/challenge", {}, false),
    /** Schritt 3: nach Mojang-`join` bestätigen; speichert die Tokens */
    verify: async (name: string, serverId: string, client: ClientInfo) => {
      const r = await this.post<AuthResult>("/api/v1/auth/verify", { name, serverId, client }, false);
      await this.setTokens(this.toStored(r));
      return r;
    },
    /**
     * Kompletter Login. `joinServer` muss Mojangs `POST https://sessionserver.mojang.com/session/minecraft/join`
     * mit dem Minecraft-Access-Token aufrufen (`{ accessToken, selectedProfile: <uuid ohne Bindestriche>, serverId }`).
     * Das Minecraft-Token verlässt dabei nie den Client.
     */
    login: async (o: { name: string; client: ClientInfo; joinServer: (serverId: string) => Promise<void> }) => {
      const { serverId } = await this.auth.challenge();
      await o.joinServer(serverId);
      return this.auth.verify(o.name, serverId, o.client);
    },
    logout: async () => {
      try {
        await this.post<void>("/api/v1/auth/logout");
      } finally {
        await this.setTokens(null);
      }
    },
    sessions: () => this.get<DeviceSession[]>("/api/v1/auth/sessions"),
    revokeSession: (id: string) => this.del(`/api/v1/auth/sessions/${enc(id)}`),
  };

  // ---------------- Meta / Profil / Nutzer ----------------

  meta = () => this.get<ServerMeta>("/api/v1/meta", undefined, false);

  readonly me = {
    get: () => this.get<Me>("/api/v1/me"),
    update: (body: UpdateMeBody) => this.patch<Me>("/api/v1/me", body),
  };

  readonly users = {
    search: (q: string, limit?: number) => this.get<UserWithRelationship[]>("/api/v1/users/search", { q, limit }),
    get: (userId: string) => this.get<UserWithRelationship>(`/api/v1/users/${enc(userId)}`),
    packs: (userId: string) => this.get<Pack[]>(`/api/v1/users/${enc(userId)}/packs`),
  };

  // ---------------- Freunde ----------------

  readonly friends = {
    list: () => this.get<Friend[]>("/api/v1/friends"),
    requests: () => this.get<FriendRequest[]>("/api/v1/friends/requests"),
    /** per userId oder Minecraft-Name */
    request: (to: { userId: string } | { name: string }) =>
      this.post<{ status: "pending" | "accepted"; request: FriendRequest | null; friend: Friend | null }>("/api/v1/friends/requests", to),
    accept: (requestId: string) => this.post<Friend>(`/api/v1/friends/requests/${enc(requestId)}/accept`),
    decline: (requestId: string) => this.post<void>(`/api/v1/friends/requests/${enc(requestId)}/decline`),
    cancel: (requestId: string) => this.del(`/api/v1/friends/requests/${enc(requestId)}`),
    remove: (userId: string) => this.del(`/api/v1/friends/${enc(userId)}`),
    blocked: () => this.get<PublicUser[]>("/api/v1/blocks"),
    block: (userId: string) => this.put<void>(`/api/v1/blocks/${enc(userId)}`),
    unblock: (userId: string) => this.del(`/api/v1/blocks/${enc(userId)}`),
  };

  // ---------------- Presence ----------------

  readonly presence = {
    /** Alternative zum Gateway-Op `presence` */
    set: (body: SetPresenceBody) => this.put<Presence>("/api/v1/presence", body),
    friends: () => this.get<Presence[]>("/api/v1/presence/friends"),
  };

  // ---------------- Chats ----------------

  readonly chats = {
    list: () => this.get<Chat[]>("/api/v1/chats"),
    get: (chatId: string) => this.get<Chat>(`/api/v1/chats/${enc(chatId)}`),
    openDm: (userId: string) => this.post<Chat>("/api/v1/chats/dm", { userId }),
    createGroup: (name: string, memberIds: string[]) => this.post<Chat>("/api/v1/chats", { name, memberIds }),
    updateGroup: (chatId: string, body: { name?: string; ownerId?: string }) => this.patch<Chat>(`/api/v1/chats/${enc(chatId)}`, body),
    addMembers: (chatId: string, userIds: string[]) => this.post<Chat>(`/api/v1/chats/${enc(chatId)}/members`, { userIds }),
    removeMember: (chatId: string, userId: string) => this.del(`/api/v1/chats/${enc(chatId)}/members/${enc(userId)}`),
    leave: async (chatId: string) => {
      const me = await this.me.get();
      return this.del(`/api/v1/chats/${enc(chatId)}/members/${enc(me.id)}`);
    },
    /** Neueste zuerst; `before` = Nachrichten-ID für ältere Seiten */
    messages: (chatId: string, o: { before?: string; limit?: number } = {}) =>
      this.get<{ messages: Message[]; hasMore: boolean }>(`/api/v1/chats/${enc(chatId)}/messages`, o),
    send: (chatId: string, content: string, o: { nonce?: string; replyToId?: string } = {}) =>
      this.post<Message>(`/api/v1/chats/${enc(chatId)}/messages`, { content, ...o }),
    edit: (chatId: string, messageId: string, content: string) => this.patch<Message>(`/api/v1/chats/${enc(chatId)}/messages/${enc(messageId)}`, { content }),
    delete: (chatId: string, messageId: string) => this.del(`/api/v1/chats/${enc(chatId)}/messages/${enc(messageId)}`),
    read: (chatId: string, messageId?: string) => this.post<void>(`/api/v1/chats/${enc(chatId)}/read`, messageId ? { messageId } : {}),
    typing: (chatId: string) => this.post<void>(`/api/v1/chats/${enc(chatId)}/typing`),
  };

  // ---------------- Einladungen ----------------

  readonly invites = {
    list: (direction: "incoming" | "outgoing" = "incoming", pendingOnly = false) => this.get<Invite[]>("/api/v1/invites", { direction, pendingOnly }),
    send: (body: CreateInviteBody) => this.post<Invite[]>("/api/v1/invites", body),
    accept: (inviteId: string) => this.post<AcceptInviteResult>(`/api/v1/invites/${enc(inviteId)}/accept`),
    decline: (inviteId: string) => this.post<Invite>(`/api/v1/invites/${enc(inviteId)}/decline`),
    cancel: (inviteId: string) => this.del(`/api/v1/invites/${enc(inviteId)}`),
  };

  // ---------------- Geteilte Modpacks ----------------

  readonly packs = {
    mine: () => this.get<Pack[]>("/api/v1/packs/mine"),
    browse: (o: { q?: string; mcVersion?: string; loader?: string; sort?: "downloads" | "updated"; limit?: number; offset?: number } = {}) =>
      this.request<Pack[]>("GET", "/api/v1/packs", { query: o, auth: false }),
    /** Pack per Share-Code (auch ohne Anmeldung für öffentliche/nicht gelistete Packs) */
    get: async (code: string) => this.request<Pack>("GET", `/api/v1/packs/${enc(code)}`, { auth: await this.isLoggedIn() }),
    versions: async (code: string) => this.request<PackVersion[]>("GET", `/api/v1/packs/${enc(code)}/versions`, { auth: await this.isLoggedIn() }),
    /** Manifest zum Installieren (zählt den Download) */
    download: async (code: string, versionId?: string) =>
      this.request<PackDownload>("GET", `/api/v1/packs/${enc(code)}/download`, { query: { version: versionId }, auth: await this.isLoggedIn() }),
    /** Teilen: vlpack.json + optional Overrides-ZIP und Icon */
    create: (o: { manifest: VlpackManifest; overrides?: Blob; icon?: Blob; visibility?: PackVisibility; description?: string; changelog?: string }) =>
      this.request<Pack>("POST", "/api/v1/packs", { form: packForm(o) }),
    publishVersion: (code: string, o: { manifest: VlpackManifest; overrides?: Blob; icon?: Blob; changelog?: string }) =>
      this.request<Pack>("POST", `/api/v1/packs/${enc(code)}/versions`, { form: packForm(o) }),
    update: (code: string, body: UpdatePackBody) => this.patch<Pack>(`/api/v1/packs/${enc(code)}`, body),
    delete: (code: string) => this.del(`/api/v1/packs/${enc(code)}`),
    /** Overrides-ZIP als Blob laden */
    overrides: async (url: string) => {
      const token = await this.accessToken();
      const res = await this.fetchImpl(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new VibeError(res.status, "download_failed", `Download fehlgeschlagen (${res.status})`);
      return res.blob();
    },
  };

  // ---------------- Hosting ----------------

  readonly hosting = {
    mine: () => this.get<HostSession[]>("/api/v1/hosting/sessions"),
    friends: () => this.get<HostSession[]>("/api/v1/hosting/friends"),
    limits: () => this.get<HostingLimits>("/api/v1/hosting/limits"),
  };

  // ---------------- Benachrichtigungen / Meldungen ----------------

  readonly notifications = {
    list: (o: { unread?: boolean; before?: string; limit?: number } = {}) =>
      this.get<{ notifications: Notification[]; unreadCount: number }>("/api/v1/notifications", o),
    markRead: (ids: string[]) => this.post<void>("/api/v1/notifications/read", { ids }),
    markAllRead: () => this.post<void>("/api/v1/notifications/read", { all: true }),
    delete: (id: string) => this.del(`/api/v1/notifications/${enc(id)}`),
  };

  report = (body: CreateReportBody) => this.post<{ id: string }>("/api/v1/reports", body);

  /** Links zu einem Pack */
  packLinks(code: string) {
    return { url: `${this.baseUrl}/p/${code}`, deepLink: `vibelauncher://pack/${code}` };
  }
}

function packForm(o: { manifest: VlpackManifest; overrides?: Blob; icon?: Blob; visibility?: string; description?: string; changelog?: string }) {
  const f = new FormData();
  if (o.visibility) f.append("visibility", o.visibility);
  if (o.description) f.append("description", o.description);
  if (o.changelog) f.append("changelog", o.changelog);
  f.append("manifest", JSON.stringify(o.manifest));
  if (o.overrides) f.append("overrides", o.overrides, "overrides.zip");
  if (o.icon) f.append("icon", o.icon, "icon.png");
  return f;
}
