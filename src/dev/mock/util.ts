import { emit } from "@tauri-apps/api/event";
import type { EventMap, EventName } from "@/lib/events";
import type { TaskInfo } from "@/lib/types";

export type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

type EmitRewrite = (name: string, payload: unknown) => [string, unknown] | null;
let rewrite: EmitRewrite | null = null;

export function setEmitRewrite(fn: EmitRewrite) {
  rewrite = fn;
}

export function mockEmit<K extends EventName>(name: K, payload: EventMap[K]) {
  const r = rewrite?.(name, payload);
  if (r) void emit(r[0], r[1]);
  else void emit(name, payload);
}

export const tasks = new Map<string, TaskInfo>();

/** Simulierte Aufgabe mit Fortschritt über `ms` Millisekunden. Gibt die Task-ID zurück. */
export function fakeTask(kind: string, title: string, instance_id: string | null, ms = 2500, onDone?: () => void, fail?: string): string {
  const id = Math.random().toString(36).slice(2);
  const t: TaskInfo = { id, kind, title, instance_id, progress: 0, message: "Startet …", status: "running", error: null, started_at: Date.now() };
  tasks.set(id, t);
  mockEmit("task://update", { ...t });
  const start = Date.now();
  const timer = setInterval(() => {
    const p = Math.min(1, (Date.now() - start) / ms);
    const cur = tasks.get(id)!;
    if (cur.status !== "running") return clearInterval(timer);
    if (p >= 1) {
      clearInterval(timer);
      const done: TaskInfo = { ...cur, progress: 1, status: fail ? "failed" : "done", error: fail ?? null, message: null };
      tasks.set(id, done);
      mockEmit("task://update", done);
      if (!fail) onDone?.();
      return;
    }
    const next = { ...cur, progress: p, message: `Lädt Dateien … ${Math.round(p * 100)} %` };
    tasks.set(id, next);
    mockEmit("task://update", next);
  }, 150);
  return id;
}
