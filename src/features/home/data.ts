// Daten der Startseite: zuletzt gespielte Welten/Server über mehrere Instanzen, Update-Zähler, beliebte Modpacks.
import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { Instance, ProjectHit, RecentServer, World } from "@/lib/types";
import { supportsQuickPlay } from "@/components/instance/actions";

/** Ein direkt startbarer Einstieg: Welt (Quick Play) oder Server einer Instanz. */
export type Spot =
  | { kind: "world"; key: string; instance: Instance; world: World; at: number }
  | { kind: "server"; key: string; instance: Instance; server: RecentServer; at: number };

/** Instanzen nach „zuletzt gespielt“ (nie gespielte nach Erstellung). */
export function byRecent(list: Instance[]): Instance[] {
  return list.slice().sort((a, b) => (b.last_played ?? 0) - (a.last_played ?? 0) || b.created_at - a.created_at);
}

const combineWorlds = (rs: { data?: World[]; isLoading: boolean }[]) => ({ data: rs.map((r) => r.data), loading: rs.some((r) => r.isLoading) });

/** Welten der zuletzt gespielten Instanzen (lokal, günstig) + zuletzt besuchte Server, nach Zeit sortiert. */
export function useSpots(recent: Instance[], depth = 5) {
  const pool = useMemo(() => recent.filter((i) => i.install_state === "installed" && supportsQuickPlay(i.mc_version)).slice(0, depth), [recent, depth]);
  const worlds = useQueries({
    queries: pool.map((i) => ({ queryKey: qk.worlds(i.id), queryFn: () => api.worldsList(i.id), staleTime: 30_000 })),
    combine: combineWorlds,
  });
  const servers = useQuery({ queryKey: ["servers-recent"], queryFn: () => api.serversRecent(8), staleTime: 30_000 });
  const loading = worlds.loading || servers.isLoading;
  const spots = useMemo(() => {
    const out: Spot[] = [];
    pool.forEach((i, n) => {
      for (const w of worlds.data[n] ?? [])
        if (w.last_played) out.push({ kind: "world", key: `w:${i.id}:${w.folder}`, instance: i, world: w, at: w.last_played });
    });
    for (const s of servers.data ?? []) {
      const i = recent.find((x) => x.id === s.instance_id);
      if (i) out.push({ kind: "server", key: `s:${i.id}:${s.address}`, instance: i, server: s, at: s.last_played });
    }
    return out.sort((a, b) => b.at - a.at);
  }, [pool, recent, servers.data, worlds.data]);
  return { spots, loading };
}

/** Update-Zähler je Instanz (Hintergrundprüfung im Backend). Gleicher Schlüssel wie Bibliothek/Instanzseite. */
export function useUpdateCounts() {
  return useQuery({ queryKey: ["update-counts"], queryFn: api.contentUpdateCounts, staleTime: 60_000, refetchInterval: 120_000 });
}

/** Beliebte Modpacks (nach Downloads) – Startseite und „Neue Instanz › Modpack“. */
export function usePopularModpacks(limit = 8, source: "modrinth" | "curseforge" = "modrinth") {
  return useQuery({
    queryKey: ["home", "popular-modpacks", source, limit],
    queryFn: () =>
      api.contentSearch({
        source,
        query: "",
        project_type: "modpack",
        game_version: null,
        loader: null,
        categories: [],
        sort: "downloads",
        offset: 0,
        limit,
      }),
    select: (r): ProjectHit[] => r.hits,
    staleTime: 60 * 60_000,
    retry: 0,
  });
}

/** Wie viele Spalten (mind. `min` px breit, `gap` Abstand) passen in den Container? Für Reihen ohne halbe Zeilen. */
export function useFitColumns<T extends HTMLElement>(min: number, gap = 8) {
  const [el, ref] = useState<T | null>(null);
  const [cols, setCols] = useState(4);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCols(Math.max(1, Math.floor((e.contentRect.width + gap) / (min + gap)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, min, gap]);
  return [ref, cols] as const;
}
