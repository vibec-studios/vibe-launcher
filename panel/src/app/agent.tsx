import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AgentApi } from "@/api/client";
import type { AgentSocket, SocketState, Transport } from "@/api/transport";
import type { AgentInfo, LogLine, Me, Permission, Resources, ServerView, TaskInfo } from "@/api/types";

export interface AgentCtx {
  key: string;
  api: AgentApi;
  socket: AgentSocket;
  me: Me;
  info: AgentInfo;
  base: string;
  remote: boolean;
  can: (p: Permission) => boolean;
  tasks: Map<string, TaskInfo>;
  socketState: SocketState;
}

const Ctx = createContext<AgentCtx | null>(null);

export function useAgent(): AgentCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("AgentProvider fehlt");
  return c;
}

export const qk = {
  servers: (k: string) => ["servers", k] as const,
  server: (k: string, id: string) => ["server", k, id] as const,
  any: (k: string, ...rest: string[]) => [k, ...rest] as const,
};

function patchServers(qc: QueryClient, key: string, fn: (list: ServerView[]) => ServerView[]) {
  qc.setQueryData<ServerView[]>(qk.servers(key), (old) => (old ? fn(old) : old));
}

export function AgentProvider({ agentKey, transport, base, remote, children, fallback }: { agentKey: string; transport: Transport; base: string; remote: boolean; children: ReactNode; fallback: (state: { error: unknown; loading: boolean; retry: () => void }) => ReactNode }) {
  const qc = useQueryClient();
  const api = useMemo(() => new AgentApi(transport), [transport]);
  const [socket, setSocket] = useState<AgentSocket | null>(null);
  const [socketState, setSocketState] = useState<SocketState>("connecting");
  const [tasks, setTasks] = useState<Map<string, TaskInfo>>(new Map());
  const me = useQuery({ queryKey: ["me", agentKey], queryFn: api.me, retry: false });
  const info = useQuery({ queryKey: ["info", agentKey], queryFn: api.info, retry: false });

  useEffect(() => {
    if (!me.data) return;
    const s = api.socket();
    setSocket(s);
    s.subscribe(["servers", "tasks"]);
    const offs = [
      s.onState(setSocketState),
      s.on("server://status", (st) => {
        patchServers(qc, agentKey, (l) => l.map((v) => (v.id === st.server_id ? { ...v, status: st } : v)));
        qc.setQueryData<ServerView>(qk.server(agentKey, st.server_id), (old) => (old ? { ...old, status: st } : old));
      }),
      s.on("servers://changed", (srv) => {
        const list = qc.getQueryData<ServerView[]>(qk.servers(agentKey));
        if (list && !list.some((v) => v.id === srv.id)) qc.invalidateQueries({ queryKey: qk.servers(agentKey) });
        else patchServers(qc, agentKey, (l) => l.map((v) => (v.id === srv.id ? { ...v, ...srv } : v)));
        qc.setQueryData<ServerView>(qk.server(agentKey, srv.id), (old) => (old ? { ...old, ...srv } : old));
      }),
      s.on("servers://removed", ({ id }) => patchServers(qc, agentKey, (l) => l.filter((v) => v.id !== id))),
      s.on("task://update", (task) => {
        setTasks((m) => new Map(m).set(task.id, task));
        if (task.status !== "running") {
          const sid = task.instance_id?.startsWith("server:") ? task.instance_id.slice(7) : null;
          qc.invalidateQueries({ queryKey: qk.servers(agentKey) });
          if (sid) qc.invalidateQueries({ queryKey: [agentKey, sid] });
        }
      }),
    ];
    api.tasks().then((list) => setTasks((m) => new Map([...list.map((x) => [x.id, x] as const), ...m])), () => undefined);
    return () => {
      offs.forEach((o) => o());
      s.close();
      setSocket(null);
    };
  }, [api, agentKey, me.data, qc]);

  const value = useMemo<AgentCtx | null>(() => {
    if (!me.data || !info.data || !socket) return null;
    const perms = new Set(me.data.permissions);
    return { key: agentKey, api, socket, me: me.data, info: info.data, base, remote, can: (p) => perms.has(p), tasks, socketState };
  }, [me.data, info.data, socket, agentKey, api, base, remote, tasks, socketState]);

  if (!value) {
    return <>{fallback({ error: me.error ?? info.error, loading: me.isLoading || info.isLoading || (!!me.data && !socket), retry: () => (me.refetch(), info.refetch()) })}</>;
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useServers() {
  const { api, key } = useAgent();
  return useQuery({ queryKey: qk.servers(key), queryFn: api.servers, staleTime: 10_000 });
}

export function useServer(id: string) {
  const { api, key } = useAgent();
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.server(key, id),
    queryFn: () => api.server(id),
    initialData: () => qc.getQueryData<ServerView[]>(qk.servers(key))?.find((s) => s.id === id),
    staleTime: 5_000,
  });
}

export function useLog(serverId: string) {
  const { socket } = useAgent();
  const [lines, setLines] = useState<LogLine[]>([]);
  useEffect(() => {
    setLines([]);
    const topic = `log:${serverId}`;
    const off = socket.on("server://log", (p) => {
      if (p.server_id !== serverId) return;
      setLines((old) => {
        const last = old.length ? old[old.length - 1].seq : -1;
        const fresh = p.lines.filter((l) => l.seq > last);
        if (!fresh.length) return old;
        const next = old.concat(fresh);
        return next.length > 2000 ? next.slice(next.length - 2000) : next;
      });
    });
    socket.subscribe([topic]);
    return () => {
      off();
      socket.unsubscribe([topic]);
    };
  }, [socket, serverId]);
  return lines;
}

export function useResources() {
  const { socket, api, key } = useAgent();
  const initial = useQuery({ queryKey: ["resources", key], queryFn: api.resources, staleTime: 5_000 });
  const [live, setLive] = useState<Resources | null>(null);
  const [history, setHistory] = useState<{ cpu: number; mem: number }[]>([]);
  useEffect(() => {
    const off = socket.on("agent://resources", (r) => {
      setLive(r);
      setHistory((h) => [...h.slice(-59), { cpu: r.cpu_percent, mem: r.mem_used / r.mem_total }]);
    });
    socket.subscribe(["resources"]);
    return () => {
      off();
      socket.unsubscribe(["resources"]);
    };
  }, [socket]);
  return { data: live ?? initial.data ?? null, history, error: initial.error };
}

export function useTask(id: string | null): TaskInfo | null {
  const { tasks } = useAgent();
  return id ? (tasks.get(id) ?? null) : null;
}
