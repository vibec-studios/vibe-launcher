import type { PublicUser } from "./users";

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
  followers?: number;
  following?: boolean;
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
