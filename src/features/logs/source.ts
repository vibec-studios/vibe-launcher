import { create } from "zustand";
import { api } from "@/lib/api";
import { useGameStore } from "@/lib/queries";
import { toast } from "@/components/ui";
import { formatLines, matchLogFile, uploadToMclogs } from "./logText";

// ------------------------------------------------------------------ Gewählte Quelle je Instanz

export const LIVE = "live";
export const useLogSource = create<{ src: Record<string, string> }>(() => ({ src: {} }));

/** Logs-Tab einer Instanz auf eine Datei stellen (z. B. Crash-Report aus dem Crash-Banner). */
export function showLogFile(instanceId: string, path: string) {
  useLogSource.setState((s) => ({ src: { ...s.src, [instanceId]: path } }));
}

export async function crashLogContent(instanceId: string, crashPath: string | null): Promise<string> {
  if (crashPath) {
    const files = await api.instanceLogFiles(instanceId);
    const name = matchLogFile(
      files.map((f) => f.name),
      crashPath,
    );
    if (name) return api.instanceLogRead(instanceId, name);
  }
  const run = useGameStore.getState().states[instanceId]?.run_id;
  const lines = (run ? useGameStore.getState().logs[run] : undefined) ?? (await api.instanceLogSession(instanceId, run));
  return formatLines(lines);
}

/** Crash-Report (oder ersatzweise die Sitzung) zu mclo.gs hochladen. */
export async function uploadCrash(instanceId: string, crashPath: string | null) {
  try {
    await uploadToMclogs(await crashLogContent(instanceId, crashPath));
  } catch (e) {
    toast.error(e);
  }
}

export function loadPref<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : (JSON.parse(v) as T);
  } catch {
    return d;
  }
}
export function savePref(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* egal */
  }
}
