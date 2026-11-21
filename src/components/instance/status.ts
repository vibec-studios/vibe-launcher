// Feinkörnige Live-Zustände einer Instanz. Selektoren liefern stabile Referenzen, damit nur die Stellen
// neu rendern, die den Zustand wirklich anzeigen.
import { useGameStore, useTaskStore } from "@/lib/queries";
import type { GameState, TaskInfo } from "@/lib/types";

/** Laufende Aufgabe einer Instanz (neueste), sonst undefined. */
export function useRunningTask(instanceId: string): TaskInfo | undefined {
  return useTaskStore((s) => {
    let best: TaskInfo | undefined;
    for (const k in s.tasks) {
      const t = s.tasks[k];
      if (t.instance_id === instanceId && t.status === "running" && (!best || t.started_at > best.started_at)) best = t;
    }
    return best;
  });
}

export type RunPhase = "idle" | "busy" | "preparing" | "running";

/** Spielzustand zusammengefasst: läuft / bereitet vor / Aufgabe läuft / nichts. */
export function useRunPhase(instanceId: string): { phase: RunPhase; task: TaskInfo | undefined; game: GameState | undefined } {
  const game = useGameStore((s) => s.states[instanceId]);
  const task = useRunningTask(instanceId);
  let phase: RunPhase = "idle";
  if (game?.state === "running") phase = "running";
  else if (game?.state === "preparing") phase = "preparing";
  else if (task) phase = "busy";
  return { phase, task, game };
}

/** Anzahl laufender Spiele (für die Startseite). */
export function useRunningCount(): number {
  return useGameStore((s) => {
    let n = 0;
    for (const k in s.runs) if (s.runs[k].state !== "stopped") n++;
    return n;
  });
}
