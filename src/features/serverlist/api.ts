import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queries";
import type { DiscoveryCategory, DiscoveryInput, DiscoverySubmission } from "@/lib/vibe-sdk";
import { requireClient, useSocial } from "@/features/social/service";

export const CATEGORIES: DiscoveryCategory[] = ["survival", "creative", "minigames", "pvp", "roleplay", "other"];

export const discoveryKeys = {
  servers: (c: DiscoveryCategory | null) => ["vibe", "discovery", c ?? "all"] as const,
  mine: ["vibe", "discovery", "mine"] as const,
};

export function useDiscovery(category: DiscoveryCategory | null) {
  return useQuery({
    queryKey: discoveryKeys.servers(category),
    queryFn: () => requireClient().discoverServers({ category: category ?? undefined, limit: 60 }),
    staleTime: 5 * 60_000,
  });
}

export function useMySubmissions(enabled: boolean) {
  const linked = useSocial((s) => s.linked);
  return useQuery({ queryKey: discoveryKeys.mine, queryFn: () => requireClient().listServerSubmissions({ limit: 50 }), enabled: enabled && linked, staleTime: 30_000 });
}

export async function submitServer(body: DiscoveryInput): Promise<DiscoverySubmission> {
  const s = await requireClient().submitServer(body);
  queryClient.setQueryData<{ submissions: DiscoverySubmission[] }>(discoveryKeys.mine, (l) => (l ? { submissions: [s, ...l.submissions] } : l));
  return s;
}
