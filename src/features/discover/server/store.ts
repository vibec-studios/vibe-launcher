import { create } from "zustand";
import type { AddonSource } from "@/features/servers/addonsApi";

export const SORTS = ["relevance", "downloads", "updated"] as const;
export type Sort = (typeof SORTS)[number];

export const useServerDiscover = create<{ source: AddonSource; sort: Sort; set: (p: Partial<{ source: AddonSource; sort: Sort }>) => void }>((set) => ({
  source: "modrinth",
  sort: "relevance",
  set: (p) => set(p),
}));
