import type { GameState } from "./types";

export const isActive = (s: GameState | undefined) => !!s && (s.state === "running" || s.state === "preparing");

const rank = (s: GameState) => (s.state === "running" ? 2 : s.state === "preparing" ? 1 : 0);

const runNo = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);

export function byAge(a: GameState, b: GameState) {
  return a.created_at - b.created_at || runNo(a.run_id) - runNo(b.run_id);
}

export function pickPrimary(list: GameState[]): GameState | undefined {
  let best: GameState | undefined;
  for (const s of list) {
    if (!best || rank(s) > rank(best) || (rank(s) === rank(best) && byAge(s, best) > 0)) best = s;
  }
  return best;
}

export function aggregate(runs: Record<string, GameState>): Record<string, GameState> {
  const per: Record<string, GameState[]> = {};
  for (const k in runs) (per[runs[k].instance_id] ??= []).push(runs[k]);
  const out: Record<string, GameState> = {};
  for (const id in per) out[id] = pickPrimary(per[id])!;
  return out;
}

export function normUuid(u: string | null | undefined) {
  return (u ?? "").replace(/-/g, "").toLowerCase();
}

export function runsOf(runs: Record<string, GameState>, instanceId: string): GameState[] {
  return Object.values(runs)
    .filter((s) => s.instance_id === instanceId)
    .sort(byAge);
}

export function activeRuns(runs: Record<string, GameState>): GameState[] {
  return Object.values(runs).filter(isActive).sort(byAge);
}

export function accountBusy(runs: Record<string, GameState>, uuid: string | null | undefined): GameState | undefined {
  const want = normUuid(uuid);
  if (!want) return undefined;
  return activeRuns(runs).find((s) => normUuid(s.account_uuid) === want);
}

export function formatUptime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
