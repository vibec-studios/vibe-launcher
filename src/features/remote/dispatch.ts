import { invoke } from "@tauri-apps/api/core";
import type { Server, ServerStatus } from "@/lib/types";
import { remoteApi } from "./api";
import { parseRemoteId, remoteId } from "./ids";
import { activeAgents } from "./active";
import { ROUTES, fillPath, type Args } from "./routes";
import { agentByKey, ensureAgents, freshVibeToken } from "./store";
import { toAddresses, toServer, toStatus } from "./translate";
import type { RemoteAgent } from "./types";

type Raw = Record<string, unknown>;

const LIST_TIMEOUT = 6000;
const CACHE_KEY = "vl.remote.servers";
const lastList = new Map<string, Server[]>(readCache());

function readCache(): [string, Server[]][] {
  try {
    return Object.entries(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, Server[]>);
  } catch {
    return [];
  }
}

function remember(key: string, servers: Server[] | null) {
  if (servers) lastList.set(key, servers);
  else lastList.delete(key);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(lastList)));
  } catch {
    return;
  }
}

function fail(message: string, kind = "invalid"): Promise<never> {
  return Promise.reject({ kind, message });
}

function isExpired(e: unknown) {
  const x = e as { kind?: string; message?: string } | null;
  return x?.kind === "auth" && /token_expired|invalid_token/.test(x.message ?? "");
}

export async function agentCall<T>(a: RemoteAgent, method: string, path: string, body?: unknown, text?: string): Promise<T> {
  if (a.via === "vibe") await freshVibeToken();
  try {
    return await remoteApi.request<T>(a.key, method, path, body, text);
  } catch (e) {
    if (a.via !== "vibe" || !isExpired(e)) throw e;
    const { vibeClient } = await import("@/features/social/service");
    await vibeClient()?.refresh();
    return remoteApi.request<T>(a.key, method, path, body, text);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject({ kind: "network", message: "timeout" }), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

async function storeStatuses(list: ServerStatus[]) {
  if (!list.length) return;
  const { useServerStore } = await import("@/lib/queries");
  const st = useServerStore.getState();
  for (const s of list) st.setStatus(s);
}

async function agentServers(a: RemoteAgent): Promise<{ servers: Server[]; statuses: ServerStatus[] }> {
  try {
    const raw = await withTimeout(agentCall<Raw[]>(a, "GET", "/servers"), LIST_TIMEOUT);
    const servers = raw.map((r) => toServer(a, r));
    const statuses = raw.flatMap((r) => (r.status ? [toStatus(a, r.status as ServerStatus)] : []));
    remember(a.key, servers);
    return { servers, statuses };
  } catch {
    const cached = (lastList.get(a.key) ?? []).map((s) => ({ ...s, remote: s.remote ? { ...s.remote, agent_name: a.name } : s.remote }));
    return { servers: cached, statuses: [] };
  }
}

async function mergedList(): Promise<Server[]> {
  const [local, all] = await Promise.all([invoke<Server[]>("servers_list"), ensureAgents()]);
  for (const k of [...lastList.keys()]) if (!all.some((a) => a.key === k)) remember(k, null);
  const remote = await Promise.all(activeAgents(all).map(agentServers));
  await storeStatuses(remote.flatMap((r) => r.statuses));
  return [...local, ...remote.flatMap((r) => r.servers)];
}

async function mergedStatuses(): Promise<ServerStatus[]> {
  const [local, all] = await Promise.all([invoke<ServerStatus[]>("server_statuses"), ensureAgents()]);
  const remote = await Promise.all(
    activeAgents(all).map((a) =>
      withTimeout(agentCall<ServerStatus[]>(a, "GET", "/servers/statuses"), LIST_TIMEOUT)
        .then((l) => l.map((s) => toStatus(a, s)))
        .catch(() => [] as ServerStatus[]),
    ),
  );
  return [...local, ...remote.flat()];
}

async function openPanelFor(agentKey: string) {
  const a = agentByKey(agentKey);
  if (!a) return;
  const { openAgentPanel } = await import("./panel");
  await openAgentPanel(a);
}

function translateOut(cmd: string, a: RemoteAgent, raw: unknown): unknown {
  if (ROUTES[cmd]?.task) return remoteId(a.key, String((raw as Raw)?.task_id ?? raw));
  switch (cmd) {
    case "server_get":
    case "server_update":
    case "server_accept_eula": {
      const r = raw as Raw;
      if (r?.status) void storeStatuses([toStatus(a, r.status as ServerStatus)]);
      return toServer(a, r);
    }
    case "server_addresses":
      return toAddresses(a, raw as never);
    case "server_properties_raw":
      return typeof raw === "string" ? raw : String((raw as Raw)?.text ?? "");
    case "server_addon_update":
      return typeof raw === "number" ? raw : Number((raw as Raw)?.updated ?? 0);
    case "server_addon_set_enabled":
      return typeof raw === "string" ? raw : String((raw as Raw)?.file ?? "");
    default:
      return raw;
  }
}

async function remoteCall(cmd: string, ref: { agent: string; id: string }, args: Args): Promise<unknown> {
  await ensureAgents();
  const a = agentByKey(ref.agent);
  if (!a) return fail("Dieser Remote-Server ist nicht mehr verbunden.", "not_found");
  if (cmd === "server_open_folder") return openPanelFor(a.key);
  if (cmd === "server_set_icon") return fail("Das Server-Icon kannst du bei Remote-Servern im Vibe Panel ändern.");
  const route = ROUTES[cmd];
  if (!route) return fail("Das geht bei Remote-Servern (noch) nicht im Launcher. Nutze dafür das Vibe Panel.");
  const full = { ...args, id: ref.id };
  const path = fillPath(route.path, full);
  const body = route.text ? undefined : route.body?.(full);
  const raw = await agentCall<unknown>(a, route.method, path, body, route.text?.(full));
  if (cmd === "server_log") void remoteApi.wsSubscribe(a.key, [`log:${ref.id}`], true).catch(() => {});
  return translateOut(cmd, a, raw);
}

export function routeRemote<R>(cmd: string, args?: Args): Promise<R> | null {
  if (cmd === "servers_list") return mergedList() as Promise<R>;
  if (cmd === "server_statuses") return mergedStatuses() as Promise<R>;
  if (!cmd.startsWith("server_") && cmd !== "task_cancel") return null;
  const ref = parseRemoteId(args?.id);
  if (!ref) return null;
  return remoteCall(cmd, ref, args ?? {}) as Promise<R>;
}

export async function remoteServerCreate(agentKey: string, req: unknown): Promise<{ server: Server; task_id: string }> {
  await ensureAgents();
  const a = agentByKey(agentKey);
  if (!a) return fail("Dieser Remote-Server ist nicht mehr verbunden.", "not_found");
  const r = await agentCall<{ server: Raw; task_id: string }>(a, "POST", "/servers", req);
  return { server: toServer(a, r.server), task_id: remoteId(a.key, r.task_id) };
}
