// Minecraft Bedrock: Typen + typisierte Commands (src-tauri/src/commands/bedrock.rs).
import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import type { BedrockChannel, BedrockProfile, Instance, SearchResult, SortOrder, WorldBackup } from "@/lib/types";

export type BedrockLayout = "gdk" | "uwp";
export type BedrockPackKind = "resource" | "behavior" | "skin" | "world_template";

export interface BedrockChannelStatus {
  channel: BedrockChannel;
  installed: boolean;
  version: string | null;
  layout: BedrockLayout | null;
  data_dir: string | null;
  /** Es gibt schon Welten/Packs, die übernommen werden können */
  has_data: boolean;
  /** Instanz, deren Profil gerade eingetauscht ist */
  active_instance: string | null;
  running: boolean;
  store_url: string;
}

export interface BedrockStatus {
  /** Windows */
  supported: boolean;
  /** Entwicklungsmodus: Spiel wird nur simuliert */
  simulated: boolean;
  /** Warum Bedrock gerade nicht nutzbar ist */
  blocked: string | null;
  channels: BedrockChannelStatus[];
}

export interface BedrockHomeSummary {
  worlds: number;
  packs: number;
  size: number;
}

export interface BedrockPack {
  /** `<ordner-art>/<ordnername>` */
  id: string;
  kind: BedrockPackKind;
  name: string;
  description: string;
  uuid: string;
  version: number[];
  min_engine: string | null;
  dev: boolean;
  size: number;
  icon: string | null;
  modified: number;
  source: { project_id: string; file_id: string; title: string | null } | null;
}

export interface BedrockWorld {
  folder: string;
  name: string;
  icon: string | null;
  size: number;
  last_played: number | null;
  user: string;
  resource_packs: string[];
  behavior_packs: string[];
}

export interface BedrockImportResult {
  packs: string[];
  worlds: string[];
  updated: string[];
}

export interface CfClass {
  id: number;
  name: string;
  slug: string;
}

/** Dateiendungen, die eine Bedrock-Instanz annimmt. */
export const BEDROCK_EXTENSIONS = ["mcpack", "mcaddon", "mcworld", "mctemplate", "zip"];

export const isBedrock = (i: Pick<Instance, "bedrock"> | null | undefined): boolean => !!i?.bedrock;

export const bedrockApi = {
  status: () => invoke<BedrockStatus>("bedrock_status"),
  homeSummary: (channel: BedrockChannel) => invoke<BedrockHomeSummary>("bedrock_home_summary", { channel }),
  create: (req: { name: string; channel: BedrockChannel; profile: BedrockProfile; adopt?: boolean; icon?: string | null; accent?: string | null; group?: string | null }) =>
    invoke<Instance>("bedrock_create", { adopt: false, icon: null, accent: null, group: null, ...req }),
  packs: (instanceId: string) => invoke<BedrockPack[]>("bedrock_packs", { instanceId }),
  packRemove: (instanceId: string, packId: string) => invoke<void>("bedrock_pack_remove", { instanceId, packId }),
  packExport: (instanceId: string, packId: string, dest: string) => invoke<void>("bedrock_pack_export", { instanceId, packId, dest }),
  importFiles: (instanceId: string, paths: string[]) => invoke<BedrockImportResult>("bedrock_import_files", { instanceId, paths }),
  worlds: (instanceId: string) => invoke<BedrockWorld[]>("bedrock_worlds", { instanceId }),
  canImportWorlds: (instanceId: string) => invoke<boolean>("bedrock_can_import_worlds", { instanceId }),
  worldDelete: (instanceId: string, folder: string) => invoke<void>("bedrock_world_delete", { instanceId, folder }),
  worldExport: (instanceId: string, folder: string, dest: string) => invoke<void>("bedrock_world_export", { instanceId, folder, dest }),
  worldPackSet: (instanceId: string, folder: string, packId: string, enabled: boolean) => invoke<void>("bedrock_world_pack_set", { instanceId, folder, packId, enabled }),
  backups: (instanceId: string) => invoke<WorldBackup[]>("bedrock_backups", { instanceId }),
  backupCreate: (instanceId: string, folder: string) => invoke<WorldBackup>("bedrock_backup_create", { instanceId, folder }),
  backupRestore: (instanceId: string, backupId: string) => invoke<void>("bedrock_backup_restore", { instanceId, backupId }),
  backupDelete: (instanceId: string, backupId: string) => invoke<void>("bedrock_backup_delete", { instanceId, backupId }),
  openFolder: (instanceId: string, sub?: "packs" | "worlds" | "backups" | null) => invoke<void>("bedrock_open_folder", { instanceId, sub: sub ?? null }),
  recover: (channel: BedrockChannel) => invoke<boolean>("bedrock_recover", { channel }),
  openStore: (channel: BedrockChannel) => invoke<void>("bedrock_open_store", { channel }),
  cfClasses: () => invoke<CfClass[]>("bedrock_cf_classes"),
  cfSearch: (q: { query: string; classId: number | null; sort?: SortOrder; offset?: number; limit?: number }) =>
    invoke<SearchResult>("bedrock_cf_search", { query: q.query, classId: q.classId, sort: q.sort ?? "relevance", offset: q.offset ?? 0, limit: q.limit ?? 20 }),
  /** Task-ID */
  cfInstall: (instanceId: string, projectId: string, title: string, fileId?: string | null) =>
    invoke<string>("bedrock_cf_install", { instanceId, projectId, fileId: fileId ?? null, title }),
};

// Unter „content“ einsortiert: `content://changed` lädt diese Listen automatisch neu
export const bqk = {
  status: ["bedrock-status"] as const,
  packs: (id: string) => ["content", id, "bedrock-packs"] as const,
  worlds: (id: string) => ["content", id, "bedrock-worlds"] as const,
  backups: (id: string) => ["content", id, "bedrock-backups"] as const,
  canImportWorlds: (id: string) => ["content", id, "bedrock-can-import"] as const,
};

export function useBedrockStatus() {
  return useQuery({ queryKey: bqk.status, queryFn: bedrockApi.status, staleTime: 15_000, retry: 0 });
}

export function channelStatus(s: BedrockStatus | undefined, ch: BedrockChannel): BedrockChannelStatus | undefined {
  return s?.channels.find((c) => c.channel === ch);
}
