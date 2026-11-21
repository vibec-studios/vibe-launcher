import { invoke } from "@tauri-apps/api/core";
import { api } from "@/lib/api";
import { isServerActive, useServerStore, useTaskStore } from "@/lib/queries";
import type { Server, ServerStatus, TaskInfo } from "@/lib/types";
import { addonApi, type AddonHit, type AddonSearch, type AddonSource } from "@/features/servers/addonsApi";
import { registerServerTargetProvider, serverTargetKey } from "@/features/installtarget/registry";
import type { AddonCheck, PackUploadOptions, PackUploadResult, ServerTargetInfo, ServerTargetProvider } from "@/features/installtarget/types";
import { remoteApi } from "./api";
import { agentCall } from "./dispatch";
import { parseRemoteId, remoteId } from "./ids";
import { agentByKey, ensureAgents, useRemote } from "./store";
import { toTask } from "./translate";
import type { RemoteAgent } from "./types";

type Compat = NonNullable<AddonHit["compat"]>;

const compatCache = new Map<string, Compat>();
const compatKey = (t: ServerTargetInfo, source: AddonSource, project: string) => `${t.key}|${source}|${project}`;

function agentOnline(a: RemoteAgent | undefined): boolean {
  if (!a) return false;
  const conn = useRemote.getState().conn[a.key]?.state;
  if (conn) return conn === "online";
  return a.via === "vibe" ? a.online !== false : true;
}

export function remoteTargetInfo(s: Server, st?: ServerStatus | null): ServerTargetInfo | null {
  const ref = parseRemoteId(s.id);
  if (!ref) return null;
  const a = agentByKey(ref.agent);
  return {
    key: serverTargetKey({ origin: "remote", agentId: ref.agent, id: ref.id }),
    origin: "remote",
    id: ref.id,
    agentId: ref.agent,
    agentName: s.remote?.agent_name ?? a?.name ?? null,
    name: s.name,
    icon: null,
    accent: s.accent,
    mc_version: s.mc_version,
    loader: s.loader,
    platform: s.platform ?? null,
    running: isServerActive(st ?? undefined),
    online: agentOnline(a),
  };
}

async function agentOf(t: Pick<ServerTargetInfo, "agentId">): Promise<RemoteAgent> {
  await ensureAgents();
  const a = t.agentId ? agentByKey(t.agentId) : undefined;
  if (!a) throw { kind: "not_found", message: "Dieser Remote-Server ist nicht mehr verbunden." };
  return a;
}

const rid = (t: ServerTargetInfo) => remoteId(t.agentId ?? "", t.id);
const enc = encodeURIComponent;

function remember(t: ServerTargetInfo, source: AddonSource, res: AddonSearch): AddonSearch {
  for (const h of res.hits) {
    if (!h.compat) continue;
    compatCache.set(compatKey(t, source, h.id), h.compat);
    if (h.slug) compatCache.set(compatKey(t, source, h.slug), h.compat);
  }
  return res;
}

function fromCompat(c: Compat): AddonCheck {
  if (c.ok) return { ok: true, reason: null, version: c.version, installed: false, deps: 0, message: null };
  return { ok: false, reason: "external", version: null, installed: false, deps: 0, message: c.reason };
}

async function installed(t: ServerTargetInfo, project: string): Promise<boolean> {
  const l = await addonApi.list(rid(t)).catch(() => null);
  return !!l?.items.some((a) => a.project_id === project || a.slug === project);
}

const TASK_POLL_MS = 4000;
const TASK_MAX_MS = 30 * 60_000;

function followTask(a: RemoteAgent, taskId: string) {
  const until = Date.now() + TASK_MAX_MS;
  const tick = async () => {
    const known = useTaskStore.getState().tasks[remoteId(a.key, taskId)];
    if (known && known.status !== "running") return;
    const t = await agentCall<TaskInfo>(a, "GET", `/tasks/${enc(taskId)}`).catch(() => null);
    if (t) useTaskStore.getState().upsert(toTask(a, t));
    if ((t && t.status !== "running") || Date.now() > until) return;
    setTimeout(() => void tick(), TASK_POLL_MS);
  };
  setTimeout(() => void tick(), TASK_POLL_MS);
}

export const remoteServerProvider: ServerTargetProvider = {
  origin: "remote",
  async list() {
    const servers = await api.serversList();
    const statuses = useServerStore.getState().statuses;
    return servers.flatMap((s) => remoteTargetInfo(s, statuses[s.id]) ?? []);
  },
  addons: (t) => addonApi.list(rid(t)),
  search: async (t, source, query, sort, offset) => remember(t, source, await addonApi.search(rid(t), source, query, sort, offset)),
  async install(t, source, project, version) {
    const a = await agentOf(t);
    return agentCall<string[]>(a, "POST", `/servers/${enc(t.id)}/addons`, { source, project, version: version ?? undefined });
  },
  async check(t, source, project) {
    const spec = { mc_version: t.mc_version, loader: t.loader.kind, platform: t.platform?.kind ?? null };
    const [c, has] = await Promise.all([
      invoke<AddonCheck>("server_addon_check_spec", { spec, source, project }).catch((e) => {
        const cached = compatCache.get(compatKey(t, source, project));
        if (cached) return fromCompat(cached);
        throw e;
      }),
      installed(t, project),
    ]);
    return { ...c, installed: has };
  },
  updates: (t) => addonApi.updates(rid(t)),
  update: (t, files) => addonApi.update(rid(t), files),
  hangarProject: (_t, project) => addonApi.project(project),
  async uploadPack(agentId: string, bundlePath: string, opts: PackUploadOptions): Promise<PackUploadResult> {
    const a = await agentOf({ agentId });
    const q = new URLSearchParams({ format: opts.format, name: opts.name });
    if (opts.serverId) q.set("server", parseRemoteId(opts.serverId)?.id ?? opts.serverId);
    const r = await remoteApi.upload<{ server?: { id?: string }; server_id?: string; task_id: string }>(a.key, "POST", `/servers/import?${q}`, bundlePath, "application/zip");
    const sid = r.server?.id ?? r.server_id ?? parseRemoteId(opts.serverId)?.id ?? opts.serverId ?? "";
    followTask(a, r.task_id);
    return { server_id: remoteId(a.key, sid), task_id: remoteId(a.key, r.task_id) };
  },
};

registerServerTargetProvider(remoteServerProvider);
