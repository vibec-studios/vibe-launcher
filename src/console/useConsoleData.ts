import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "@/lib/api";
import { useGameStore } from "@/lib/gameStore";
import { byAge, isActive } from "@/lib/sessions";
import type { GameState, Instance, LogLine } from "@/lib/types";

function initialRun(): string | null {
  try {
    return new URLSearchParams(location.search).get("run");
  } catch {
    return null;
  }
}

export function pickDefault(runs: GameState[]): string | null {
  const sorted = runs.slice().sort(byAge);
  const active = sorted.filter(isActive);
  return (active[active.length - 1] ?? sorted[sorted.length - 1])?.run_id ?? null;
}

export function useConsoleData() {
  const [instances, setInstances] = useState<Record<string, Instance>>({});
  const [selected, setSelected] = useState<string | null>(initialRun);
  const runs = useGameStore((s) => s.runs);

  useEffect(() => {
    api.gameStates().then((l) => useGameStore.getState().setAll(l)).catch(() => {});
    api
      .instancesList()
      .then((l) => setInstances(Object.fromEntries(l.map((i) => [i.id, i]))))
      .catch(() => {});
    const offs = [
      listen<GameState>("game://state", (e) => {
        const known = !!useGameStore.getState().runs[e.payload.run_id];
        useGameStore.getState().setState(e.payload);
        if (!known && e.payload.state === "preparing") setSelected(e.payload.run_id);
      }),
      listen<{ run_id: string; lines: LogLine[] }>("game://log", (e) =>
        useGameStore.getState().appendLogs(e.payload.run_id, e.payload.lines),
      ),
      listen<string>("console://select", (e) => setSelected(e.payload)),
      listen<Instance>("instance://changed", (e) => setInstances((m) => ({ ...m, [e.payload.id]: e.payload }))),
    ];
    return () => offs.forEach((p) => p.then((f) => f()).catch(() => {}));
  }, []);

  const list = Object.values(runs).sort(byAge);
  const current = (selected && runs[selected]) || runs[pickDefault(list) ?? ""] || null;

  useEffect(() => {
    if (!current) return;
    const run = current.run_id;
    let dead = false;
    api
      .instanceLogSession(current.instance_id, run)
      .then((lines) => {
        if (dead) return;
        useGameStore.getState().hydrateLogs(run, lines);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [current?.run_id, current?.instance_id]);

  return { instances, runs: list, current, select: setSelected };
}
