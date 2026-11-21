import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { ContentItem, ContentUpdate } from "@/lib/types";
import { keyOf } from "./keys";

export interface ListState {
  visible: ContentItem[];
  selection: Set<string>;
  all: ContentItem[];
  updates: Map<string, ContentUpdate>;
}

export type ListStateRef = MutableRefObject<ListState>;

export function useContentSelection(all: ContentItem[], visible: ContentItem[], updates: Map<string, ContentUpdate>) {
  // ---------------------------------------------------------------- Auswahl
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  // Auswahl auf vorhandene Einträge beschränken
  useEffect(() => {
    if (!selection.size) return;
    const keys = new Set(all.map(keyOf));
    let changed = false;
    const next = new Set<string>();
    for (const k of selection) (keys.has(k) ? next.add(k) : (changed = true));
    if (changed) setSelection(next);
  }, [all, selection]);

  const state = useRef<ListState>({ visible, selection, all, updates });
  state.current = { visible, selection, all, updates };

  const byKeys = (keys: Iterable<string>) => {
    const set = new Set(keys);
    return state.current.all.filter((c) => set.has(keyOf(c)));
  };

  return { selection, setSelection, anchor, state, byKeys };
}
