// Typen der öffentlichen Vibe-API (v1) – aus `@vibe-craft/shared` (vibe-backend/packages/shared, MIT)
// als reine TypeScript-Typen übernommen (ohne Zod, ohne Admin- und interne Relay-API).
// Protokoll: REST `/api/v1/*` + Gateway `/ws` (Überblick in docs/CONTRACT.md, Abschnitt „Vibe-Dienste“).
export * from "../types-social";
export type { ApiErrorBody, PrivacyLevel, Privacy, Skin, UserBadge, PublicUser, EffectiveLimits, Me, UpdateMeBody, Relationship, UserWithRelationship, ClientInfo, DeviceSession, ServerMeta } from "./users";
export type { ChallengeResult, TokenPair, AuthResult } from "./auth";
export type { PresenceStatusSetting, PresenceStatus, JoinInfo, Activity, Presence, SetPresenceBody } from "./presence";
export type { Friend, FriendRequest } from "./friends";
export type { ChatMember, InviteCard, SystemPayload, Message, Chat } from "./chats";
export type { InviteKind, InviteStatus, InviteTarget, Invite, CreateInviteBody, AcceptInviteResult } from "./invites";
export type { Notification, ReportReason, CreateReportBody } from "./notifications";
export type { VlpackFile, VlpackManifest, PackVisibility, PackVersion, Pack, PackDownload, UpdatePackBody } from "./packs";
export type { HostPlayer, HostSession, HostingLimits } from "./hosting";
export { GATEWAY_VERSION } from "./gateway";
export type { ReadyPayload, GatewayEvents, GatewayEventName, ServerMessage } from "./gateway";
export type { ScreenshotVisibility, Screenshot, ScreenshotList, ScreenshotReport, FeedPreferences, FeedEventType, FeedItem, FeedPage, DiscoveryCategory, DiscoveryInput, DiscoveryServer, DiscoverySubmission, CloudSnapshot, CloudSettings, DeviceStart, DevicePoll } from "./discovery";
