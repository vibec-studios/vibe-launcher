import type { RemoteAgent } from "./types";

export function activeAgents(list: RemoteAgent[]): RemoteAgent[] {
  return list.filter((a) => !(a.via === "vibe" && list.some((d) => d.via === "direct" && d.id === a.id)));
}
