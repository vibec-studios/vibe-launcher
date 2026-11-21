import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { GameState, LogLine } from "./types";
import { activeRuns, aggregate, isActive, runsOf } from "./sessions";

const MAX_LOG = 50_000;

interface GameStore {
  runs: Record<string, GameState>;
  states: Record<string, GameState>;
  logs: Record<string, LogLine[]>;
  setState: (s: GameState) => void;
  setAll: (list: GameState[]) => void;
  appendLogs: (runId: string, lines: LogLine[]) => void;
  setLogs: (runId: string, lines: LogLine[]) => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  runs: {},
  states: {},
  logs: {},
  setState: (s) => {
    const runs = { ...get().runs };
    let logs = get().logs;
    if (!runs[s.run_id] && s.state === "preparing") {
      for (const k in runs) {
        if (runs[k].instance_id !== s.instance_id || isActive(runs[k])) continue;
        delete runs[k];
        if (logs[k]) {
          logs = { ...logs };
          delete logs[k];
        }
      }
    }
    runs[s.run_id] = s;
    set({ runs, states: aggregate(runs), logs });
  },
  setAll: (list) => {
    const runs = Object.fromEntries(list.map((s) => [s.run_id, s]));
    set({ runs, states: aggregate(runs) });
  },
  appendLogs: (runId, lines) => {
    const cur = get().logs[runId] ?? [];
    const next = cur.length + lines.length > MAX_LOG ? cur.slice(cur.length + lines.length - MAX_LOG) : cur.slice();
    next.push(...lines);
    set({ logs: { ...get().logs, [runId]: next } });
  },
  setLogs: (runId, lines) => set({ logs: { ...get().logs, [runId]: lines } }),
}));

export function useGameState(instanceId: string): GameState | undefined {
  return useGameStore((s) => s.states[instanceId]);
}

export function useRun(runId: string | null | undefined): GameState | undefined {
  return useGameStore((s) => (runId ? s.runs[runId] : undefined));
}

export function useInstanceRuns(instanceId: string): GameState[] {
  return useGameStore(useShallow((s) => runsOf(s.runs, instanceId)));
}

export function useActiveRuns(): GameState[] {
  return useGameStore(useShallow((s) => activeRuns(s.runs)));
}

export function isRunning(s: GameState | undefined) {
  return isActive(s);
}
