import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { qk, queryClient, useSettings, useSystemInfo } from "@/lib/queries";
import type { Instance } from "@/lib/types";

export const BIG_PC_MB = 16 * 1024;
export const MODPACK_MIN_MB = 6 * 1024;

export function ramSuggestion(o: { totalMb: number; maxMb: number; modCount: number | null; fromModpack: boolean }): number | null {
  if (o.totalMb < BIG_PC_MB || o.maxMb >= MODPACK_MIN_MB) return null;
  const mods = o.modCount ?? 0;
  if (!o.fromModpack && mods <= 80) return null;
  return mods > 200 && o.totalMb >= 24 * 1024 ? 8192 : MODPACK_MIN_MB;
}

export interface PerfLevel {
  id: "auto" | "normal" | "high" | "max";
  mb: number | null;
}

export const PERF_LEVELS: PerfLevel[] = [
  { id: "auto", mb: null },
  { id: "normal", mb: 4096 },
  { id: "high", mb: 6144 },
  { id: "max", mb: 8192 },
];

export function levelsFor(totalMb: number) {
  return PERF_LEVELS.filter((l) => l.mb === null || l.mb <= Math.floor(totalMb * 0.6));
}

export function levelOf(maxMb: number | null): PerfLevel["id"] {
  if (maxMb === null) return "auto";
  return PERF_LEVELS.reduce((best, l) => (l.mb !== null && Math.abs(l.mb - maxMb) < Math.abs((best.mb ?? 0) - maxMb) ? l : best), PERF_LEVELS[1]).id;
}

const dismissKey = (id: string) => `vl.ram.dismissed.${id}`;

function readDismissed(id: string) {
  try {
    return localStorage.getItem(dismissKey(id)) === "1";
  } catch {
    return false;
  }
}

export function useRamSuggestion(instance: Instance) {
  const { data: settings } = useSettings();
  const { data: sys } = useSystemInfo();
  const [dismissed, setDismissed] = useState(() => readDismissed(instance.id));
  const java = !instance.bedrock && instance.loader.kind !== "vanilla";
  const mods = useQuery({ queryKey: qk.content(instance.id, "mod"), queryFn: () => api.contentList(instance.id, "mod"), staleTime: 60_000, enabled: java && !dismissed });
  const fromModpack = !!instance.source && ["modrinth", "curseforge", "vlpack", "vibe"].includes(instance.source.kind);
  const suggestion =
    java && !dismissed && sys && settings
      ? ramSuggestion({
          totalMb: sys.total_memory_mb,
          maxMb: instance.java.max_memory_mb ?? settings.max_memory_mb,
          modCount: mods.data ? mods.data.filter((m) => m.enabled).length : null,
          fromModpack,
        })
      : null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissKey(instance.id), "1");
    } catch {
      return;
    }
  };
  const apply = async () => {
    if (!suggestion) return;
    const next = await api.instanceUpdate(instance.id, { java: { ...instance.java, min_memory_mb: Math.min(instance.java.min_memory_mb ?? 1024, suggestion), max_memory_mb: suggestion } });
    queryClient.setQueryData(qk.instance(instance.id), next);
    queryClient.invalidateQueries({ queryKey: qk.instances });
    dismiss();
  };
  return { suggestion, apply, dismiss };
}
