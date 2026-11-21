import type { AcceptInviteResult, Chat, CreateInviteBody, CreateReportBody, Friend, FriendRequest, Invite, Message, Notification, Presence, PublicUser, SetPresenceBody } from "../types";
import { VibeAccountClient } from "./account";
import { enc } from "./http";

export class VibeSocialClient extends VibeAccountClient {
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

  // ---------------- Benachrichtigungen / Meldungen ----------------

  readonly notifications = {
    list: (o: { unread?: boolean; before?: string; limit?: number } = {}) =>
      this.get<{ notifications: Notification[]; unreadCount: number }>("/api/v1/notifications", o),
    markRead: (ids: string[]) => this.post<void>("/api/v1/notifications/read", { ids }),
    markAllRead: () => this.post<void>("/api/v1/notifications/read", { all: true }),
    delete: (id: string) => this.del(`/api/v1/notifications/${enc(id)}`),
  };

  report = (body: CreateReportBody) => this.post<{ id: string }>("/api/v1/reports", body);
}
