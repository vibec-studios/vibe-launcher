import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import type { Settings } from "@/lib/types";
import type { CloudSettings, CloudSnapshot, VlpackManifest } from "@/lib/vibe-sdk";
import { VibeError } from "@/lib/vibe-sdk";
import { requireClient, useSocial } from "@/features/social/service";

export const SYNC_KEYS = [
  "language",
  "min_memory_mb",
  "max_memory_mb",
  "jvm_args",
  "game_width",
  "game_height",
  "fullscreen",
  "auto_java",
  "launch_behavior",
  "show_snapshots",
  "concurrent_downloads",
  "discord_rpc",
  "discord_details",
  "discord_large",
  "discord_pack_icon",
  "discord_small",
  "open_log_on_launch",
  "console_on_launch",
  "reduce_motion",
  "auto_update_content",
  "snapshot_keep",
  "world_backup_on_launch",
  "world_backups_keep",
  "fix_backup",
  "minecraftcapes",
  "appearance",
  "ui_mode",
] as const satisfies readonly (keyof Settings)[];

export const cloudKey = ["vibe", "cloud-settings"] as const;

const OPT = "vl.cloud.enabled";

function readOpt(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPT) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export const useCloudOpt = create<{ by: Record<string, boolean> }>(() => ({ by: readOpt() }));

export function useCloudEnabled(): [boolean, (on: boolean) => void] {
  const scope = useSocial((s) => s.scope) ?? "";
  const on = useCloudOpt((s) => !!s.by[scope]);
  const set = (v: boolean) => {
    const by = { ...useCloudOpt.getState().by, [scope]: v };
    useCloudOpt.setState({ by });
    try {
      localStorage.setItem(OPT, JSON.stringify(by));
    } catch {
      /* egal */
    }
  };
  return [on, set];
}

export function useCloudState(enabled: boolean) {
  const linked = useSocial((s) => s.linked);
  return useQuery({ queryKey: cloudKey, queryFn: () => requireClient().getCloudSettings(), enabled: enabled && linked, staleTime: 30_000 });
}

function stripLocal(appearance: Settings["appearance"]) {
  return { ...appearance, background: { ...appearance.background, image: null, video: null } };
}

export function pickSettings(s: Settings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of SYNC_KEYS) out[k] = k === "appearance" ? stripLocal(s.appearance) : s[k];
  return out;
}

export function mergeSettings(local: Settings, remote: Record<string, unknown>): Settings {
  const next = { ...local } as Record<string, unknown>;
  for (const k of SYNC_KEYS) {
    if (!(k in remote)) continue;
    if (k === "appearance") {
      const r = remote.appearance as Settings["appearance"];
      next.appearance = { ...local.appearance, ...r, background: { ...local.appearance.background, ...r.background, image: local.appearance.background.image, video: local.appearance.background.video } };
    } else next[k] = remote[k];
  }
  return next as unknown as Settings;
}

export interface BackupPlan {
  settings: boolean;
  instanceIds: string[];
}

export async function buildSnapshot(plan: BackupPlan, keep: CloudSnapshot | null): Promise<CloudSnapshot> {
  const settings = plan.settings ? pickSettings(await api.settingsGet()) : (keep?.settings ?? {});
  const instances = plan.instanceIds.length ? await api.vibeCloudManifests(plan.instanceIds) : [];
  return {
    version: 1,
    settings: { ...settings, _meta: { savedAt: new Date().toISOString(), settings: plan.settings } },
    instances: instances.map((i) => ({ id: i.id, manifest: i.manifest as VlpackManifest })),
  };
}

export class CloudConflict extends Error {
  constructor(public remote: CloudSettings) {
    super("revision_conflict");
  }
}

export async function pushSnapshot(revision: number, snapshot: CloudSnapshot | null): Promise<CloudSettings> {
  try {
    const next = await requireClient().putCloudSettings({ revision, snapshot });
    queryClient.setQueryData(cloudKey, next);
    return next;
  } catch (e) {
    if (e instanceof VibeError && e.status === 409 && e.code === "revision_conflict") {
      const remote = e.details as CloudSettings;
      queryClient.setQueryData(cloudKey, remote);
      throw new CloudConflict(remote);
    }
    throw e;
  }
}

export function savedAt(s: CloudSnapshot | null | undefined): string | null {
  const m = s?.settings?._meta as { savedAt?: string } | undefined;
  return m?.savedAt ?? null;
}

export function hasSettings(s: CloudSnapshot | null | undefined) {
  return !!s && Object.keys(s.settings).some((k) => k !== "_meta");
}
