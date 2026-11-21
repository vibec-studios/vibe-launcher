import { useCallback, useMemo, useState, type RefObject } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { FileEntry, FileScope } from "@/lib/types";
import type { useT } from "@/i18n";
import { buildRows, type FileTreeHandle } from "../FileTree";
import { ancestors, fkeys, isInside } from "../util";

export function useFileTree(scope: FileScope, initialExpanded: string[], t: ReturnType<typeof useT>, tree: RefObject<FileTreeHandle | null>) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpanded));
  const [selected, setSelected] = useState<string | null>(null);
  const dirList = useMemo(() => ["", ...expanded], [expanded]);
  const dirQueries = useQueries({
    queries: dirList.map((dir) => ({
      queryKey: fkeys.dir(scope, dir),
      queryFn: () => api.filesList(scope, dir),
      staleTime: 15_000,
      retry: dir ? 0 : 1,
    })),
  });
  // Nur neu aufbauen, wenn sich Daten wirklich geändert haben (Liste der Ordner oder ein Abruf)
  const dataKey = dirQueries.map((q) => q.dataUpdatedAt).join(",");
  const dirs = useMemo(() => {
    const m = new Map<string, FileEntry[] | undefined>();
    dirList.forEach((d, i) => m.set(d, dirQueries[i]?.data));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirList, dataKey]);
  const rootQ = dirQueries[0];
  const rows = useMemo(() => buildRows(dirs, expanded, t("files.empty_dir")), [dirs, expanded, t]);
  const entryByPath = useMemo(() => {
    const m = new Map<string, FileEntry>();
    for (const l of dirs.values()) for (const e of l ?? []) m.set(e.path, e);
    return m;
  }, [dirs]);
  const selEntry = selected ? (entryByPath.get(selected) ?? null) : null;
  const anyFetching = dirQueries.some((q) => q.isFetching);

  const toggle = useCallback((path: string, open?: boolean) => {
    setExpanded((s) => {
      const isOpen = s.has(path);
      const want = open ?? !isOpen;
      if (want === isOpen) return s;
      const n = new Set(s);
      if (want) n.add(path);
      else for (const p of s) if (isInside(p, path)) n.delete(p);
      return n;
    });
  }, []);
  const expandTo = useCallback((path: string, self: boolean) => {
    setExpanded((s) => {
      const want = [...ancestors(path), ...(self ? [path] : [])].filter((p) => !s.has(p));
      return want.length ? new Set([...s, ...want]) : s;
    });
  }, []);
  /** Eintrag im Baum zeigen (Ordner aufklappen, markieren, hinscrollen) */
  const revealInTree = useCallback(
    (path: string, openSelf = false) => {
      expandTo(path, openSelf);
      setSelected(path);
      requestAnimationFrame(() => tree.current?.scrollTo(path));
    },
    [expandTo],
  );

  return { expanded, setExpanded, selected, setSelected, dirs, rootQ, rows, entryByPath, selEntry, anyFetching, toggle, expandTo, revealInTree };
}
