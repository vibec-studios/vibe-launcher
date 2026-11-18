// Plugin-Server-Software (Paper/Purpur/Folia) und Erweiterungen (plugins/ bzw. mods/) eines Servers.
import { invoke } from "@tauri-apps/api/core";
import type { Server, ServerPlatformKind } from "@/lib/types";

export interface PlatformVersion {
  id: string;
  /** Release (keine -pre/-rc) */
  release: boolean;
  /** Von den Entwicklern noch unterstützt */
  supported: boolean;
  java_min: number | null;
}

export type BuildChannel = "stable" | "beta" | "alpha";

export interface PlatformBuild {
  id: string;
  channel: BuildChannel;
  time: string | null;
  summary: string | null;
  file_name: string;
  url: string;
  size: number | null;
  sha256: string | null;
  md5: string | null;
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
  sha1: string | null;
  name: string | null;
  version: string | null;
  authors: string[];
  description: string | null;
  icon: string | null;
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
}

export interface AddonSearch {
  hits: AddonHit[];
  total: number;
  offset: number;
}

export interface AddonUpdate {
  file_name: string;
  source: AddonSource;
  project_id: string;
  current: string | null;
  latest: string;
}

export const platformNames: Record<ServerPlatformKind, string> = {
  paper: "Paper",
  purpur: "Purpur",
  folia: "Folia",
};
export const PLATFORMS: ServerPlatformKind[] = ["paper", "purpur", "folia"];

export const addonApi = {
  platformVersions: (kind: ServerPlatformKind) => invoke<PlatformVersion[]>("server_platform_versions", { kind }),
  platformBuilds: (kind: ServerPlatformKind, mc: string) => invoke<PlatformBuild[]>("server_platform_builds", { kind, mc }),
  /** Startet die Installation des Builds (Task-ID); null = neuester stabiler */
  platformSetBuild: (id: string, build: string | null) => invoke<string>("server_platform_set_build", { id, build }),
  list: (id: string) => invoke<AddonList>("server_addons", { id }),
  search: (id: string, source: AddonSource, query: string, sort: string, offset: number) =>
    invoke<AddonSearch>("server_addon_search", {
      id,
      source,
      query,
      sort,
      offset,
    }),
  install: (id: string, source: AddonSource, project: string) => invoke<string[]>("server_addon_install", { id, source, project }),
  updates: (id: string) => invoke<AddonUpdate[]>("server_addon_updates", { id }),
  update: (id: string, files: string[] | null) => invoke<number>("server_addon_update", { id, files }),
  setEnabled: (id: string, file: string, enabled: boolean) => invoke<string>("server_addon_set_enabled", { id, file, enabled }),
  remove: (id: string, file: string) => invoke<void>("server_addon_remove", { id, file }),
};

export const aqk = {
  platformVersions: (kind: ServerPlatformKind) => ["server-platform-versions", kind] as const,
  platformBuilds: (kind: ServerPlatformKind, mc: string) => ["server-platform-builds", kind, mc] as const,
  addons: (id: string) => ["server-addons", id] as const,
  updates: (id: string) => ["server-addon-updates", id] as const,
  search: (id: string, source: AddonSource, q: string, sort: string) => ["server-addon-search", id, source, q, sort] as const,
};

/** „Paper 26.3 (Build 255)“ bzw. Loader-Text. */
export function serverSoftware(s: Server, formatLoader: (l: Server["loader"]) => string): string {
  if (s.platform) return `${platformNames[s.platform.kind]}${s.platform.build ? ` #${s.platform.build}` : ""}`;
  return formatLoader(s.loader);
}
