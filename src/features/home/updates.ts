import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Instance } from "@/lib/types";
import { useUpdateCounts } from "./data";

export interface UpdateEntry {
  instance: Instance;
  mods: number;
  pack: boolean;
}

const hasData = (rs: { data?: unknown }[]) => rs.map((r) => !!r.data);

export function useUpdateEntries(instances: Instance[]) {
  const counts = useUpdateCounts();
  const installed = useMemo(() => instances.filter((i) => i.install_state === "installed"), [instances]);
  const packs = useMemo(() => installed.filter((i) => !!i.source?.project_id), [installed]);
  const packData = useQueries({
    queries: packs.map((i) => ({
      queryKey: ["content", i.id, "modpack-check"],
      queryFn: () => api.modpackCheck(i.id),
      staleTime: 10 * 60_000,
      retry: 0,
    })),
    combine: hasData,
  });
  return useMemo(() => {
    const hasPack = new Set(packs.filter((_, n) => packData[n]).map((i) => i.id));
    return installed
      .map((i): UpdateEntry => ({ instance: i, mods: counts.data?.[i.id] ?? 0, pack: hasPack.has(i.id) }))
      .filter((e) => e.mods > 0 || e.pack)
      .sort((a, b) => Number(b.pack) - Number(a.pack) || b.mods - a.mods);
  }, [installed, packs, packData, counts.data]);
}
