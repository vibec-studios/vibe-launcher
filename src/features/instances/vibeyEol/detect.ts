import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { ContentItem, Instance } from "@/lib/types";
import { useClientPacks } from "@/features/instances/settings/ClientPacks";

const FILE = /^vibey[-_ ]?client/i;

export function isVibeyClient(item: ContentItem): boolean {
  return FILE.test(item.file_name) || item.name.trim().toLowerCase() === "vibey client";
}

export function useVibeyClient(instance: Instance) {
  const modded = instance.loader.kind !== "vanilla";
  const mods = useQuery({
    queryKey: qk.content(instance.id, "mod"),
    queryFn: () => api.contentList(instance.id, "mod"),
    enabled: modded,
    staleTime: 60_000,
  });
  const packs = useClientPacks(instance);
  const files = (mods.data ?? []).filter(isVibeyClient).map((m) => m.file_name);
  const managed = !!packs.data?.packs.find((p) => p.id === "vibey")?.installed;
  return { present: modded && (files.length > 0 || managed), files, managed };
}
