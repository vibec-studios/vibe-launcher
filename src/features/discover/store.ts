// Filterzustand der Entdecken-Seite (bleibt beim Zurücknavigieren erhalten) + gemerkte Scroll-Positionen.
import { create } from "zustand";
import type { Instance, LoaderKind, SortOrder } from "@/lib/types";

export interface DiscoverFilters {
  version: string | null;
  loader: LoaderKind | null;
  categories: string[];
  sort: SortOrder;
  /** Für welche Ziel-Instanz die Filter zuletzt vorbelegt wurden */
  forInstance: string | null;
}

interface FilterStore extends DiscoverFilters {
  set: (p: Partial<DiscoverFilters>) => void;
  reset: () => void;
  applyInstance: (inst: Instance | null) => void;
}

const defaults: DiscoverFilters = { version: null, loader: null, categories: [], sort: "relevance", forInstance: null };

export const useDiscoverFilters = create<FilterStore>((set, get) => ({
  ...defaults,
  set: (p) => set(p),
  reset: () => {
    const inst = get().forInstance;
    set({ ...defaults, forInstance: inst });
  },
  applyInstance: (inst) => {
    if (!inst) {
      if (get().forInstance) set({ ...defaults });
      return;
    }
    if (get().forInstance === inst.id) return;
    set({
      ...defaults,
      version: inst.mc_version,
      loader: inst.loader.kind === "vanilla" ? null : inst.loader.kind,
      forInstance: inst.id,
    });
  },
}));

/** Scroll-Position je Suchanfrage (Schlüssel = JSON der Anfrage). */
export const scrollOffsets = new Map<string, number>();

/** Eingeklappte Filtergruppen der Seitenleiste (bleiben während der Sitzung erhalten). */
export const useFilterGroups = create<{ collapsed: Record<string, boolean>; toggle: (id: string) => void }>((set) => ({
  collapsed: {},
  toggle: (id) => set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })),
}));
