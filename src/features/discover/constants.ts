import { getRouteApi } from "@tanstack/react-router";
import type { LoaderKind, SortOrder } from "@/lib/types";

export const route = getRouteApi("/discover");
export const PAGE = 20;
export const GAP = 4;
export const GRID_GAP = 12;
export const ALL = "__all";
export const LOADERS: LoaderKind[] = ["fabric", "neoforge", "forge", "quilt"];
export const SORTS: SortOrder[] = ["relevance", "downloads", "follows", "newest", "updated"];
export const FALLBACK_VERSIONS = ["1.21.11", "1.21.10", "1.21.8", "1.21.5", "1.21.4", "1.21.1", "1.21", "1.20.6", "1.20.4", "1.20.1", "1.19.4", "1.19.2", "1.18.2", "1.17.1", "1.16.5", "1.12.2", "1.8.9", "1.7.10"];


/** Link im Look eines Sekundär-Knopfs (ghost). */
export const ghostLinkCls =
  "inline-flex h-8 items-center gap-1.5 rounded-ctl bg-surface2 px-3 text-[13px] font-semibold text-text transition-colors duration-150 hover:bg-surface3";
