import type { ContentItem, ContentKind } from "@/lib/types";
import { contentKey } from "@/components/content/util";
import type { ContentFilter, ContentSort } from "../contentView";

export type TypeFilter = "all" | ContentKind;
export const STATUS: ContentFilter[] = ["updates", "enabled", "disabled"];
export const SORTS: ContentSort[] = ["name", "version", "recent", "size"];

export const discoverType: Record<ContentKind, string> = { mod: "mod", resourcepack: "resourcepack", shader: "shader", datapack: "datapack" };

/** Eindeutiger Schlüssel über alle Arten (gleiche Dateinamen in mods/ und resourcepacks/ sind möglich). */
export const itemKey = (kind: ContentKind, file: string) => `${kind}:${contentKey(file)}`;
export const keyOf = (c: Pick<ContentItem, "kind" | "file_name">) => itemKey(c.kind, c.file_name);

export interface ContentCounts {
  all: number;
  kind: Record<string, number>;
  enabled: number;
  disabled: number;
  updates: number;
  updatesAll: number;
}

/** Zähler eines Status-Filters (für den Chip). */
export function q(c: { enabled: number; disabled: number; updates: number }, f: ContentFilter): number {
  return f === "enabled" ? c.enabled : f === "disabled" ? c.disabled : f === "updates" ? c.updates : 0;
}
