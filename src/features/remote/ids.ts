const PREFIX = "rem~";

export interface RemoteRef {
  agent: string;
  id: string;
}

export function remoteId(agent: string, id: string): string {
  return `${PREFIX}${agent}~${id}`;
}

export function parseRemoteId(id: unknown): RemoteRef | null {
  if (typeof id !== "string" || !id.startsWith(PREFIX)) return null;
  const i = id.indexOf("~", PREFIX.length);
  if (i < 0) return null;
  return { agent: id.slice(PREFIX.length, i), id: id.slice(i + 1) };
}

export const isRemoteId = (id: unknown) => parseRemoteId(id) !== null;

export function remoteTaskKey(agent: string, instanceId: string | null | undefined): string | null {
  if (!instanceId) return null;
  return instanceId.startsWith("server:") ? `server:${remoteId(agent, instanceId.slice(7))}` : null;
}
