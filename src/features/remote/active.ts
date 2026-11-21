import type { RemoteAgent } from "./types";

export function linkedDirect(list: RemoteAgent[], vibe: RemoteAgent): RemoteAgent | undefined {
  return list.find((d) => d.via === "direct" && (d.gateway_id === vibe.id || d.id === vibe.id));
}

export function activeAgents(list: RemoteAgent[]): RemoteAgent[] {
  return list.filter((a) => !(a.via === "vibe" && linkedDirect(list, a)));
}
