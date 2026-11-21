import { getRouteApi } from "@tanstack/react-router";
import type { Screenshot } from "@/lib/types";

export const route = getRouteApi("/screenshots");
export const GAP = 8;
export const MIN_TILE = 220;
export const HEAD_H = 40;
export const PAD = 24;
export const ALL = "__all";

export type Row = { kind: "head"; label: string; count: number } | { kind: "tiles"; items: Screenshot[]; start: number };
