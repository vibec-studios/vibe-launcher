// Typen der Cosmetics- und Vibey-Client-API. Katalog/Loadout aus `@vibe-craft/shared` (vibe-backend,
// packages/shared/src/cosmetics.ts), Einreichungen und Client-Verteilung nach docs/VIBE-API-2.md §2–4.

export const COSMETIC_SLOTS = ["cape", "wings", "aura", "pet", "shield", "hat", "back"] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];
export type Category = CosmeticSlot | "emote";
export const CATEGORIES: Category[] = [...COSMETIC_SLOTS, "emote"];
export type Rarity = "common" | "rare" | "epic" | "legendary";
export const EMOTE_WHEEL_SIZE = 8;

export interface LocalizedName {
  en: string;
  de?: string;
}

export interface CatalogItem {
  id: string;
  kind: "cosmetic" | "emote";
  slot: CosmeticSlot | null;
  name: LocalizedName;
  description: { en?: string; de?: string };
  author: string;
  tags: string[];
  rarity: Rarity;
  availability: "default" | "granted";
  asset: { hash: string; size: number; url: string };
  thumbnailUrl: string | null;
  sort: number;
  createdAt: string;
  updatedAt: string;
  /** Freigegebene Creator-Einreichung (VIBE-API-2 §3) */
  creator?: { uuid: string; name: string } | null;
}

export interface Catalog {
  version: string;
  items: CatalogItem[];
  /** Nur Launcher: letzter Stand von der Platte (Vibe aus oder Server nicht erreichbar) */
  cached?: boolean;
}

export type LoadoutSlots = Partial<Record<CosmeticSlot, string | null>>;

export interface Loadout {
  slots: LoadoutSlots;
  emoteWheel: (string | null)[];
}

export interface CosmeticsMe {
  owned: string[];
  loadout: Loadout;
}

export type SubmissionStatus = "pending" | "approved" | "rejected" | "withdrawn";

export interface Submission {
  id: string;
  name: string;
  description: string;
  kind: "cosmetic" | "emote";
  status: SubmissionStatus;
  reason?: string | null;
  itemId?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  assetUrl: string;
  thumbnailUrl?: string | null;
}

// ---------- Vibey Client (Rust: src-tauri/src/vibey_client) ----------

export interface ClientFile {
  loader: string;
  mcVersions: string[];
  file: string;
  size: number;
  sha256: string;
  url: string;
  requires: { modrinth?: string | null; name?: string | null }[];
}

export interface ClientRelease {
  version: string;
  channel: string;
  publishedAt: string | null;
  changelog: string | null;
  files: ClientFile[];
  blockbench: { version: string; file: string; size: number; sha256: string; url: string } | null;
}

export interface ClientStatus {
  enabled: boolean;
  installed_version: string | null;
  file: string | null;
  present: boolean;
  disabled_by_user: boolean;
  loader_supported: boolean;
  supported: boolean | null;
  latest_version: string | null;
  update_available: boolean;
  mc_versions: string[];
  channel: string;
  vibe_enabled: boolean;
  error: string | null;
  requires: string[];
}

export interface VibeyInstance {
  instance_id: string;
  name: string;
  mc_version: string;
  loader: string;
  version: string | null;
  game_dir: string;
  devlink: boolean;
}

export interface BlockbenchStatus {
  blockbench: string | null;
  plugin_path: string;
  plugin_present: boolean;
  plugin_version: string | null;
  registered: boolean | null;
  latest_version: string | null;
  /** Älteste Vibey-Client-Version, mit der Live-Link/Einreichen gehen */
  min_client?: string | null;
  notes?: string | null;
  update_available: boolean;
  error: string | null;
}
