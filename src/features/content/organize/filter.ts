import { create } from "zustand";
import type { OrgItem } from "./api";

export type Origin = "all" | "pack" | "own";

export interface OrgFilter {
  origin: Origin;
  group: string;
  tag: string | null;
  unused: boolean;
}

export const ORG_ALL: OrgFilter = { origin: "all", group: "all", tag: null, unused: false };
export const GROUP_NONE = "__none";

interface OrgFilterState {
  byInstance: Record<string, OrgFilter>;
  set: (id: string, patch: Partial<OrgFilter>) => void;
  reset: (id: string) => void;
}

export const useOrgFilterStore = create<OrgFilterState>((set) => ({
  byInstance: {},
  set: (id, patch) => set((s) => ({ byInstance: { ...s.byInstance, [id]: { ...(s.byInstance[id] ?? ORG_ALL), ...patch } } })),
  reset: (id) => set((s) => ({ byInstance: { ...s.byInstance, [id]: ORG_ALL } })),
}));

export function useOrgFilter(id: string): OrgFilter {
  return useOrgFilterStore((s) => s.byInstance[id] ?? ORG_ALL);
}

export const setOrgFilter = (id: string, patch: Partial<OrgFilter>) => useOrgFilterStore.getState().set(id, patch);
export const resetOrgFilter = (id: string) => useOrgFilterStore.getState().reset(id);

export function orgActive(f: OrgFilter): number {
  return (f.origin !== "all" ? 1 : 0) + (f.group !== "all" ? 1 : 0) + (f.tag ? 1 : 0) + (f.unused ? 1 : 0);
}

export function orgMatches(f: OrgFilter, info: OrgItem | undefined): boolean {
  if (f.origin === "pack" && !info?.from_pack) return false;
  if (f.origin === "own" && info?.from_pack) return false;
  if (f.group === GROUP_NONE && info?.group) return false;
  if (f.group !== "all" && f.group !== GROUP_NONE && info?.group !== f.group) return false;
  if (f.tag && !info?.tags.some((t) => t.toLowerCase() === f.tag!.toLowerCase())) return false;
  if (f.unused && !info?.unused) return false;
  return true;
}

export const GROUP_COLORS = ["#5b8def", "#3fb68b", "#e0a030", "#e05d5d", "#a070e0", "#3cb4c8", "#e07ab0", "#8a9099"];
