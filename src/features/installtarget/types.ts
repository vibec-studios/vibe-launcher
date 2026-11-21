import type { Loader, ServerPlatform } from "@/lib/types";
import type { AddonList, AddonSearch, AddonSource, AddonUpdate } from "@/features/servers/addonsApi";
import type { ViewProject } from "@/features/discover/ProjectView";

export type ServerOrigin = "local" | "remote";

export type InstallTarget =
  | { kind: "instance"; id: string }
  | { kind: "server"; origin: ServerOrigin; id: string; agentId?: string | null };

export type ServerInstallTarget = Extract<InstallTarget, { kind: "server" }>;

export interface ServerTargetInfo {
  key: string;
  origin: ServerOrigin;
  id: string;
  agentId: string | null;
  agentName: string | null;
  name: string;
  icon: string | null;
  accent: string | null;
  mc_version: string;
  loader: Loader;
  platform: ServerPlatform | null;
  running: boolean;
  online: boolean;
}

export type AddonCheckReason = "vanilla" | "hangar" | "client_only" | "not_plugin" | "loader" | "version" | "external";

export interface AddonCheck {
  ok: boolean;
  reason: AddonCheckReason | null;
  version: string | null;
  installed: boolean;
  deps: number;
  message: string | null;
}

export interface PackUploadOptions {
  name: string;
  serverId: string | null;
  format: "mrpack";
}

export interface PackUploadResult {
  server_id: string;
  task_id: string;
}

export interface ServerTargetProvider {
  origin: ServerOrigin;
  list(): Promise<ServerTargetInfo[]>;
  addons(t: ServerTargetInfo): Promise<AddonList>;
  search(t: ServerTargetInfo, source: AddonSource, query: string, sort: string, offset: number): Promise<AddonSearch>;
  install(t: ServerTargetInfo, source: AddonSource, project: string, version?: string | null): Promise<string[]>;
  check(t: ServerTargetInfo, source: AddonSource, project: string): Promise<AddonCheck>;
  updates(t: ServerTargetInfo): Promise<AddonUpdate[]>;
  update(t: ServerTargetInfo, files: string[] | null): Promise<number>;
  hangarProject(t: ServerTargetInfo, project: string): Promise<ViewProject>;
  uploadPack?(agentId: string, bundlePath: string, opts: PackUploadOptions): Promise<PackUploadResult>;
}
