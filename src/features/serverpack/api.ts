import { invoke } from "@tauri-apps/api/core";
import type { Loader, Side } from "@/lib/types";

export type PackInput = { kind: "instance"; id: string } | { kind: "file"; path: string };

export interface PackEntry {
  path: string;
  name: string;
  side: Side;
  enabled: boolean;
  include: boolean;
  origin: "download" | "local" | "archive";
  size: number | null;
}

export interface TargetDiff {
  server_id: string;
  name: string;
  mc_from: string;
  loader_from: Loader;
  platform: string | null;
  changes_software: boolean;
  running: boolean;
  managed: string | null;
  removes: string[];
}

export interface PackPreview {
  name: string;
  version_name: string | null;
  format: "instance" | "mrpack" | "curseforge" | "vlpack" | "prism" | "multimc";
  mc_version: string;
  loader: Loader;
  entries: PackEntry[];
  config_files: number;
  config_dirs: string[];
  client_skipped: number;
  missing: string[];
  warnings: string[];
  worlds: string[];
  target: TargetDiff | null;
}

export type ApplyTarget = { kind: "new"; name: string; port?: number | null; memory_mb?: number | null } | { kind: "existing"; id: string };

export interface PackOptions {
  selected: string[] | null;
  configs: boolean;
  world: string | null;
}

export interface PackApplied {
  server_id: string;
  task_id: string;
}

export interface BundleInfo {
  path: string;
  file_name: string;
  size: number;
  sha256: string;
  name: string;
  mc_version: string;
  loader: Loader;
  files: number;
  embedded: number;
}

export interface PackManifest {
  name: string;
  version_name: string | null;
  format: string;
  mc_version: string;
  loader: Loader | null;
  files: string[];
  applied_at: number;
}

export interface PackSnapshot {
  name: string;
  created: number;
  size: number;
  label: string | null;
  mc_version: string | null;
  loader: Loader | null;
}

export interface PackStatus {
  manifest: PackManifest | null;
  snapshots: PackSnapshot[];
}

export const packApi = {
  preview: (input: PackInput, serverId: string | null) => invoke<PackPreview>("server_pack_preview", { input, serverId }),
  apply: (input: PackInput, target: ApplyTarget, options: PackOptions) => invoke<PackApplied>("server_pack_apply", { req: { input, target, options } }),
  bundle: (input: PackInput, options: PackOptions) => invoke<BundleInfo>("server_pack_bundle", { input, options }),
  status: (id: string) => invoke<PackStatus>("server_pack_status", { id }),
  restore: (id: string, name: string) => invoke<string>("server_pack_restore", { id, name }),
  deleteSnapshot: (id: string, name: string) => invoke<void>("server_pack_snapshot_delete", { id, name }),
};

export const pqk = {
  preview: (input: PackInput | null, serverId: string | null) => ["server-pack-preview", input, serverId] as const,
  status: (id: string) => ["server-pack-status", id] as const,
};
