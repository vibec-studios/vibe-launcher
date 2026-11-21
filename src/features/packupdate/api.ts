import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import type { Instance, ModpackPreview } from "@/lib/types";

export type PackInput = { kind: "file"; path: string } | { kind: "url"; url: string };

export interface RemotePackUpdate {
  location: string;
  name: string | null;
  current_version: string | null;
  latest_version: string | null;
}

export const packUpdateApi = {
  preview: (instanceId: string, input: PackInput) => invoke<ModpackPreview>("modpack_from_preview", { instanceId, input }),
  update: (instanceId: string, input: PackInput) => invoke<string>("modpack_from_update", { instanceId, input }),
  remoteCheck: (instanceId: string) => invoke<RemotePackUpdate | null>("modpack_remote_check", { instanceId }),
};

export function useRemotePackUpdate(instance: Instance) {
  return useQuery({
    queryKey: ["content", instance.id, "remote-pack-check"],
    queryFn: () => packUpdateApi.remoteCheck(instance.id),
    enabled: instance.source?.kind === "packwiz" && !instance.bedrock,
    staleTime: 10 * 60_000,
    retry: 0,
  });
}

export function isPackwizInput(v: string): boolean {
  const s = v.trim().split(/[?#]/)[0].toLowerCase();
  return s.endsWith(".toml");
}

export function isHttpUrl(v: string): boolean {
  return /^https?:\/\/\S+$/i.test(v.trim());
}
