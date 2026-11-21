import { create } from "zustand";
import { toast } from "@/components/ui";
import { navigateTo } from "@/components/content/util";
import { t } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { qk, queryClient, waitForTask } from "@/lib/queries";
import type { ExtSettingKey, ExternalInstance, LauncherKind } from "@/lib/types";

// ------------------------------------------------------------------ Laufende Importe (überleben Schließen des Dialogs)

export type JobStatus = "queued" | "running" | "done" | "failed";
export interface Job {
  name: string;
  status: JobStatus;
  taskId?: string;
  instanceId?: string | null;
  error?: string;
}
export interface JobState {
  jobs: Record<string, Job>;
  /** IDs der zuletzt gestarteten Runde (für die Fortschrittsansicht) */
  batch: string[];
}
export const useJobs = create<JobState>(() => ({ jobs: {}, batch: [] }));
export const setJob = (key: string, patch: Partial<Job>) =>
  useJobs.setState((s) => ({ jobs: { ...s.jobs, [key]: { ...s.jobs[key], ...patch } as Job } }));

export interface Pick {
  launcher: LauncherKind;
  inst: ExternalInstance;
  mcVersion: string | null;
}

export const PARALLEL = 2;

export async function runImports(picks: Pick[], keys: ExtSettingKey[]) {
  useJobs.setState((s) => ({
    batch: picks.map((p) => p.inst.source_path),
    jobs: { ...s.jobs, ...Object.fromEntries(picks.map((p) => [p.inst.source_path, { name: p.inst.name, status: "queued" as JobStatus }])) },
  }));
  const queue = [...picks];
  let ok = 0;
  let failed = 0;
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const key = p.inst.source_path;
      try {
        setJob(key, { status: "running" });
        const taskId = await api.importExternal(p.launcher, key, null, p.mcVersion, null, keys);
        setJob(key, { taskId });
        const done = await waitForTask(taskId);
        setJob(key, { status: "done", instanceId: done.instance_id });
        ok++;
        if (done.instance_id) api.instanceInstall(done.instance_id).catch((e) => toast.error(t("install.game_failed"), errorMessage(e)));
      } catch (e) {
        failed++;
        setJob(key, { status: "failed", error: errorMessage(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, picks.length) }, worker));
  queryClient.invalidateQueries({ queryKey: qk.instances });
  queryClient.invalidateQueries({ queryKey: ["launchers"] });
  const open = () => navigateTo({ to: "/instances" });
  if (failed === 0) toast.success(t(ok === 1 ? "ext.done_title_1" : "ext.done_title", { n: ok }), t("ext.done_text"), { label: t("ext.open"), onClick: open });
  else toast.error(t("ext.partial", { ok, failed }), undefined);
}


export async function pickDir(title: string): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ directory: true, multiple: false, title });
  return typeof res === "string" ? res : null;
}

export const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
