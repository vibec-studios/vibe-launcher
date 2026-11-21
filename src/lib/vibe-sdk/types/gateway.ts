import type { HostKickEvent, HostPanelUpdatedEvent, HostSessionEvent, PackFollow, PackRemovedEvent, PackVersionPublishedEvent } from "../types-social";
import type { Me, PublicUser } from "./users";
import type { Presence } from "./presence";
import type { Friend, FriendRequest } from "./friends";
import type { Chat, Message } from "./chats";
import type { Invite } from "./invites";
import type { Notification } from "./notifications";
import type { HostSession } from "./hosting";

// ---------- Gateway ----------

export const GATEWAY_VERSION = 1;

export interface ReadyPayload {
  sessionId: string;
  heartbeatInterval: number;
  user: Me;
  friends: Friend[];
  features: Record<string, boolean>;
}

export interface GatewayEvents {
  "presence.update": Presence;
  "friend.request": FriendRequest;
  "friend.request.removed": { id: string; userId: string; reason: "cancelled" | "declined" | "accepted" };
  "friend.added": Friend;
  "friend.removed": { userId: string };
  "user.blocked": { userId: string };
  "user.unblocked": { userId: string };
  "user.updated": PublicUser;
  "me.updated": Me;
  "chat.created": Chat;
  "chat.updated": Chat;
  "chat.removed": { chatId: string };
  "chat.read": { chatId: string; userId: string; messageId: string };
  "message.created": Message;
  "message.updated": Message;
  "message.deleted": { chatId: string; messageId: string };
  typing: { chatId: string; userId: string; until: string };
  "invite.received": Invite;
  "invite.updated": Invite;
  "hosting.update": HostSession;
  "hosting.ended": { id: string; hostId: string; reason: string | null };
  "notification.created": Notification;
  "settings.updated": { features: Record<string, boolean>; motd: string | null };
  "session.revoked": { reason: string };
  "pack.version.published": PackVersionPublishedEvent;
  "pack.follow.updated": PackFollow;
  "pack.removed": PackRemovedEvent;
  "hosting.panel.updated": HostPanelUpdatedEvent;
  "hosting.kick": HostKickEvent;
  "hosting.event": HostSessionEvent;
}
export type GatewayEventName = keyof GatewayEvents;

export type ServerMessage =
  | { op: "hello"; d: { heartbeatInterval: number; version: number } }
  | { op: "ready"; d: ReadyPayload }
  | { op: "resumed"; d: { sessionId: string; replayed: number } }
  | { op: "invalid_session"; d: { reason: string } }
  | { op: "pong"; d: { at: number } }
  | { op: "error"; d: { code: string; message: string } }
  | { [K in GatewayEventName]: { op: "event"; t: K; s: number; d: GatewayEvents[K] } }[GatewayEventName];
