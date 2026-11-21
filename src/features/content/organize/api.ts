import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queries";
import type { ContentItem, ContentKind } from "@/lib/types";

export interface OrgItem {
  kind: ContentKind;
  file: string;
  group: string | null;
  tags: string[];
  from_pack: boolean;
  auto: boolean;
  unused: boolean;
  needed_by: string[];
}

export interface OrgGroup {
  id: string;
  name: string;
  color: string | null;
  count: number;
  enabled: number;
}

export interface Organize {
  groups: OrgGroup[];
  items: OrgItem[];
  tags: string[];
  has_pack: boolean;
  pack_count: number;
  unused_count: number;
}

export interface RemovalExtra {
  kind: ContentKind;
  file_name: string;
  name: string;
  enabled: boolean;
}

export interface Target {
  kind: ContentKind;
  file_name: string;
}

export const orgQueryKey = (instanceId: string) => ["content", instanceId, "organize"] as const;

export const orgItemKey = (kind: ContentKind, file: string) => `${kind}:${file.replace(/\.disabled$/i, "")}`;

export const toTargets = (items: Pick<ContentItem, "kind" | "file_name">[]): Target[] => items.map((i) => ({ kind: i.kind, file_name: i.file_name }));

export const organizeApi = {
  get: (instanceId: string) => invoke<Organize>("content_organize", { instanceId }),
  saveGroup: (instanceId: string, groupId: string | null, name: string, color: string | null, targets: Target[] = []) =>
    invoke<Organize>("content_group_save", { instanceId, groupId, name, color, targets }),
  deleteGroup: (instanceId: string, groupId: string) => invoke<Organize>("content_group_delete", { instanceId, groupId }),
  assign: (instanceId: string, targets: Target[], groupId: string | null) => invoke<Organize>("content_group_assign", { instanceId, targets, groupId }),
  editTags: (instanceId: string, targets: Target[], add: string[], remove: string[]) => invoke<Organize>("content_tags_edit", { instanceId, targets, add, remove }),
  keep: (instanceId: string, targets: Target[]) => invoke<Organize>("content_deps_keep", { instanceId, targets }),
  removalExtras: (instanceId: string, targets: Target[]) => invoke<RemovalExtra[]>("content_removal_extras", { instanceId, targets }),
};

export function useOrganize(instanceId: string) {
  return useQuery({ queryKey: orgQueryKey(instanceId), queryFn: () => organizeApi.get(instanceId), staleTime: 30_000 });
}

export function setOrganize(instanceId: string, data: Organize) {
  queryClient.setQueryData(orgQueryKey(instanceId), data);
}

export function indexOrganize(data: Organize | undefined) {
  const items = new Map<string, OrgItem>();
  const groups = new Map<string, OrgGroup>();
  for (const i of data?.items ?? []) items.set(orgItemKey(i.kind, i.file), i);
  for (const g of data?.groups ?? []) groups.set(g.id, g);
  return { items, groups };
}
