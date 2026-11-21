import type { Server, ServerAddresses, ServerStatus, TaskInfo } from "@/lib/types";
import { remoteId, remoteTaskKey } from "./ids";
import { agentHost } from "./store";
import type { RemoteAgent } from "./types";

type Raw = Record<string, unknown>;

export function toServer(a: RemoteAgent, raw: Raw): Server {
  const { status: _status, ...rest } = raw;
  void _status;
  const s = rest as unknown as Server;
  return {
    ...s,
    id: remoteId(a.key, s.id),
    icon: null,
    source_instance: null,
    platform: s.platform ?? null,
    remote: { agent: a.key, agent_name: a.name, via: a.via, host: agentHost(a) },
  };
}

export function toStatus(a: RemoteAgent, raw: ServerStatus): ServerStatus {
  return { ...raw, server_id: remoteId(a.key, raw.server_id), detached: false };
}

export function toTask(a: RemoteAgent, raw: TaskInfo): TaskInfo {
  return { ...raw, id: remoteId(a.key, raw.id), instance_id: remoteTaskKey(a.key, raw.instance_id), title: raw.title };
}

export function toAddresses(a: RemoteAgent, raw: ServerAddresses & { public?: string | null; relay?: string | null }): ServerAddresses {
  const host = agentHost(a);
  const port = /:(\d+)$/.exec(raw.local ?? "")?.[1];
  const local = host && port ? `${host}:${port}` : raw.public ?? raw.local;
  return { local, lan: raw.lan ?? [] };
}
