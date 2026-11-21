import type { LoaderKind } from "./instances";

// ------------------------------------------------------------------ Client-Packs

export type ClientPackId = "vibey" | "norisk" | "norisk-mini" | "essential" | (string & {});

export interface ClientPackInstall {
  version: string | null;
  files: string[];
  mc_version: string | null;
  loader: string | null;
  installed_at: number | null;
  disabled_by_user: boolean;
  missing: boolean;
  mismatch: boolean;
}

export interface ClientPackOffer {
  id: ClientPackId;
  category: "official" | "community";
  source: "vibe" | "norisk" | "modrinth";
  /** Packs derselben Gruppe schließen sich aus ("client") */
  group: string | null;
  vendor: string | null;
  homepage: string | null;
  projects: string[];
  /** null = unbekannt (Quelle nicht erreichbar) */
  available: boolean | null;
  reason: "loader" | "version" | "vibe_off" | "unreachable" | null;
  error: string | null;
  mc_versions: string[];
  latest_version: string | null;
  update_available: boolean;
  installed: ClientPackInstall | null;
}

export interface ClientPacksOverview {
  mc_version: string;
  loader: LoaderKind;
  vibe_enabled: boolean;
  packs: ClientPackOffer[];
}
