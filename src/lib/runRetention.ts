import type { GameState, LogLine } from "./types";
import { byAge, isActive } from "./sessions";

const KEEP_STOPPED_PER_INSTANCE = 3;
const KEEP_STOPPED_TOTAL = 8;

export function retainRuns(runs: Record<string, GameState>): Record<string, GameState> {
  const stopped = Object.values(runs)
    .filter((s) => !isActive(s))
    .sort(byAge)
    .reverse();
  const per: Record<string, number> = {};
  let kept = 0;
  let out = runs;
  for (const s of stopped) {
    const n = (per[s.instance_id] = (per[s.instance_id] ?? 0) + 1);
    if (n <= KEEP_STOPPED_PER_INSTANCE && kept < KEEP_STOPPED_TOTAL) {
      kept++;
      continue;
    }
    if (out === runs) out = { ...runs };
    delete out[s.run_id];
  }
  return out;
}

export function dropLogs(logs: Record<string, LogLine[]>, before: Record<string, GameState>, after: Record<string, GameState>): Record<string, LogLine[]> {
  let out = logs;
  for (const k in before) {
    if (after[k] || !out[k]) continue;
    if (out === logs) out = { ...logs };
    delete out[k];
  }
  return out;
}
