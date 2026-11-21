export interface FileEntry {
  name: string;
  dir: boolean;
  size: number;
  modified: number;
}

export interface FileListing {
  path: string;
  entries: FileEntry[];
}

export type AddonSource = "modrinth" | "hangar";

export interface AddonTarget {
  folder: "plugins" | "mods";
  plugins: boolean;
  loaders: string[];
  mc: string;
  hangar: string | null;
}

export interface Addon {
  file_name: string;
  enabled: boolean;
  size: number;
  modified: number;
  name: string | null;
  version: string | null;
  authors: string[];
  description: string | null;
  icon: string | null;
  sha1: string | null;
  source: AddonSource | null;
  project_id: string | null;
  slug: string | null;
  version_id: string | null;
  title: string | null;
  page_url: string | null;
}

export interface AddonList {
  target: AddonTarget;
  items: Addon[];
}

export interface AddonCompat {
  ok: boolean;
  reason: string | null;
  version: string | null;
}

export interface AddonHit {
  source: AddonSource;
  id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  icon_url: string | null;
  downloads: number;
  updated: string | null;
  page_url: string;
  compat: AddonCompat;
}

export interface AddonSearch {
  hits: AddonHit[];
  total: number;
  offset: number;
}

export interface McVersion {
  id: string;
  type: string;
  release_time: string;
}

export interface LoaderVersion {
  version: string;
  stable: boolean;
}
export interface PlatformVersion {
  id: string;
  release: boolean;
  supported: boolean;
  java_min: number | null;
}
