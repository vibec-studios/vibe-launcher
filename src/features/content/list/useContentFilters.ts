import { useEffect, useMemo, useState } from "react";
import { sideMatches, type SideFilter } from "@/components/content/sides";
import type { ContentItem, ContentKind, ContentUpdate } from "@/lib/types";
import { setContentFilter, setContentSort, useContentView, type ContentFilter, type ContentSort } from "../contentView";
import { indexOrganize, useOrganize } from "../organize/api";
import { orgMatches, useOrgFilter } from "../organize/filter";
import { keyOf, type ContentCounts, type TypeFilter } from "./keys";

interface Args {
  id: string;
  all: ContentItem[];
  kinds: ContentKind[];
  initialType: TypeFilter;
  updates: Map<string, ContentUpdate>;
  known: boolean;
}

export function useContentFilters({ id, all, kinds, initialType, updates, known }: Args) {
  // ---------------------------------------------------------------- Suche / Filter / Sortierung
  const [text, setText] = useState("");
  const [type, setType] = useState<TypeFilter>(() => (initialType !== "all" && !kinds.includes(initialType) ? "all" : initialType));
  useEffect(() => setType(initialType !== "all" && !kinds.includes(initialType) ? "all" : initialType), [initialType, kinds]);
  const storedFilter = useContentView((s) => s.filter[id] ?? "all");
  const status: ContentFilter = storedFilter === "updates" && !known ? "all" : storedFilter;
  const setStatus = (f: ContentFilter) => setContentFilter(id, f);
  const sort = useContentView((s) => s.sort);
  const [desc, setDesc] = useState(false);
  const [sideFilter, setSideFilter] = useState<SideFilter>("all");
  // Der Seiten-Filter gilt nur für Mods und erscheint nur im Mods-Filter
  useEffect(() => {
    if (type !== "mod") setSideFilter("all");
  }, [type]);
  const orgQ = useOrganize(id);
  const org = useMemo(() => indexOrganize(orgQ.data), [orgQ.data]);
  const orgFilter = useOrgFilter(id);

  const sorted = useMemo(() => {
    const byName = (a: ContentItem, b: ContentItem) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    const cmp =
      sort === "recent"
        ? (a: ContentItem, b: ContentItem) => b.modified - a.modified || byName(a, b)
        : sort === "size"
          ? (a: ContentItem, b: ContentItem) => b.size - a.size || byName(a, b)
          : sort === "version"
            ? (a: ContentItem, b: ContentItem) => (a.version ?? "").localeCompare(b.version ?? "", undefined, { numeric: true }) || byName(a, b)
            : byName;
    const list = [...all].sort(cmp);
    return desc ? list.reverse() : list;
  }, [all, sort, desc]);
  const typed = useMemo(() => (type === "all" ? sorted : sorted.filter((c) => c.kind === type)), [sorted, type]);
  const counts = useMemo<ContentCounts>(() => {
    const byKind: Record<string, number> = {};
    for (const c of all) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    let on = 0;
    for (const c of typed) if (c.enabled) on++;
    return {
      all: all.length,
      kind: byKind,
      enabled: on,
      disabled: typed.length - on,
      updates: typed.filter((c) => updates.has(keyOf(c))).length,
      updatesAll: all.filter((c) => updates.has(keyOf(c))).length,
    };
  }, [all, typed, updates]);
  const visible = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return typed.filter((c) => {
      if (status === "enabled" && !c.enabled) return false;
      if (status === "disabled" && c.enabled) return false;
      if (status === "updates" && !updates.has(keyOf(c))) return false;
      if (c.kind === "mod" && !sideMatches(sideFilter, c.side)) return false;
      if (!orgMatches(orgFilter, org.items.get(keyOf(c)))) return false;
      if (!needle) return true;
      return c.name.toLowerCase().includes(needle) || c.file_name.toLowerCase().includes(needle) || c.authors.some((a) => a.toLowerCase().includes(needle));
    });
  }, [typed, text, status, updates, sideFilter, orgFilter, org]);

  /** Spaltenkopf: gleicher Schlüssel -> Richtung umkehren, sonst aufsteigend sortieren. */
  const sortBy = (s: ContentSort) => {
    if (s === sort) setDesc((d) => !d);
    else {
      setContentSort(s);
      setDesc(false);
    }
  };

  return { text, setText, type, setType, status, setStatus, sort, desc, setDesc, sortBy, sideFilter, setSideFilter, orgQ, org, orgFilter, counts, visible };
}

export type ContentFilters = ReturnType<typeof useContentFilters>;
