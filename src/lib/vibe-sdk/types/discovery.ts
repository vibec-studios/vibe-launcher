import type { TokenPair } from "./auth";
import type { ReportReason } from "./notifications";
import type { VlpackManifest } from "./packs";

// ---------- Screenshots, Aktivitäten, Server entdecken, Cloud-Einstellungen, Geräte-Kopplung (Welle 3) ----------

export type ScreenshotVisibility = "private" | "friends" | "link";

export interface Screenshot {
  id: string;
  userId: string;
  visibility: ScreenshotVisibility;
  contentType: "image/png" | "image/jpeg";
  size: number;
  createdAt: string;
  imagePath: string;
  sharePath: string | null;
}

export interface ScreenshotList {
  screenshots: Screenshot[];
  usedBytes: number;
  quotaBytes: number;
  maxUploadBytes: number;
}

export interface ScreenshotReport {
  reason: ReportReason;
  details?: string;
  key?: string;
}

export interface FeedPreferences {
  enabled: boolean;
}

export type FeedEventType = "played" | "created_instance";

interface FeedItemBase {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
}

export type FeedItem = (FeedItemBase & { type: "screenshot"; imagePath: string }) | (FeedItemBase & { type: FeedEventType });

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
}

export type DiscoveryCategory = "survival" | "creative" | "minigames" | "pvp" | "roleplay" | "other";

export interface DiscoveryInput {
  name: string;
  address: string;
  description: string;
  category: DiscoveryCategory;
}

export interface DiscoveryServer extends DiscoveryInput {
  id: string;
}

export interface DiscoverySubmission extends DiscoveryServer {
  userId: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export interface CloudSnapshot {
  version: 1;
  settings: Record<string, unknown>;
  instances: { id: string; manifest: VlpackManifest }[];
}

export interface CloudSettings {
  revision: number;
  snapshot: CloudSnapshot | null;
}

export interface DeviceStart {
  code: string;
  deviceToken: string;
  expiresIn: number;
  interval: number;
}

export type DevicePoll = { status: "pending" } | { status: "authorized"; tokens: TokenPair };
