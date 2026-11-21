import { useEffect } from "react";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { DeferredMount } from "@/components/DeferredMount";
import { queryClient, sqk } from "@/lib/queries";
import type { LogLine, ServerStatus, TaskInfo } from "@/lib/types";
import { activeAgents } from "./active";
import { remoteApi } from "./api";
import { remoteId } from "./ids";
import { agentByKey, freshVibeToken, loadAgents, setConn, upsertAgent, useRemote, type ConnInfo } from "./store";
import { toServer, toStatus, toTask } from "./translate";
import type { AgentConn, RemoteAgent } from "./types";

type Raw = Record<string, unknown>;

function forward(a: RemoteAgent, event: string, data: unknown) {
  switch (event) {
    case "server://status":
      return emit("server://status", toStatus(a, data as ServerStatus));
    case "server://log": {
      const d = data as { server_id: string; lines?: LogLine[]; line?: LogLine };
      return emit("server://log", { server_id: remoteId(a.key, d.server_id), lines: d.lines ?? (d.line ? [d.line] : []) });
    }
    case "servers://changed":
      return emit("servers://changed", toServer(a, data as Raw));
    case "servers://removed":
      return emit("servers://removed", { id: remoteId(a.key, String((data as Raw).id)) });
    case "task://update":
      return emit("task://update", toTask(a, data as TaskInfo));
  }
}

function onMessage(key: string, text: string) {
  const a = agentByKey(key);
  if (!a) return;
  let msg: Raw;
  try {
    msg = JSON.parse(text) as Raw;
  } catch {
    return;
  }
  if (msg.t === "event" && typeof msg.event === "string") void forward(a, msg.event, msg.data);
  else if (msg.t === "hello") {
    const info = (msg.agent ?? {}) as Raw;
    upsertAgent({ ...a, version: (info.version as string) ?? a.version, os: (info.os as string) ?? a.os, arch: (info.arch as string) ?? a.arch });
  }
}

function onState(key: string, info: ConnInfo) {
  const prev = useRemote.getState().conn[key]?.state;
  setConn(key, info);
  if (info.state === "online" && prev !== "online") void queryClient.invalidateQueries({ queryKey: sqk.servers });
}

export async function connectAgents(list: RemoteAgent[]) {
  if (list.some((a) => a.via === "vibe")) await freshVibeToken();
  for (const a of activeAgents(list)) await remoteApi.wsConnect(a.key).catch(() => {});
}

const loadDialogs = () => import("./RemoteDialogs").then((m) => m.RemoteDialogs);

export function RemoteBridge() {
  useEffect(() => {
    let dead = false;
    const uns: UnlistenFn[] = [];
    const keep = (p: Promise<UnlistenFn>) => p.then((u) => (dead ? u() : uns.push(u)));
    keep(listen<{ agent: string; data: string }>("remote://ws", (e) => onMessage(e.payload.agent, e.payload.data)));
    keep(listen<{ agent: string; state: AgentConn; error: string | null }>("remote://state", (e) => onState(e.payload.agent, { state: e.payload.state, error: e.payload.error })));
    void loadAgents().then((list) => {
      if (!dead && list.length) void connectAgents(list);
    });
    return () => {
      dead = true;
      uns.forEach((u) => u());
    };
  }, []);
  const open = useRemote((s) => s.addOpen || s.manageOpen);
  return <DeferredMount active={open} load={loadDialogs} />;
}
