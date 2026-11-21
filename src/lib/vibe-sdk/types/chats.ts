import type { PublicUser } from "./users";
import type { InviteKind } from "./invites";

// ---------- Chats ----------

export interface ChatMember {
  user: PublicUser;
  role: "owner" | "member";
  joinedAt: string;
  lastReadMessageId: string | null;
}

export interface InviteCard {
  inviteId: string;
  kind: InviteKind;
  title: string;
  subtitle: string | null;
  packCode: string | null;
  expiresAt: string;
}

export interface SystemPayload {
  event: "member_added" | "member_removed" | "member_left" | "renamed" | "chat_created" | "owner_changed";
  actorId: string | null;
  targetId?: string | null;
  name?: string | null;
}

export interface Message {
  id: string;
  chatId: string;
  authorId: string | null;
  kind: "text" | "system" | "invite";
  content: string;
  system: SystemPayload | null;
  invite: InviteCard | null;
  replyToId: string | null;
  nonce: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

export interface Chat {
  id: string;
  type: "dm" | "group";
  name: string | null;
  ownerId: string | null;
  members: ChatMember[];
  lastMessage: Message | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}
