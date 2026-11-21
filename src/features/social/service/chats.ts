import type { InfiniteData } from "@tanstack/react-query";
import { queryClient } from "@/lib/queries";
import type { Chat, HostSession, Message } from "@/lib/vibe-sdk";
import { t } from "@/i18n";
import { notify, openSocial } from "./notify";
import { rt } from "./runtime";
import { get, set, vqk, type MessagesPage, type SocialState } from "./store";

export async function reloadState() {
  const c = rt.client;
  if (!c) return;
  const [requests, chats, invites, hosts] = await Promise.allSettled([c.friends.requests(), c.chats.list(), c.invites.list("incoming", true), c.hosting.friends()]);
  if (c !== rt.client) return;
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

export function upsertChat(c: Chat) {
  set({ chats: { ...get().chats, [c.id]: c } });
}

export function patchMessage(chatId: string, id: string, fn: (m: Message) => Message) {
  queryClient.setQueryData<InfiniteData<MessagesPage>>(vqk.messages(chatId), (d) =>
    d ? { ...d, pages: d.pages.map((p) => ({ ...p, messages: p.messages.map((m) => (m.id === id ? fn(m) : m)) })) } : d,
  );
  const c = get().chats[chatId];
  if (c?.lastMessage?.id === id) upsertChat({ ...c, lastMessage: fn(c.lastMessage) });
}

export function onMessage(m: Message) {
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
    rt.client?.chats.get(m.chatId).then(upsertChat, () => {});
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
    rt.client?.chats.read(chatId, messageId?.startsWith("tmp-") ? undefined : messageId).catch(() => {});
  }, 400);
}
