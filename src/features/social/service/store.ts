// Vibe-Dienste im Frontend: ein VibeClient + VibeGateway (vendored SDK) für den aktiven Minecraft-Account.
// Gateway-Events landen im Zustand-Store (Freunde, Presence, Chats, Tippen, Einladungen, Hosts) bzw. im
// Query-Cache (Nachrichtenverlauf). Nichts hier blockiert den Rest des Launchers: Fehler/Offline setzen nur
// `conn`/`error`, die UI zeigt dann einen freundlichen Zustand.
//
// Netzwerk gibt es nur, wenn `settings.vibe.enabled` an ist (zusätzlich in Rust gesperrt, Standard: an). Ist ein
// Minecraft-Account angemeldet, verbindet der Launcher sich automatisch mit Vibe (Mojang-join, Tokens im
// Schlüsselbund) – außer der Nutzer hat für diesen Account „Verknüpfung lösen“ gewählt (bis zum nächsten
// bewussten „Verbinden“).
import { create } from "zustand";
import type { Chat, Friend, FriendRequest, HostSession, Invite, Me, Message } from "@/lib/vibe-sdk";

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

export interface SocialState {
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

export function lsGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
export function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* egal */
  }
}

export const empty = {
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

export function unlinkedScopes(): string[] {
  try {
    const v = JSON.parse(lsGet(UNLINKED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function setUnlinked(scope: string, on: boolean) {
  const list = unlinkedScopes().filter((x) => x !== scope);
  if (on) list.push(scope);
  lsSet(UNLINKED_KEY, JSON.stringify(list.slice(-50)));
  if (get().scope === scope) set({ unlinked: on });
}

export function setPanelOpen(open: boolean) {
  lsSet("vibe.panel", open ? "1" : "0");
  useSocial.setState({ panelOpen: open });
}

export const set = useSocial.setState;
export const get = useSocial.getState;
