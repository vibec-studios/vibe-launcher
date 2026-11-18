// Typen der öffentlichen Vibe-API (v1) – aus `@vibe-craft/shared` (vibe-backend/packages/shared, MIT)
// als reine TypeScript-Typen übernommen (ohne Zod, ohne Admin- und interne Relay-API).
// Protokoll: REST `/api/v1/*` + Gateway `/ws` (Überblick in docs/CONTRACT.md, Abschnitt „Vibe-Dienste“).

// ---------- Allgemein ----------

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; retryAfter?: number };
}

// ---------- Nutzer ----------

export type PrivacyLevel = "everyone" | "friends_of_friends" | "friends" | "nobody";

export interface Privacy {
  friendRequests: PrivacyLevel;
  directMessages: PrivacyLevel;
  invites: PrivacyLevel;
  showHosting: boolean;
}

export interface Skin {
  url: string | null;
  model: "classic" | "slim";
  capeUrl: string | null;
}

export type UserBadge = "user" | "supporter" | "staff";

export interface PublicUser {
  /** Minecraft-UUID mit Bindestrichen */
  id: string;
  name: string;
  skin: Skin;
  statusText: string | null;
  badge: UserBadge;
  createdAt: string;
}

export interface EffectiveLimits {
  maxHosts: number;
  maxPlayersPerHost: number | null;
  maxPacks: number;
  maxFriends: number;
  maxPackOverridesMb: number;
}

export interface Me extends PublicUser {
  privacy: Privacy;
  limits: EffectiveLimits;
  presenceStatus: "online" | "away" | "busy" | "invisible";
}

export interface UpdateMeBody {
  statusText?: string | null;
  privacy?: Partial<Privacy>;
}

export type Relationship = "none" | "friend" | "incoming" | "outgoing" | "blocked" | "blocked_by" | "self";

export interface UserWithRelationship extends PublicUser {
  relationship: Relationship;
}

export interface ClientInfo {
  name: string;
  version: string;
  platform: string;
}

export interface DeviceSession {
  id: string;
  client: ClientInfo;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

export interface ServerMeta {
  name: string;
  version: string;
  apiVersion: 1;
  motd: string | null;
  features: { registration: boolean; chat: boolean; sharing: boolean; hosting: boolean; invites: boolean };
  limits: { chatMessageMaxLength: number; maxGroupMembers: number };
  publicUrl: string;
}

// ---------- Auth ----------

export interface ChallengeResult {
  serverId: string;
  expiresAt: string;
}

export interface TokenPair {
  accessToken: string;
  /** Sekunden bis zum Ablauf des Access-Tokens */
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: string;
  sessionId: string;
}

export interface AuthResult extends TokenPair {
  user: Me;
  created: boolean;
}

// ---------- Presence ----------

export type PresenceStatusSetting = "online" | "away" | "busy" | "invisible";
export type PresenceStatus = "online" | "away" | "busy" | "offline";

export interface JoinInfo {
  type: "relay" | "playit" | "direct" | "invite";
  address: string | null;
  port?: number | null;
  hostSessionId?: string | null;
}

export interface Activity {
  type: "playing" | "launcher" | "hosting";
  instanceId?: string | null;
  instanceName?: string | null;
  mcVersion?: string | null;
  loader?: string | null;
  server?: string | null;
  world?: string | null;
  joinable?: boolean;
  join?: JoinInfo | null;
  startedAt?: string | null;
}

export interface Presence {
  userId: string;
  status: PresenceStatus;
  activity: Activity | null;
  updatedAt: string;
}

export interface SetPresenceBody {
  status?: PresenceStatusSetting;
  activity?: Activity | null;
}

// ---------- Freunde ----------

export interface Friend {
  user: PublicUser;
  since: string;
  presence: Presence;
}

export interface FriendRequest {
  id: string;
  from: PublicUser;
  to: PublicUser;
  createdAt: string;
  direction: "incoming" | "outgoing";
}

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

// ---------- Einladungen ----------

export type InviteKind = "world" | "server" | "party" | "modpack";
export type InviteStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

export interface InviteTarget {
  name: string;
  mcVersion?: string | null;
  loader?: string | null;
  instanceName?: string | null;
  packCode?: string | null;
}

export interface Invite {
  id: string;
  kind: InviteKind;
  from: PublicUser;
  toUserId: string | null;
  chatId: string | null;
  target: InviteTarget;
  message: string | null;
  hostSessionId: string | null;
  status: InviteStatus;
  myResponse: "accepted" | "declined" | null;
  createdAt: string;
  expiresAt: string;
}

export interface CreateInviteBody {
  kind: InviteKind;
  toUserIds?: string[];
  chatId?: string;
  target: InviteTarget;
  message?: string;
  hostSessionId?: string;
  connection?: { type: "relay" | "playit" | "direct"; address: string; port?: number };
  ttlMinutes?: number;
}

export interface AcceptInviteResult {
  invite: Invite;
  connection: { type: "relay" | "playit" | "direct"; address: string; port: number | null } | null;
  packCode: string | null;
}

// ---------- Benachrichtigungen / Meldungen ----------

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
}

export type ReportReason = "spam" | "harassment" | "cheating" | "inappropriate" | "impersonation" | "malware" | "other";

export interface CreateReportBody {
  targetType: "message" | "user" | "pack";
  targetId: string;
  reason: ReportReason;
  details?: string;
}

// ---------- Geteilte Modpacks ----------

export interface VlpackFile {
  path: string;
  source: string;
  project_id?: string | null;
  version_id?: string | null;
  file_id?: string | null;
  url: string;
  sha1?: string | null;
  size?: number | null;
}

/** `vlpack.json` (docs/VLPACK.md). Unbekannte Felder bleiben erhalten. */
export interface VlpackManifest {
  format_version: 1;
  name: string;
  version?: string | null;
  author?: string | null;
  description?: string | null;
  mc_version: string;
  loader: { kind: "vanilla" | "fabric" | "quilt" | "forge" | "neoforge"; version?: string | null };
  icon?: string | null;
  files: VlpackFile[];
  [extra: string]: unknown;
}

export type PackVisibility = "public" | "unlisted" | "friends";

export interface PackVersion {
  id: string;
  version: string;
  changelog: string | null;
  mcVersion: string;
  loader: string;
  loaderVersion: string | null;
  fileCount: number;
  overrides: { size: number; sha256: string; url: string } | null;
  createdAt: string;
}

export interface Pack {
  id: string;
  code: string;
  /** https://…/p/<code> */
  url: string;
  /** vibelauncher://pack/<code> */
  deepLink: string;
  name: string;
  description: string | null;
  owner: PublicUser;
  visibility: PackVisibility;
  mcVersion: string;
  loader: string;
  iconUrl: string | null;
  downloads: number;
  latestVersion: PackVersion | null;
  status: "active" | "hidden" | "removed";
  createdAt: string;
  updatedAt: string;
}

export interface PackDownload {
  pack: Pack;
  version: PackVersion;
  manifest: VlpackManifest;
}

export interface UpdatePackBody {
  name?: string;
  description?: string | null;
  visibility?: PackVisibility;
}

// ---------- Hosting ----------

export interface HostPlayer {
  name: string;
  uuid: string | null;
  joinedAt: string;
}

export interface HostSession {
  id: string;
  host: PublicUser;
  kind: "world" | "server";
  client: "mod" | "launcher";
  slot: number;
  address: string | null;
  mcVersion: string | null;
  status: "authorized" | "online" | "ended";
  players: HostPlayer[];
  maxPlayers: number | null;
  startedAt: string;
  onlineAt: string | null;
  endedAt: string | null;
  endReason: string | null;
}

export interface HostingLimits {
  enabled: boolean;
  maxHosts: number;
  maxPlayersPerHost: number | null;
  active: number;
}

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
