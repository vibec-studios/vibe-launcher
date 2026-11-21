import type { Instance } from "@/lib/types";
import type { HostSession, Invite } from "@/lib/vibe-sdk";

export interface JoinTarget {
  title: string;
  from: { id: string; name: string };
  mcVersion: string | null;
  loader: string | null;
  packCode: string | null;
  message: string | null;
  expiresAt: string | null;
  invite: Invite | null;
  host: HostSession | null;
}

export function matchInstances(instances: Instance[], tgt: JoinTarget): Instance[] {
  if (tgt.packCode) {
    const fromPack = instances.filter((i) => i.source?.kind === "vibe" && i.source.project_id?.toUpperCase() === tgt.packCode!.toUpperCase());
    if (fromPack.length) return fromPack;
  }
  return instances
    .filter((i) => (!tgt.mcVersion || i.mc_version === tgt.mcVersion) && (!tgt.loader || tgt.loader === "vanilla" || i.loader.kind === tgt.loader))
    .sort((a, b) => (b.last_played ?? 0) - (a.last_played ?? 0));
}
