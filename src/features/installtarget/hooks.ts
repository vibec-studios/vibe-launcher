import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { isServerActive, queryClient, useServers, useServerStatus } from "@/lib/queries";
import { aqk } from "@/features/servers/addonsApi";
import "./local";
import { localTargetInfo } from "./local";
import { parseServerTargetKey, serverTargetKey, useTargetRegistry } from "./registry";
import type { ServerTargetInfo, ServerTargetProvider } from "./types";

export const tqk = {
  remoteList: (origin: string) => ["server-targets", origin] as const,
  addons: (t: Pick<ServerTargetInfo, "origin" | "id" | "key">) => (t.origin === "local" ? aqk.addons(t.id) : (["target-addons", t.key] as const)),
  updates: (t: Pick<ServerTargetInfo, "origin" | "id" | "key">) => (t.origin === "local" ? aqk.updates(t.id) : (["target-addon-updates", t.key] as const)),
  search: (t: Pick<ServerTargetInfo, "key">, source: string, q: string, sort: string) => ["target-addon-search", t.key, source, q, sort] as const,
  check: (t: Pick<ServerTargetInfo, "key">, source: string, project: string) => ["target-addon-check", t.key, source, project] as const,
};

export function refreshTarget(t: Pick<ServerTargetInfo, "origin" | "id" | "key">) {
  void queryClient.invalidateQueries({ queryKey: tqk.addons(t) });
  void queryClient.invalidateQueries({ queryKey: tqk.updates(t) });
  void queryClient.invalidateQueries({ queryKey: ["target-addon-check", t.key] });
}

export function useServerTargets(): { targets: ServerTargetInfo[]; pending: boolean } {
  const local = useServers();
  const providers = useTargetRegistry((s) => s.providers);
  const remote = useMemo(() => Object.values(providers).filter((p): p is ServerTargetProvider => !!p && p.origin !== "local"), [providers]);
  const rq = useQueries({ queries: remote.map((p) => ({ queryKey: tqk.remoteList(p.origin), queryFn: () => p.list(), staleTime: 15_000 })) });
  const targets = [...(local.data ?? []).map((s) => localTargetInfo(s)), ...rq.flatMap((q) => q.data ?? [])];
  return { targets, pending: local.isPending };
}

export function useServerTarget(key: string | undefined | null): { target: ServerTargetInfo | null; pending: boolean; missing: boolean } {
  const { targets, pending } = useServerTargets();
  const parsed = parseServerTargetKey(key);
  const k = parsed ? serverTargetKey(parsed) : null;
  const target = k ? (targets.find((t) => t.key === k) ?? null) : null;
  return { target, pending, missing: !!k && !pending && !target };
}

export function useTargetRunning(t: ServerTargetInfo | null): boolean {
  const st = useServerStatus(t?.origin === "local" ? t.id : "");
  if (!t) return false;
  if (t.origin === "local") return isServerActive(st);
  return t.running;
}

export function providerOf(t: Pick<ServerTargetInfo, "origin">): ServerTargetProvider {
  const p = useTargetRegistry.getState().providers[t.origin];
  if (!p) throw new Error(`Kein Server-Anbieter für ${t.origin}`);
  return p;
}
