import type { InfiniteData } from "@tanstack/react-query";
import { queryClient } from "@/lib/queries";
import type { Chat, Message } from "@/lib/vibe-sdk";
import { onMessage, upsertChat } from "./chats";
import { requireClient, rt } from "./runtime";
import { get, set, vqk, type MessagesPage } from "./store";

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
  if (rt.gateway?.state === "ready") rt.gateway.typing(chatId);
  else rt.client?.chats.typing(chatId).catch(() => {});
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
  const c = rt.client;
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
