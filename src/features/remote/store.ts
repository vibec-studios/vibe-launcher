import { create } from "zustand";
import { remoteApi } from "./api";
import type { AgentConn, RemoteAgent } from "./types";

export interface ConnInfo {
  state: AgentConn;
  error: string | null;
}

interface RemoteState {
  agents: RemoteAgent[];
  loaded: boolean;
  conn: Record<string, ConnInfo>;
  addOpen: boolean;
  manageOpen: boolean;
}

export const useRemote = create<RemoteState>(() => ({ agents: [], loaded: false, conn: {}, addOpen: false, manageOpen: false }));

export const openAddRemote = () => useRemote.setState({ addOpen: true });
export const openManageRemote = () => useRemote.setState({ manageOpen: true });

export async function freshVibeToken(): Promise<void> {
  try {
    const { vibeClient } = await import("@/features/social/service");
    await vibeClient()?.accessToken();
  } catch {
    return;
  }
}

let loading: Promise<RemoteAgent[]> | null = null;

export function loadAgents(syncVibe = false): Promise<RemoteAgent[]> {
  loading = (async () => {
    let list = await remoteApi.agents().catch(() => [] as RemoteAgent[]);
    if (syncVibe || list.some((a) => a.via === "vibe")) {
      await freshVibeToken();
      list = await remoteApi.vibeSync().catch(() => list);
    }
    useRemote.setState({ agents: list, loaded: true });
    return list;
  })();
  return loading;
}

export function ensureAgents(): Promise<RemoteAgent[]> {
  const s = useRemote.getState();
  if (s.loaded) return Promise.resolve(s.agents);
  return loading ?? loadAgents();
}

export function agentByKey(key: string): RemoteAgent | undefined {
  return useRemote.getState().agents.find((a) => a.key === key);
}

export function setConn(key: string, info: ConnInfo) {
  useRemote.setState((s) => ({ conn: { ...s.conn, [key]: info } }));
}

export function upsertAgent(a: RemoteAgent) {
  useRemote.setState((s) => {
    const i = s.agents.findIndex((x) => x.key === a.key);
    const agents = s.agents.slice();
    if (i < 0) agents.push(a);
    else agents[i] = a;
    return { agents };
  });
}

export function dropAgent(key: string) {
  useRemote.setState((s) => {
    const conn = { ...s.conn };
    delete conn[key];
    return { agents: s.agents.filter((a) => a.key !== key), conn };
  });
}

export function agentHost(a: RemoteAgent): string | null {
  if (a.via !== "direct" || !a.address) return null;
  return a.address.replace(/:\d+$/, "");
}
