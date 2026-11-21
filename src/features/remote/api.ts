import { invoke } from "@tauri-apps/api/core";
import type { AgentInfo, AgentProbe, LinkCode, RemoteAgent } from "./types";

export const remoteApi = {
  agents: () => invoke<RemoteAgent[]>("remote_agents"),
  vibeSync: () => invoke<RemoteAgent[]>("remote_vibe_sync"),
  probe: (address: string) => invoke<AgentProbe>("remote_probe", { address }),
  pair: (address: string, code: string, fingerprint: string) => invoke<RemoteAgent>("remote_pair", { address, code, fingerprint }),
  vibeLinkCode: () => invoke<LinkCode>("remote_vibe_link_code"),
  gatewayLink: (agent: string, code: string) => invoke<unknown>("remote_gateway_link", { agent, code }),
  rename: (agent: string, name: string) => invoke<RemoteAgent>("remote_agent_rename", { agent, name }),
  remove: (agent: string) => invoke<void>("remote_agent_remove", { agent }),
  info: (agent: string) => invoke<AgentInfo>("remote_agent_info", { agent }),
  request: <T>(agent: string, method: string, path: string, body?: unknown, text?: string) =>
    invoke<T>("remote_request", { agent, method, path, body: body ?? null, text: text ?? null }),
  wsConnect: (agent: string) => invoke<void>("remote_ws_connect", { agent }),
  wsDisconnect: (agent: string) => invoke<void>("remote_ws_disconnect", { agent }),
  wsSubscribe: (agent: string, topics: string[], on: boolean) => invoke<void>("remote_ws_subscribe", { agent, topics, on }),
};
