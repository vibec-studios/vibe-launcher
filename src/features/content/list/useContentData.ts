import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/lib/api";
import { qk, useTask } from "@/lib/queries";
import type { ContentKind, ContentUpdate } from "@/lib/types";
import { useContentView } from "../contentView";
import { itemKey } from "./keys";

export function useContentData(id: string, kinds: ContentKind[], simple: boolean) {
  // ---------------------------------------------------------------- Daten (alle Arten)
  const lists = useQueries({
    queries: kinds.map((k) => ({ queryKey: qk.content(id, k), queryFn: () => api.contentList(id, k), staleTime: 60_000 })),
  });
  const pending = lists.some((l) => l.isPending);
  const failed = lists.find((l) => l.isError && !l.data);
  const all = useMemo(() => lists.flatMap((l) => l.data ?? []), [lists]);

  // ---------------------------------------------------------------- Updates
  const checked = useContentView((s) => !!s.checked[id]);
  const updTaskId = useContentView((s) => s.tasks[id]);
  const updTask = useTask(updTaskId);
  const updatesQ = useQuery({
    queryKey: qk.contentUpdates(id),
    queryFn: () => api.contentCheckUpdates(id),
    enabled: checked || simple,
    staleTime: 10 * 60_000,
  });
  const updates = useMemo(() => {
    const m = new Map<string, ContentUpdate>();
    for (const u of updatesQ.data ?? []) m.set(itemKey(u.kind, u.file_name), u);
    return m;
  }, [updatesQ.data]);
  // CurseForge-Projekte ohne Freigabe für andere Launcher (Markierung in der Tabelle)
  const manualQ = useQuery({ queryKey: ["content", id, "manual-projects"], queryFn: () => api.contentManualProjects(id), staleTime: 30 * 60_000, retry: 0 });
  const manualProjects = useMemo(() => new Set(manualQ.data ?? []), [manualQ.data]);
  // Updates prüfen: „Neu prüfen“ in der Werkzeugleiste (RefreshButton) – prüft zugleich Ordner und Probleme

  // „Updates“ erst, wenn Update-Daten da sind (eigene Prüfung oder bereits geladen, z. B. von der Startseite)
  const known = checked || !!updatesQ.data;

  return { lists, pending, failed, all, updTask, updates, manualProjects, known };
}
