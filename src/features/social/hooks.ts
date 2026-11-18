// Selektoren und kleine Helfer für die Social-UI (stabile Referenzen, damit Listen nicht neu rendern).
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useVibe } from "@/lib/vibe";
import type { Chat, Friend, Presence } from "@/lib/vibe-sdk";
import { useSocial, type Conn } from "./service";

export function useConn(): Conn {
  return useSocial((s) => s.conn);
}

/** Verbunden genug, um Daten anzuzeigen (ready oder vorübergehend getrennt mit vorhandenen Daten). */
export function useOnline() {
  return useSocial((s) => s.conn === "ready");
}

const ORDER: Record<string, number> = { online: 0, busy: 1, away: 2, offline: 3 };

export function sortFriends(list: Friend[]) {
  return list.slice().sort((a, b) => {
    const pa = activityRank(a.presence);
    const pb = activityRank(b.presence);
    if (pa !== pb) return pa - pb;
    return a.user.name.localeCompare(b.user.name);
  });
}

function activityRank(p: Presence) {
  const base = ORDER[p.status] ?? 3;
  if (p.status === "offline") return 10;
  return base + (p.activity?.type === "playing" || p.activity?.type === "hosting" ? 0 : 0.5);
}

export function useFriends(): Friend[] {
  const friends = useSocial((s) => s.friends);
  return useMemo(() => sortFriends(Object.values(friends)), [friends]);
}

export function useChatsSorted(): Chat[] {
  const chats = useSocial((s) => s.chats);
  return useMemo(
    () => Object.values(chats).sort((a, b) => Date.parse(b.lastMessage?.createdAt ?? b.updatedAt) - Date.parse(a.lastMessage?.createdAt ?? a.updatedAt)),
    [chats],
  );
}

/** Summe ungelesener Nachrichten + offene eingehende Anfragen + Einladungen (Badge in der Leiste). */
export function useSocialBadge(): number {
  const vibe = useVibe();
  const n = useSocial(
    useShallow((s) => {
      let unread = 0;
      for (const c of Object.values(s.chats)) unread += c.unreadCount;
      return [unread, s.requests.filter((r) => r.direction === "incoming").length, s.invites.length] as const;
    }),
  );
  return vibe.social ? n[0] + n[1] + n[2] : 0;
}

/** Nutzer, die gerade in einem Chat tippen (aktualisiert sich selbst, wenn die Anzeige abläuft). */
export function useTypingUsers(chatId: string): string[] {
  const map = useSocial((s) => s.typing[chatId]);
  const [now, setNow] = useState(() => Date.now());
  const ids = useMemo(() => Object.entries(map ?? {}).filter(([, until]) => until > now).map(([id]) => id), [map, now]);
  useEffect(() => {
    if (!ids.length) return;
    const next = Math.min(...Object.values(map ?? {}).filter((u) => u > Date.now())) - Date.now();
    const h = setTimeout(() => setNow(Date.now()), Math.max(250, Math.min(next + 50, 9000)));
    return () => clearTimeout(h);
  }, [ids, map]);
  return ids;
}

/** Chat-Titel aus Sicht des Nutzers (DM = Name des anderen). */
export function chatTitle(c: Chat, meId: string | undefined): string {
  if (c.type === "group") return c.name ?? "Gruppe";
  return c.members.find((m) => m.user.id !== meId)?.user.name ?? c.members[0]?.user.name ?? "?";
}

export function dmPartner(c: Chat, meId: string | undefined) {
  if (c.type !== "dm") return null;
  return c.members.find((m) => m.user.id !== meId)?.user ?? null;
}

/** Numerische Nachrichten-IDs vergleichen (Backend: fortlaufende Zahlen als String). */
export function idGte(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return a.length !== b.length ? a.length > b.length : a >= b;
  return a >= b;
}
