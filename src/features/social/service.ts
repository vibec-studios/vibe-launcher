// Vibe-Dienste im Frontend: ein VibeClient + VibeGateway (vendored SDK) für den aktiven Minecraft-Account.
// Gateway-Events landen im Zustand-Store (Freunde, Presence, Chats, Tippen, Einladungen, Hosts) bzw. im
// Query-Cache (Nachrichtenverlauf). Nichts hier blockiert den Rest des Launchers: Fehler/Offline setzen nur
// `conn`/`error`, die UI zeigt dann einen freundlichen Zustand.
//
// Netzwerk gibt es nur, wenn `settings.vibe.enabled` an ist (zusätzlich in Rust gesperrt, Standard: an). Ist ein
// Minecraft-Account angemeldet, verbindet der Launcher sich automatisch mit Vibe (Mojang-join, Tokens im
// Schlüsselbund) – außer der Nutzer hat für diesen Account „Verknüpfung lösen“ gewählt (bis zum nächsten
// bewussten „Verbinden“).
import type { InfiniteData } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { create } from "zustand";
import { api } from "@/lib/api";
import { queryClient, useGameStore, useServerStore } from "@/lib/queries";
import type { Instance, Server } from "@/lib/types";
import { VibeClient, VibeError, VibeGateway } from "@/lib/vibe-sdk";
import type { Activity, Chat, Friend, FriendRequest, HostSession, Invite, Me, Message, PresenceStatusSetting } from "@/lib/vibe-sdk";
import { keyringTokenStore, TauriWebSocket, tauriFetch } from "@/lib/vibe-sdk/tauri";
import { t } from "@/i18n";
import { accessDenied, bindAccess, clearAccess, ensureAccess, forgetAccess, onAccessChange } from "@/features/access/store";
import { isAccessCode } from "@/features/access/types";

export type Conn =
  /** Hauptschalter (bzw. Freunde + Presence) aus – keine Verbindung */
  | "off"
  /** kein Minecraft-Account */
  | "no_account"
  /** noch nie verbunden / abgemeldet */
  | "logged_out"
  | "logging_in"
  | "connecting"
  | "ready"
  | "reconnecting"
  /** Backend nicht erreichbar (versucht es weiter) */
  | "offline"
  | "no_access";

export interface MessagesPage {
  messages: Message[];
  hasMore: boolean;
}

export const vqk = {
  messages: (chatId: string) => ["vibe", "messages", chatId] as const,
  blocked: ["vibe", "blocked"] as const,
  search: (q: string) => ["vibe", "search", q] as const,
  packsMine: ["vibe", "packs", "mine"] as const,
  pack: (code: string) => ["vibe", "pack", code] as const,
  hostingLimits: ["vibe", "hosting", "limits"] as const,
  hostingMine: ["vibe", "hosting", "mine"] as const,
  outgoingInvites: ["vibe", "invites", "outgoing"] as const,
  meta: ["vibe", "meta"] as const,
};

interface SocialState {
  conn: Conn;
  error: string | null;
  /** Account-Name, mit dem angemeldet wird */
  identity: string | null;
  /** Schlüssel des Accounts (Account-ID) */
  scope: string | null;
  /** Für diesen Account kein automatisches Verbinden („Verknüpfung lösen“) */
  unlinked: boolean;
  /** Zuletzt automatisch (ohne Klick) verbunden – für den einmaligen Hinweis */
  autoLinked: boolean;
  /** Vibe-Tokens für diesen Account vorhanden (angemeldet, auch wenn das Gateway gerade getrennt ist) */
  linked: boolean;
  me: Me | null;
  features: Record<string, boolean>;
  motd: string | null;
  friends: Record<string, Friend>;
  requests: FriendRequest[];
  chats: Record<string, Chat>;
  /** chatId -> userId -> gültig bis (ms) */
  typing: Record<string, Record<string, number>>;
  /** Eingehende Einladungen (offen) */
  invites: Invite[];
  /** Joinbare Host-Sessions von Freunden */
  hosts: Record<string, HostSession>;
  /** Gerade sichtbarer Chat (Toasts/ungelesen) */
  activeChat: string | null;
  /** Freunde-Panel rechts */
  panelOpen: boolean;
  /** Nachrichten, die gerade gesendet werden (nonce -> chatId) */
  pending: Record<string, string>;
}

function lsGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* egal */
  }
}

const empty = {
  me: null,
  features: {},
  motd: null,
  friends: {},
  requests: [],
  chats: {},
  typing: {},
  invites: [],
  hosts: {},
  pending: {},
};

export const useSocial = create<SocialState>(() => ({
  conn: "off",
  error: null,
  identity: null,
  scope: null,
  unlinked: false,
  autoLinked: false,
  linked: false,
  activeChat: null,
  panelOpen: lsGet("vibe.panel") === "1",
  ...empty,
}));

// ------------------------------------------------------------------ Verknüpfung je Account

const UNLINKED_KEY = "vibe.unlinked";

function unlinkedScopes(): string[] {
  try {
    const v = JSON.parse(lsGet(UNLINKED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function setUnlinked(scope: string, on: boolean) {
  const list = unlinkedScopes().filter((x) => x !== scope);
  if (on) list.push(scope);
  lsSet(UNLINKED_KEY, JSON.stringify(list.slice(-50)));
  if (get().scope === scope) set({ unlinked: on });
}

export function setPanelOpen(open: boolean) {
  lsSet("vibe.panel", open ? "1" : "0");
  useSocial.setState({ panelOpen: open });
}

const set = useSocial.setState;
const get = useSocial.getState;

// ------------------------------------------------------------------ Konfiguration / Lebenszyklus

export interface VibeConfig {
  enabled: boolean;
  social: boolean;
  presence: boolean;
  sharing: boolean;
  hosting: boolean;
}

let client: VibeClient | null = null;
let gateway: VibeGateway | null = null;
let clientKey = "";
let tokens = keyringTokenStore();
let cfg: VibeConfig = { enabled: false, social: false, presence: false, sharing: false, hosting: false };
const offGateway: (() => void)[] = [];

/** Aktueller Client (null = Dienste aus / kein Account). */
export function vibeClient(): VibeClient | null {
  return client;
}

/** Client oder Fehler (für Mutationen). */
export function requireClient(): VibeClient {
  if (!client) throw new Error(t("social.err.not_connected"));
  return client;
}

function gatewayWanted() {
  return cfg.enabled && (cfg.social || cfg.presence);
}

let cfgSeq = 0;

/** Vom VibeBridge bei jeder Änderung von Einstellungen/Account aufgerufen. */
export async function configure(next: VibeConfig) {
  cfg = next;
  const seq = ++cfgSeq;
  if (!next.enabled) {
    teardown("off");
    return;
  }
  let status;
  try {
    status = await api.vibeStatus();
  } catch {
    return;
  }
  // Inzwischen neuer Aufruf (z. B. schnelles Umschalten) -> der gewinnt
  if (seq !== cfgSeq || !cfg.enabled) return;
  const ident = status.identity;
  if (!ident) {
    teardown("no_account");
    return;
  }
  const key = `${status.api_url}|${ident.scope}`;
  if (key !== clientKey || !client) {
    teardown("logged_out");
    clientKey = key;
    tokens = keyringTokenStore();
    client = new VibeClient({
      baseUrl: status.api_url,
      tokens,
      fetch: accessFetch,
      timeoutMs: 20_000,
      onAuthLost: ({ message }) => {
        stopGateway();
        set({ conn: "logged_out", error: message, linked: false, ...empty });
        // z. B. Refresh-Token abgelaufen -> einmal still neu anmelden
        if (!get().unlinked && autoTries < MAX_AUTO_TRIES) setTimeout(() => void autoLogin(), 1000);
      },
    });
    autoTries = 0;
    clearRetry();
    bindAccess(client, ident.scope);
    set({ identity: ident.name, scope: ident.scope, unlinked: unlinkedScopes().includes(ident.scope) });
  }
  // Debug-Offline-Testprofil (VIBE_DEV_OFFLINE_ACCOUNT) nur an einem lokalen Test-Backend automatisch anmelden –
  // nie am echten Backend (dort gibt es keinen Dev-Bypass, nur fehlschlagende Anmeldeversuche)
  autoAllowed = !ident.dev || isLoopback(status.api_url);
  const loggedIn = await client.isLoggedIn();
  if (seq !== cfgSeq) return;
  if (!loggedIn) {
    if (get().conn === "logging_in") return;
    // Automatisch verbinden (einmal je Account und Sitzung; Netzwerkfehler -> später erneut)
    if (autoAllowed && !get().unlinked && autoTries < MAX_AUTO_TRIES && !retryTimer) {
      void autoLogin();
      return;
    }
    if (!retryTimer) set({ conn: "logged_out", linked: false });
    return;
  }
  set({ linked: true });
  if (!(await proceed(client))) return;
  if (seq !== cfgSeq) return;
  // Presence-Schalter geändert -> Status sofort anpassen
  pushPresence(true);
}

async function proceed(c: VibeClient): Promise<boolean> {
  if (gatewayWanted() && get().conn !== "ready" && get().conn !== "no_access") set({ conn: "connecting" });
  const allowed = await ensureAccess(c);
  if (c !== client) return false;
  if (!allowed) {
    blockServices();
    return false;
  }
  if (gatewayWanted()) startGateway();
  else {
    stopGateway();
    set({ conn: "off" });
  }
  return true;
}

function blockServices() {
  stopGateway();
  queryClient.removeQueries({ queryKey: ["vibe"] });
  set({ conn: "no_access", error: null, ...empty });
}

const accessFetch: typeof fetch = async (input, init) => {
  const res = await tauriFetch(input, init);
  if (res.status === 403) {
    const code = await res
      .clone()
      .json()
      .then((j: { error?: { code?: unknown } }) => j?.error?.code)
      .catch(() => null);
    if (isAccessCode(code)) accessDenied(code);
  }
  return res;
};

onAccessChange((allowed) => {
  if (!client || !get().linked) return;
  if (!allowed) {
    if (get().conn !== "no_access") blockServices();
    return;
  }
  if (get().conn !== "no_access") return;
  if (gatewayWanted()) startGateway();
  else set({ conn: "off" });
  pushPresence(true);
});

function teardown(conn: Conn) {
  stopGateway();
  clearRetry();
  client = null;
  clientKey = "";
  queryClient.removeQueries({ queryKey: ["vibe"] });
  const keep = conn !== "off" && conn !== "no_account";
  bindAccess(null, keep ? get().scope : null);
  set({ conn, error: null, ...empty, autoLinked: false, linked: false, identity: keep ? get().identity : null, scope: keep ? get().scope : null, unlinked: keep && get().unlinked });
}

// ------------------------------------------------------------------ Anmelden / Verknüpfung

const MAX_AUTO_TRIES = 2;
let autoTries = 0;
let autoAllowed = true;

function isLoopback(url: string) {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 30_000;

function clearRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryDelay = 30_000;
}

/** Automatische Anmeldung, sobald ein Microsoft-Account da ist (kein Klick nötig). */
async function autoLogin() {
  const c = client;
  if (!c || !autoAllowed || get().unlinked || get().conn === "logging_in" || !cfg.enabled) return;
  autoTries++;
  try {
    await login();
    clearRetry();
    if (c === client) set({ autoLinked: true });
  } catch (e) {
    if (c !== client) return;
    // Server nicht erreichbar -> später still erneut versuchen (zählt nicht als Fehlversuch)
    if (e instanceof VibeError && e.status === 0) {
      autoTries--;
      set({ conn: "offline", error: null });
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void autoLogin();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 5 * 60_000);
    }
  }
}

/** Bewusstes „Verbinden“ (z. B. nach „Verknüpfung lösen“): schaltet das automatische Verbinden wieder ein. */
export async function connect() {
  const scope = get().scope;
  if (scope) setUnlinked(scope, false);
  clearRetry();
  autoTries = 0;
  set({ autoLinked: false });
  await login();
}

/** „Verknüpfung lösen“: am Backend abmelden, Tokens löschen, kein automatisches Verbinden mehr für diesen Account. */
export async function unlink() {
  const scope = get().scope;
  if (scope) setUnlinked(scope, true);
  clearRetry();
  await logout();
}

/** „Vibe-Konto löschen“ (`DELETE /api/v1/me`), danach lokal wie „Verknüpfung lösen“. */
export async function deleteAccount() {
  const c = requireClient();
  const scope = get().scope;
  const was = get().unlinked;
  // Vorher sperren: Das Backend schließt das Gateway (4010) evtl. noch vor der HTTP-Antwort
  if (scope) setUnlinked(scope, true);
  try {
    await c.request<void>("DELETE", "/api/v1/me", { body: { confirm: true } });
  } catch (e) {
    if (scope) setUnlinked(scope, was);
    throw e;
  }
  clearRetry();
  stopGateway();
  forgetAccess();
  await Promise.resolve(tokens.set(null)).catch(() => {});
  queryClient.removeQueries({ queryKey: ["vibe"] });
  set({ conn: "logged_out", error: null, autoLinked: false, linked: false, ...empty });
}

/** Anmeldung über Mojang-join (automatisch oder per Klick). */
export async function login() {
  const c = client;
  if (!c) throw new Error(t("social.err.not_connected"));
  set({ conn: "logging_in", error: null });
  try {
    const status = await api.vibeStatus();
    const name = status.identity?.name;
    if (!name) throw new Error(t("social.err.no_account"));
    const version = await getVersion().catch(() => "1.0.0");
    await c.auth.login({
      name,
      client: { name: "vibe-launcher", version, platform: "windows" },
      joinServer: async (serverId) => {
        await api.vibeMojangJoin(serverId);
      },
    });
    set({ linked: true });
  } catch (e) {
    set({ conn: "logged_out", error: errText(e) });
    throw e;
  }
  if (await proceed(c)) pushPresence(true);
}

export async function logout() {
  const c = client;
  stopGateway();
  clearAccess();
  try {
    await c?.auth.logout();
  } catch {
    await Promise.resolve(tokens.set(null)).catch(() => {});
  }
  queryClient.removeQueries({ queryKey: ["vibe"] });
  set({ conn: "logged_out", error: null, autoLinked: false, linked: false, ...empty });
}

export function errText(e: unknown): string {
  if (e instanceof VibeError) return e.status === 0 ? t("social.err.offline") : e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

// ------------------------------------------------------------------ Gateway-Events für andere Features
// (z. B. Cosmetics: `catalog.updated`, `submission.updated`). Überlebt Neuverbindungen und neue Gateways.

type ExtraListener = { ev: string; fn: (d: unknown) => void; off?: () => void };
const extraListeners = new Set<ExtraListener>();

/** Gateway-Event abonnieren (auch Events, die das SDK noch nicht typisiert). Gibt die Abmeldung zurück. */
export function onGatewayEvent(ev: string, fn: (d: unknown) => void): () => void {
  const l: ExtraListener = { ev, fn };
  extraListeners.add(l);
  if (gateway) l.off = (gateway as unknown as { on: (e: string, f: (d: unknown) => void) => () => void }).on(ev, fn);
  return () => {
    extraListeners.delete(l);
    l.off?.();
  };
}

function stopGateway() {
  while (offGateway.length) offGateway.pop()!();
  gateway?.disconnect();
  gateway = null;
  lastPresence = "";
}

function startGateway() {
  if (!client) return;
  if (gateway) {
    gateway.connect();
    return;
  }
  const gw = new VibeGateway(client, { WebSocket: TauriWebSocket as unknown as typeof WebSocket, presence: currentPresence(), maxBackoffMs: 30_000 });
  gateway = gw;
  wireGateway(gw);
  set({ conn: "connecting" });
  gw.connect();
}

// ------------------------------------------------------------------ Gateway -> Store

let failedAttempts = 0;

function wireGateway(gw: VibeGateway) {
  const on: VibeGateway["on"] = (ev, fn) => {
    const off = gw.on(ev, fn);
    offGateway.push(off);
    return off;
  };

  on("state", (s) => {
    if (s === "ready") {
      failedAttempts = 0;
      set({ conn: "ready", error: null });
    } else if (s === "reconnecting") set({ conn: failedAttempts >= 2 ? "offline" : "reconnecting" });
    else if (s === "connecting") set({ conn: get().conn === "offline" ? "offline" : "connecting" });
  });
  on("disconnected", ({ code, reason, fatal }) => {
    if (code === 1006) failedAttempts++;
    if (code === 4403) {
      accessDenied(reason);
      if (get().conn !== "no_access") blockServices();
    }
    if (fatal && code === 4010) set({ conn: "logged_out", error: t("social.err.revoked"), linked: false, ...empty });
  });
  on("ready", (d) => {
    const friends: Record<string, Friend> = {};
    for (const f of d.friends) friends[f.user.id] = f;
    set({ me: d.user, friends, features: d.features });
    lastPresence = "";
    pushPresence(true);
    void reloadState();
  });
  on("resumed", () => pushPresence(true));
  on("error", ({ code }) => {
    if (isAccessCode(code)) accessDenied(code);
  });

  for (const l of extraListeners) l.off = (gw as unknown as { on: (e: string, f: (d: unknown) => void) => () => void }).on(l.ev, l.fn);

  // Freunde / Presence
  on("presence.update", (p) => {
    const f = get().friends[p.userId];
    if (f) set({ friends: { ...get().friends, [p.userId]: { ...f, presence: p } } });
  });
  on("friend.request", (r) => {
    set({ requests: [r, ...get().requests.filter((x) => x.id !== r.id)] });
    if (r.direction === "incoming") notify(t("social.toast.request", { name: r.from.name }), undefined, { label: t("social.open"), onClick: () => openSocial() });
  });
  on("friend.request.removed", ({ id }) => {
    set({ requests: get().requests.filter((x) => x.id !== id) });
    queryClient.invalidateQueries({ queryKey: ["vibe", "search"] });
  });
  on("friend.added", (f) => {
    set({ friends: { ...get().friends, [f.user.id]: f }, requests: get().requests.filter((r) => r.from.id !== f.user.id && r.to.id !== f.user.id) });
    queryClient.invalidateQueries({ queryKey: ["vibe", "search"] });
  });
  on("friend.removed", ({ userId }) => {
    const { [userId]: _, ...rest } = get().friends;
    set({ friends: rest });
  });
  on("user.blocked", ({ userId }) => {
    const { [userId]: _, ...rest } = get().friends;
    set({ friends: rest, requests: get().requests.filter((r) => r.from.id !== userId && r.to.id !== userId) });
    queryClient.invalidateQueries({ queryKey: vqk.blocked });
  });
  on("user.unblocked", () => queryClient.invalidateQueries({ queryKey: vqk.blocked }));
  on("user.updated", (u) => {
    const f = get().friends[u.id];
    if (f) set({ friends: { ...get().friends, [u.id]: { ...f, user: u } } });
  });
  on("me.updated", (me) => set({ me }));

  // Chats
  on("chat.created", (c) => upsertChat(c));
  on("chat.updated", (c) => upsertChat(c));
  on("chat.removed", ({ chatId }) => {
    const { [chatId]: _, ...rest } = get().chats;
    set({ chats: rest, activeChat: get().activeChat === chatId ? null : get().activeChat });
    queryClient.removeQueries({ queryKey: vqk.messages(chatId) });
  });
  on("chat.read", ({ chatId, userId, messageId }) => {
    const c = get().chats[chatId];
    if (!c) return;
    const members = c.members.map((m) => (m.user.id === userId ? { ...m, lastReadMessageId: messageId } : m));
    upsertChat({ ...c, members, unreadCount: userId === get().me?.id ? 0 : c.unreadCount });
  });
  on("message.created", (m) => onMessage(m));
  on("message.updated", (m) => patchMessage(m.chatId, m.id, () => m));
  on("message.deleted", ({ chatId, messageId }) => patchMessage(chatId, messageId, (old) => ({ ...old, deleted: true, content: "" })));
  on("typing", ({ chatId, userId, until }) => {
    if (userId === get().me?.id) return;
    const ty = { ...get().typing, [chatId]: { ...(get().typing[chatId] ?? {}), [userId]: Date.parse(until) || Date.now() + 8000 } };
    set({ typing: ty });
  });

  // Einladungen / Hosting / Sonstiges
  on("invite.received", (inv) => {
    set({ invites: [inv, ...get().invites.filter((x) => x.id !== inv.id)] });
    notify(t("social.toast.invite", { name: inv.from.name }), inv.target.name, { label: t("social.invite.view"), onClick: () => openSocial() });
  });
  on("invite.updated", (inv) => {
    set({ invites: inv.status === "pending" && !inv.myResponse ? get().invites.map((x) => (x.id === inv.id ? inv : x)) : get().invites.filter((x) => x.id !== inv.id) });
    queryClient.invalidateQueries({ queryKey: vqk.outgoingInvites });
  });
  on("hosting.update", (h) => {
    if (h.host.id === get().me?.id) {
      queryClient.invalidateQueries({ queryKey: vqk.hostingMine });
      queryClient.invalidateQueries({ queryKey: vqk.hostingLimits });
      return;
    }
    set({ hosts: { ...get().hosts, [h.id]: h } });
  });
  on("hosting.ended", ({ id }) => {
    const { [id]: _, ...rest } = get().hosts;
    set({ hosts: rest });
    queryClient.invalidateQueries({ queryKey: vqk.hostingMine });
    queryClient.invalidateQueries({ queryKey: vqk.hostingLimits });
  });
  on("settings.updated", ({ features, motd }) => set({ features, motd }));
  on("session.revoked", () => set({ error: t("social.err.revoked") }));
}

async function reloadState() {
  const c = client;
  if (!c) return;
  const [requests, chats, invites, hosts] = await Promise.allSettled([c.friends.requests(), c.chats.list(), c.invites.list("incoming", true), c.hosting.friends()]);
  if (c !== client) return;
  const patch: Partial<SocialState> = {};
  if (requests.status === "fulfilled") patch.requests = requests.value;
  if (chats.status === "fulfilled") {
    const map: Record<string, Chat> = {};
    for (const ch of chats.value) map[ch.id] = ch;
    patch.chats = map;
  }
  if (invites.status === "fulfilled") patch.invites = invites.value.filter((i) => i.status === "pending" && !i.myResponse);
  if (hosts.status === "fulfilled") {
    const map: Record<string, HostSession> = {};
    for (const h of hosts.value) map[h.id] = h;
    patch.hosts = map;
  }
  set(patch);
  // Nachrichten nach einer neuen Sitzung frisch laden (Resume liefert verpasste Events selbst)
  queryClient.invalidateQueries({ queryKey: ["vibe", "messages"] });
}

function upsertChat(c: Chat) {
  set({ chats: { ...get().chats, [c.id]: c } });
}

function patchMessage(chatId: string, id: string, fn: (m: Message) => Message) {
  queryClient.setQueryData<InfiniteData<MessagesPage>>(vqk.messages(chatId), (d) =>
    d ? { ...d, pages: d.pages.map((p) => ({ ...p, messages: p.messages.map((m) => (m.id === id ? fn(m) : m)) })) } : d,
  );
  const c = get().chats[chatId];
  if (c?.lastMessage?.id === id) upsertChat({ ...c, lastMessage: fn(c.lastMessage) });
}

function onMessage(m: Message) {
  // In den Verlauf (eigene optimistische Nachricht per nonce ersetzen)
  queryClient.setQueryData<InfiniteData<MessagesPage>>(vqk.messages(m.chatId), (d) => {
    if (!d || !d.pages.length) return d;
    const all = d.pages.flatMap((p) => p.messages);
    if (all.some((x) => x.id === m.id)) return d;
    const pages = d.pages.map((p) => ({ ...p, messages: p.messages.filter((x) => !(m.nonce && x.nonce === m.nonce && x.id.startsWith("tmp-"))) }));
    pages[0] = { ...pages[0], messages: [m, ...pages[0].messages] };
    return { ...d, pages };
  });
  if (m.nonce && get().pending[m.nonce]) {
    const { [m.nonce]: _, ...rest } = get().pending;
    set({ pending: rest });
  }
  const mine = m.authorId === get().me?.id;
  // Tippen-Anzeige des Autors beenden
  if (m.authorId && get().typing[m.chatId]?.[m.authorId]) {
    const { [m.authorId]: _, ...rest } = get().typing[m.chatId];
    set({ typing: { ...get().typing, [m.chatId]: rest } });
  }
  const c = get().chats[m.chatId];
  if (!c) {
    client?.chats.get(m.chatId).then(upsertChat, () => {});
  } else {
    const visible = get().activeChat === m.chatId && document.visibilityState === "visible" && document.hasFocus();
    upsertChat({ ...c, lastMessage: m, updatedAt: m.createdAt, unreadCount: mine || visible ? (mine ? c.unreadCount : 0) : c.unreadCount + 1 });
    if (visible && !mine) markRead(m.chatId, m.id);
  }
  if (!mine && m.kind !== "system" && get().activeChat !== m.chatId) {
    const author = c?.members.find((x) => x.user.id === m.authorId)?.user.name ?? get().friends[m.authorId ?? ""]?.user.name ?? "";
    const title = c?.type === "group" ? `${author} · ${c.name ?? ""}` : author;
    notify(title || t("social.toast.message"), m.kind === "invite" ? (m.invite?.title ?? "") : m.content.slice(0, 140), {
      label: t("social.open"),
      onClick: () => openSocial(m.chatId),
    });
  }
}

let readTimer: ReturnType<typeof setTimeout> | null = null;
/** Als gelesen markieren (gebündelt). */
export function markRead(chatId: string, messageId?: string) {
  const c = get().chats[chatId];
  if (c && c.unreadCount) upsertChat({ ...c, unreadCount: 0 });
  if (readTimer) clearTimeout(readTimer);
  readTimer = setTimeout(() => {
    client?.chats.read(chatId, messageId?.startsWith("tmp-") ? undefined : messageId).catch(() => {});
  }, 400);
}

// ------------------------------------------------------------------ Aktionen

export async function sendMessage(chatId: string, content: string) {
  const c = requireClient();
  const nonce = crypto.randomUUID();
  const me = get().me;
  const tmp: Message = {
    id: `tmp-${nonce}`,
    chatId,
    authorId: me?.id ?? null,
    kind: "text",
    content,
    system: null,
    invite: null,
    replyToId: null,
    nonce,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deleted: false,
  };
  set({ pending: { ...get().pending, [nonce]: chatId } });
  queryClient.setQueryData<InfiniteData<MessagesPage>>(vqk.messages(chatId), (d) => {
    if (!d || !d.pages.length) return d;
    const pages = d.pages.slice();
    pages[0] = { ...pages[0], messages: [tmp, ...pages[0].messages] };
    return { ...d, pages };
  });
  try {
    const m = await c.chats.send(chatId, content, { nonce });
    onMessage(m);
  } catch (e) {
    queryClient.setQueryData<InfiniteData<MessagesPage>>(vqk.messages(chatId), (d) =>
      d ? { ...d, pages: d.pages.map((p) => ({ ...p, messages: p.messages.filter((x) => x.id !== tmp.id) })) } : d,
    );
    const { [nonce]: _, ...rest } = get().pending;
    set({ pending: rest });
    throw e;
  }
}

let lastTyping = 0;
export function sendTyping(chatId: string) {
  if (Date.now() - lastTyping < 3000) return;
  lastTyping = Date.now();
  if (gateway?.state === "ready") gateway.typing(chatId);
  else client?.chats.typing(chatId).catch(() => {});
}

/** DM öffnen (holt bestehenden Chat oder legt an). */
export async function openDm(userId: string): Promise<Chat> {
  const c = requireClient();
  const existing = Object.values(get().chats).find((x) => x.type === "dm" && x.members.some((m) => m.user.id === userId));
  if (existing) return existing;
  const chat = await c.chats.openDm(userId);
  upsertChat(chat);
  return chat;
}

export async function refreshRequests() {
  const c = client;
  if (!c) return;
  const r = await c.friends.requests();
  set({ requests: r });
}

export function removeInviteLocal(id: string) {
  set({ invites: get().invites.filter((x) => x.id !== id) });
}

export function removeFriendLocal(userId: string) {
  const { [userId]: _, ...rest } = get().friends;
  set({ friends: rest });
}

// ------------------------------------------------------------------ Navigation / Toasts (von außen gesetzt)

type Notifier = (title: string, text?: string, action?: { label: string; onClick: () => void }) => void;
let notifier: Notifier = () => {};
let opener: (chatId?: string) => void = () => {};
export function setSocialHooks(n: Notifier, o: (chatId?: string) => void) {
  notifier = n;
  opener = o;
}
// Kurz hintereinander eintreffende Benachrichtigungen (z. B. nach dem Verbinden) zu einem Toast bündeln.
let notifyQueue: { title: string; text?: string; action?: { label: string; onClick: () => void } }[] = [];
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
function notify(title: string, text?: string, action?: { label: string; onClick: () => void }) {
  if (!cfg.social) return;
  notifyQueue.push({ title, text, action });
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    const q = notifyQueue;
    notifyQueue = [];
    notifyTimer = null;
    if (q.length <= 2) {
      for (const n of q) notifier(n.title, n.text, n.action);
    } else {
      const names = [...new Set(q.map((n) => n.title.split(" · ")[0]))].slice(0, 3).join(", ");
      notifier(t("social.toast.many", { count: q.length }), names, { label: t("social.open"), onClick: () => openSocial() });
    }
  }, 1200);
}
export function openSocial(chatId?: string) {
  opener(chatId);
}

// ------------------------------------------------------------------ Presence (automatisch)

let lastPresence = "";
let instancesRef: Instance[] = [];
let serversRef: Server[] = [];

export function setPresenceSources(instances: Instance[], servers: Server[]) {
  instancesRef = instances;
  serversRef = servers;
  pushPresence();
}

function currentPresence(): { status: PresenceStatusSetting; activity: Activity | null } {
  if (!cfg.presence) return { status: "invisible", activity: null };
  const states = useGameStore.getState().states;
  const running = instancesRef.filter((i) => states[i.id]?.state === "running" || states[i.id]?.state === "preparing");
  if (running.length) {
    const i = running[0];
    const st = states[i.id];
    return {
      status: "online",
      activity: {
        type: "playing",
        instanceId: i.id,
        instanceName: i.name.slice(0, 100),
        mcVersion: i.mc_version,
        loader: i.loader.kind,
        joinable: false,
        startedAt: st?.started_at ? new Date(st.started_at).toISOString() : null,
      },
    };
  }
  const statuses = useServerStore.getState().statuses;
  const hosted = serversRef.find((s) => statuses[s.id]?.state === "running" && statuses[s.id]?.tunnel?.kind === "relay" && statuses[s.id]?.tunnel?.address);
  if (hosted && cfg.hosting) {
    const st = statuses[hosted.id];
    return {
      status: "online",
      activity: {
        type: "hosting",
        instanceName: hosted.name.slice(0, 100),
        world: hosted.name.slice(0, 100),
        mcVersion: hosted.mc_version,
        loader: hosted.loader.kind,
        joinable: false,
        startedAt: st?.started_at ? new Date(st.started_at).toISOString() : null,
      },
    };
  }
  return { status: "online", activity: { type: "launcher", joinable: false } };
}

/** Status ans Gateway schicken, wenn er sich geändert hat. */
export function pushPresence(force = false) {
  const gw = gateway;
  if (!gw) return;
  const p = currentPresence();
  const key = JSON.stringify({ s: p.status, a: p.activity && { ...p.activity, startedAt: undefined } });
  if (!force && key === lastPresence) return;
  lastPresence = key;
  gw.setPresence(p);
}

useGameStore.subscribe((s, prev) => {
  if (s.states !== prev.states) pushPresence();
});
useServerStore.subscribe((s, prev) => {
  if (s.statuses !== prev.statuses) pushPresence();
});
