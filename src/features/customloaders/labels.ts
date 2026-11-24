import type { CustomLoaderIssue, CustomLoaderPack, CustomLoaderRef, Instance } from "@/lib/types";

export type Translate = (key: string, params?: Record<string, string | number>) => string;

export function findPack(packs: CustomLoaderPack[] | undefined, ref: CustomLoaderRef | null | undefined): CustomLoaderPack | undefined {
  if (!ref) return undefined;
  return packs?.find((p) => p.id === ref.id && p.loader_version === ref.version);
}

export function customLoaderName(i: Pick<Instance, "custom_loader">, packs: CustomLoaderPack[] | undefined): string | null {
  const ref = i.custom_loader;
  if (!ref) return null;
  return `${findPack(packs, ref)?.name ?? ref.id} ${ref.version}`;
}

export function packsById(packs: CustomLoaderPack[]): { id: string; versions: CustomLoaderPack[] }[] {
  const map = new Map<string, CustomLoaderPack[]>();
  for (const p of packs) map.set(p.id, [...(map.get(p.id) ?? []), p]);
  return [...map.entries()].map(([id, versions]) => ({
    id,
    versions: [...versions].sort((a, b) => b.loader_version.localeCompare(a.loader_version, undefined, { numeric: true })),
  }));
}

export function issueText(t: Translate, issue: CustomLoaderIssue): string {
  const key = `cl.err.${issue.code}`;
  const text = t(key, issue.params);
  return text === key ? issue.message : text;
}
