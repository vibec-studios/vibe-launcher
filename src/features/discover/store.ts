// Filterzustand der Entdecken-Seite (bleibt beim Zurücknavigieren erhalten) + gemerkte Scroll-Positionen.
import { create } from "zustand";
import type { Instance, LoaderKind, ProjectType, SortOrder } from "@/lib/types";

export interface DiscoverFilters {
  version: string | null;
  loader: LoaderKind | null;
  categories: string[];
  sort: SortOrder;
  /** „Im Trend“: nur kürzlich angelegte Projekte, nach Followern sortiert */
  trending: boolean;
  /** Für welche Ziel-Instanz die Filter zuletzt vorbelegt wurden */
  forInstance: string | null;
}

interface FilterStore extends DiscoverFilters {
  set: (p: Partial<DiscoverFilters>) => void;
  reset: () => void;
  applyInstance: (inst: Instance | null) => void;
}

const defaults: DiscoverFilters = { version: null, loader: null, categories: [], sort: "relevance", trending: false, forInstance: null };

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

/** Zeitraum für „Im Trend“ (Tage) */
export const TRENDING_DAYS = 90;
/** Unix-Sekunden, tagesgenau gerundet (stabiler Query-Schlüssel) */
export function trendingSince(): number {
  return (Math.floor(Date.now() / 86_400_000) - TRENDING_DAYS) * 86_400;
}

export type ViewMode = "list" | "grid";
const VIEW_KEY = "discover.view";
const defaultView: Record<ProjectType, ViewMode> = { mod: "list", datapack: "list", modpack: "grid", resourcepack: "grid", shader: "grid" };

function loadViews(): Partial<Record<ProjectType, ViewMode>> {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** Ansicht (Liste/Raster) je Projekttyp, gemerkt im Browser-Speicher. */
export const useDiscoverView = create<{ views: Partial<Record<ProjectType, ViewMode>>; setView: (t: ProjectType, v: ViewMode) => void }>((set, get) => ({
  views: loadViews(),
  setView: (t, v) => {
    const views = { ...get().views, [t]: v };
    set({ views });
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(views));
    } catch {
      /* egal */
    }
  },
}));

export function viewFor(views: Partial<Record<ProjectType, ViewMode>>, t: ProjectType): ViewMode {
  return views[t] ?? defaultView[t];
}
