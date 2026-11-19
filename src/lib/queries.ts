// Gemeinsame Daten-Hooks. React Query cached alles; Backend-Events halten den Cache aktuell
// (siehe app/EventBridge.tsx) – kein Polling, keine leeren Bildschirme beim Neuladen.
import { QueryClient, useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { api } from "./api";
import type { GameState, Instance, LogLine, Server, ServerStatus, TaskInfo } from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      // Beim Neuladen alte Daten stehen lassen statt Ladeanzeige
      placeholderData: (prev: unknown) => prev,
    },
  },
});

export const qk = {
  instances: ["instances"] as const,
  instance: (id: string) => ["instance", id] as const,
  settings: ["settings"] as const,
  system: ["system"] as const,
  accounts: ["accounts"] as const,
  gameVersions: ["game-versions"] as const,
  loaderGameVersions: (loader: string) => ["loader-game-versions", loader] as const,
  loaderVersions: (loader: string, mc: string) => ["loader-versions", loader, mc] as const,
  java: ["java"] as const,
  content: (instanceId: string, kind: string) => ["content", instanceId, kind] as const,
  contentUpdates: (instanceId: string) => ["content-updates", instanceId] as const,
  worlds: (instanceId: string) => ["worlds", instanceId] as const,
  logFiles: (instanceId: string) => ["log-files", instanceId] as const,
  search: (q: unknown) => ["search", q] as const,
  project: (source: string, id: string) => ["project", source, id] as const,
  versions: (source: string, id: string, gv?: string | null, loader?: string | null) => ["versions", source, id, gv ?? null, loader ?? null] as const,
  categories: (source: string, type: string) => ["categories", source, type] as const,
};

export function useInstances() {
  return useQuery({ queryKey: qk.instances, queryFn: api.instancesList, staleTime: Infinity });
}

const selectJava = (list: Instance[]) => list.filter((i) => !i.bedrock);
/** Nur Java-Instanzen – für Auswahllisten von Mods, Modpacks, Servern, Teilen usw. (Bedrock passt dort nicht). */
export function useJavaInstances() {
  return useQuery({ queryKey: qk.instances, queryFn: api.instancesList, staleTime: Infinity, select: selectJava });
}

/** Einzelne Instanz – nimmt sofort den Eintrag aus der Liste, falls vorhanden. */
export function useInstance(id: string) {
  return useQuery({
    queryKey: qk.instance(id),
    queryFn: () => api.instanceGet(id),
    staleTime: Infinity,
    initialData: () => queryClient.getQueryData<Instance[]>(qk.instances)?.find((i) => i.id === id),
  });
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: api.settingsGet, staleTime: Infinity });
}

export function useSystemInfo() {
  return useQuery({ queryKey: qk.system, queryFn: api.systemInfo, staleTime: Infinity });
}

export function useAccounts() {
  return useQuery({ queryKey: qk.accounts, queryFn: api.accountsList, staleTime: Infinity });
}

export function useGameVersions() {
  return useQuery({ queryKey: qk.gameVersions, queryFn: () => api.gameVersions(false), staleTime: 10 * 60_000 });
}

// ------------------------------------------------------------------ Live-Zustände (Zustand-Stores)

interface TaskStore {
  tasks: Record<string, TaskInfo>;
  upsert: (t: TaskInfo) => void;
  set: (list: TaskInfo[]) => void;
  clearFinished: () => void;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: {},
  upsert: (t) => set({ tasks: { ...get().tasks, [t.id]: t } }),
  set: (list) => set({ tasks: Object.fromEntries(list.map((t) => [t.id, t])) }),
  clearFinished: () => set({ tasks: Object.fromEntries(Object.entries(get().tasks).filter(([, t]) => t.status === "running")) }),
}));

/** Alle Aufgaben, älteste zuerst. */
export function useTasks(): TaskInfo[] {
  const tasks = useTaskStore((s) => s.tasks);
  return Object.values(tasks).sort((a, b) => a.started_at - b.started_at);
}

/** Laufende Aufgabe(n) einer Instanz. */
export function useInstanceTasks(instanceId: string): TaskInfo[] {
  const tasks = useTaskStore((s) => s.tasks);
  return Object.values(tasks).filter((t) => t.instance_id === instanceId && t.status === "running");
}

/** Aufgabe per ID beobachten (z. B. nach `instanceInstall`). */
export function useTask(id: string | null | undefined): TaskInfo | undefined {
  return useTaskStore((s) => (id ? s.tasks[id] : undefined));
}

/** Promise, die erfüllt wird, wenn die Aufgabe endet (resolve bei done, reject bei failed/cancelled). */
export function waitForTask(id: string): Promise<TaskInfo> {
  return new Promise((resolve, reject) => {
    const check = (t: TaskInfo | undefined) => {
      if (!t) return false;
      if (t.status === "done") resolve(t);
      else if (t.status === "failed") reject({ kind: "error", message: t.error ?? "Fehlgeschlagen" });
      else if (t.status === "cancelled") reject({ kind: "cancelled", message: "Abgebrochen" });
      else return false;
      return true;
    };
    if (check(useTaskStore.getState().tasks[id])) return;
    const un = useTaskStore.subscribe((s) => {
      if (check(s.tasks[id])) un();
    });
  });
}

interface GameStore {
  states: Record<string, GameState>;
  /** Log-Puffer je Instanz (max. 50 000 Zeilen) */
  logs: Record<string, LogLine[]>;
  setState: (s: GameState) => void;
  setAll: (list: GameState[]) => void;
  appendLogs: (instanceId: string, lines: LogLine[]) => void;
  setLogs: (instanceId: string, lines: LogLine[]) => void;
}

const MAX_LOG = 50_000;

export const useGameStore = create<GameStore>((set, get) => ({
  states: {},
  logs: {},
  setState: (s) => set({ states: { ...get().states, [s.instance_id]: s } }),
  setAll: (list) => set({ states: Object.fromEntries(list.map((s) => [s.instance_id, s])) }),
  appendLogs: (id, lines) => {
    const cur = get().logs[id] ?? [];
    let next = cur.length + lines.length > MAX_LOG ? cur.slice(cur.length + lines.length - MAX_LOG) : cur.slice();
    // Neue Sitzung (seq beginnt von vorn) -> Puffer leeren
    if (lines.length && cur.length && lines[0].seq <= cur[cur.length - 1].seq) next = [];
    next.push(...lines);
    set({ logs: { ...get().logs, [id]: next } });
  },
  setLogs: (id, lines) => set({ logs: { ...get().logs, [id]: lines } }),
}));

export function useGameState(instanceId: string): GameState | undefined {
  return useGameStore((s) => s.states[instanceId]);
}

export function isRunning(s: GameState | undefined) {
  return !!s && (s.state === "running" || s.state === "preparing");
}

// ------------------------------------------------------------------ Lokale Server

export const sqk = {
  servers: ["servers"] as const,
  server: (id: string) => ["server", id] as const,
  addresses: (id: string) => ["server-addresses", id] as const,
  properties: (id: string) => ["server-properties", id] as const,
  propertiesRaw: (id: string) => ["server-properties-raw", id] as const,
  players: (id: string) => ["server-players", id] as const,
  worlds: (id: string) => ["server-worlds", id] as const,
  backups: (id: string) => ["server-backups", id] as const,
  modCandidates: (instanceId: string) => ["server-mod-candidates", instanceId] as const,
};

export function useServers() {
  return useQuery({ queryKey: sqk.servers, queryFn: api.serversList, staleTime: Infinity });
}

/** Einzelner Server – nimmt sofort den Eintrag aus der Liste, falls vorhanden. */
export function useServer(id: string) {
  return useQuery({
    queryKey: sqk.server(id),
    queryFn: () => api.serverGet(id),
    enabled: !!id,
    staleTime: Infinity,
    initialData: () => queryClient.getQueryData<Server[]>(sqk.servers)?.find((s) => s.id === id),
  });
}

interface ServerStore {
  statuses: Record<string, ServerStatus>;
  /** Konsolen-Puffer je Server (max. 50 000 Zeilen) */
  logs: Record<string, LogLine[]>;
  setStatus: (s: ServerStatus) => void;
  setAll: (list: ServerStatus[]) => void;
  remove: (id: string) => void;
  appendLogs: (serverId: string, lines: LogLine[]) => void;
  setLogs: (serverId: string, lines: LogLine[]) => void;
}

export const useServerStore = create<ServerStore>((set, get) => ({
  statuses: {},
  logs: {},
  setStatus: (s) => set({ statuses: { ...get().statuses, [s.server_id]: s } }),
  setAll: (list) => set({ statuses: Object.fromEntries(list.map((s) => [s.server_id, s])) }),
  remove: (id) => {
    const statuses = { ...get().statuses };
    const logs = { ...get().logs };
    delete statuses[id];
    delete logs[id];
    set({ statuses, logs });
  },
  appendLogs: (id, lines) => {
    const cur = get().logs[id] ?? [];
    let next = cur.length + lines.length > MAX_LOG ? cur.slice(cur.length + lines.length - MAX_LOG) : cur.slice();
    // Neue Sitzung (seq beginnt von vorn) -> Puffer leeren
    if (lines.length && cur.length && lines[0].seq <= cur[cur.length - 1].seq) next = [];
    next.push(...lines);
    set({ logs: { ...get().logs, [id]: next } });
  },
  setLogs: (id, lines) => set({ logs: { ...get().logs, [id]: lines } }),
}));

export function useServerStatus(serverId: string): ServerStatus | undefined {
  return useServerStore((s) => s.statuses[serverId]);
}

/** Server läuft (oder startet/stoppt gerade) */
export function isServerActive(s: ServerStatus | undefined) {
  return !!s && (s.state === "running" || s.state === "starting" || s.state === "stopping");
}
