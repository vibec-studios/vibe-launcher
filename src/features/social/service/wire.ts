import { queryClient } from "@/lib/queries";
import type { Friend, VibeGateway } from "@/lib/vibe-sdk";
import { t } from "@/i18n";
import { accessDenied } from "@/features/access/store";
import { isAccessCode } from "@/features/access/types";
import { onMessage, patchMessage, reloadState, upsertChat } from "./chats";
import { extraListeners } from "./gateway";
import { blockServices } from "./lifecycle";
import { notify, openSocial } from "./notify";
import { pushPresence } from "./presence";
import { rt } from "./runtime";
import { empty, get, set, vqk } from "./store";

// ------------------------------------------------------------------ Gateway -> Store

export function wireGateway(gw: VibeGateway) {
  const on: VibeGateway["on"] = (ev, fn) => {
    const off = gw.on(ev, fn);
    rt.offGateway.push(off);
    return off;
  };

  on("state", (s) => {
    if (s === "ready") {
      rt.failedAttempts = 0;
      set({ conn: "ready", error: null });
    } else if (s === "reconnecting") set({ conn: rt.failedAttempts >= 2 ? "offline" : "reconnecting" });
    else if (s === "connecting") set({ conn: get().conn === "offline" ? "offline" : "connecting" });
  });
  on("disconnected", ({ code, reason, fatal }) => {
    if (code === 1006) rt.failedAttempts++;
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
    rt.lastPresence = "";
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
