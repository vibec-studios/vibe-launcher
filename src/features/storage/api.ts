import { invoke } from "@tauri-apps/api/core";

export type FolderKind = "worlds" | "mods" | "config" | "packs" | "screenshots" | "logs" | "cache" | "binaries" | "rebuild" | "map" | "mod_data" | "launcher" | "other";

export type CategoryId =
  | "instances"
  | "mod_caches"
  | "instance_logs"
  | "world_backups"
  | "orphan_world_backups"
  | "snapshots"
  | "game_files"
  | "java"
  | "servers"
  | "store"
  | "cache"
  | "launcher_logs"
  | "other"
  | "vibey"
  | "fast_cache"
  | "webview";

export interface StorageFolder {
  name: string;
  bytes: number;
  kind: FolderKind;
}

export interface InstanceUsage {
  id: string;
  name: string;
  bytes: number;
  shared: number;
  running: boolean;
  folders: StorageFolder[];
}

export interface StorageCategory {
  id: CategoryId;
  bytes: number;
  cleanable: number;
}

export interface StorageUsage {
  root: string;
  total: number;
  shared_saved: number;
  free: number | null;
  categories: StorageCategory[];
  instances: InstanceUsage[];
}

export type CleanTarget = "cache" | "launcher_logs" | "instance_logs" | "mod_caches" | "orphan_world_backups" | "snapshots" | "vibey" | "fast_cache";

export const CLEARABLE_KINDS: FolderKind[] = ["cache", "binaries", "rebuild"];

export const storageKey = ["storage-usage"] as const;

export const storageApi = {
  usage: () => invoke<StorageUsage>("storage_usage"),
  clean: (category: CleanTarget) => invoke<number>("storage_clean", { category }),
  clearFolder: (instanceId: string, folder: string) => invoke<number>("storage_clean", { category: "folder", instanceId, folder }),
  dedup: () => invoke<string>("storage_dedup"),
};
