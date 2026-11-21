import { invoke } from "@tauri-apps/api/core";
import type { AppAction } from "@/lib/types";

export interface ModrinthLinkStatus {
  supported: boolean;
  enabled: boolean;
  other: string | null;
}

export const mrLinksApi = {
  status: () => invoke<ModrinthLinkStatus>("modrinth_links_status"),
  set: (enabled: boolean) => invoke<ModrinthLinkStatus>("modrinth_links_set", { enabled }),
  parse: (url: string) => invoke<AppAction | null>("app_link_parse", { url }),
  versionProject: (versionId: string) => invoke<string>("content_version_project", { versionId }),
};

export function looksLikeModrinthLink(v: string): boolean {
  return /^\s*(modrinth:\/\/|https:\/\/(www\.)?modrinth\.com\/)\S+\s*$/i.test(v);
}
