import { useQuery } from "@tanstack/react-query";
import type { Instance } from "@/lib/types";
import { useVibe } from "@/lib/vibe";
import { queryClient } from "@/lib/queries";
import { VibeError, type PackFollow } from "@/lib/vibe-sdk";
import { requireClient, useSocial, vibeClient } from "@/features/social/service";

export const psk = {
  following: ["vibe", "packs", "following"] as const,
  follow: (code: string) => ["vibe", "packs", "follow", code.toUpperCase()] as const,
  diff: (code: string, from: string, to: string | null) => ["vibe", "packs", "diff", code.toUpperCase(), from, to] as const,
};

export interface VibePackRef {
  code: string;
  versionId: string | null;
  versionName: string | null;
  name: string | null;
}

export function vibePackOf(i: Instance | null | undefined): VibePackRef | null {
  const s = i?.source;
  if (!s || s.kind !== "vibe" || !s.project_id) return null;
  return { code: s.project_id, versionId: s.version_id, versionName: s.version_name, name: s.name };
}

const UNFOLLOWED = "vl.packsync.unfollowed";

function readList(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(UNFOLLOWED) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function wasUnfollowed(code: string) {
  return readList().includes(code.toUpperCase());
}

function markUnfollowed(code: string, on: boolean) {
  const c = code.toUpperCase();
  const list = readList().filter((x) => x !== c);
  if (on) list.push(c);
  try {
    localStorage.setItem(UNFOLLOWED, JSON.stringify(list.slice(-200)));
  } catch {
    /* egal */
  }
}

export const sameCode = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

export function useFollowing() {
  const vibe = useVibe();
  const ready = useSocial((s) => s.conn === "ready" || s.linked);
  return useQuery({
    queryKey: psk.following,
    queryFn: () => requireClient().packs.following(),
    enabled: vibe.sharing && ready && !!vibeClient(),
    staleTime: 60_000,
    retry: 0,
  });
}

export function useFollowState(code: string | null) {
  const list = useFollowing();
  const follow = code ? (list.data?.find((f) => sameCode(f.pack.code, code)) ?? null) : null;
  return { follow, loading: list.isPending && list.fetchStatus !== "idle", error: list.error };
}

function upsert(f: PackFollow) {
  queryClient.setQueryData<PackFollow[]>(psk.following, (old) => [f, ...(old ?? []).filter((x) => !sameCode(x.pack.code, f.pack.code))]);
}

export async function followPack(code: string, o: { notify?: boolean; installedVersionId?: string | null } = {}) {
  const f = await requireClient().packs.follow(code, o);
  markUnfollowed(code, false);
  upsert(f);
  return f;
}

export async function unfollowPack(code: string) {
  await requireClient().packs.unfollow(code);
  markUnfollowed(code, true);
  queryClient.setQueryData<PackFollow[]>(psk.following, (old) => (old ?? []).filter((x) => !sameCode(x.pack.code, code)));
}

export function applyFollowEvent(f: PackFollow) {
  upsert(f);
}

const ownPacks = new Set<string>();

export const isOwnPackError = (e: unknown) => e instanceof VibeError && e.status === 400;

export async function reportInstalled(code: string, versionId: string | null) {
  if (!vibeClient() || ownPacks.has(code.toUpperCase())) return;
  const current = queryClient.getQueryData<PackFollow[]>(psk.following)?.find((f) => sameCode(f.pack.code, code));
  if (current && current.installedVersionId === versionId) return;
  if (!current && wasUnfollowed(code)) return;
  try {
    await followPack(code, { installedVersionId: versionId, ...(current ? {} : { notify: true }) });
  } catch (e) {
    if (isOwnPackError(e)) ownPacks.add(code.toUpperCase());
  }
}

export async function reconcileInstances(instances: Instance[]) {
  const refs = instances.map(vibePackOf).filter((r): r is VibePackRef => !!r);
  if (!refs.length || !vibeClient()) return;
  let list: PackFollow[];
  try {
    list = await queryClient.fetchQuery({ queryKey: psk.following, queryFn: () => requireClient().packs.following(), staleTime: 30_000 });
  } catch {
    return;
  }
  const seen = new Set<string>();
  for (const r of refs) {
    const c = r.code.toUpperCase();
    if (seen.has(c)) continue;
    seen.add(c);
    const f = list.find((x) => sameCode(x.pack.code, c));
    if (f?.installedVersionId === r.versionId) continue;
    await reportInstalled(r.code, r.versionId);
  }
}
