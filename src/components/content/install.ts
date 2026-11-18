// Installationsabläufe (Inhalte in Instanz, Modpack als neue Instanz) + Merker laufender Installationen,
// damit Karten/Knöpfe auch nach Virtualisierung/Navigation ihren Fortschritt zeigen.
import { create } from "zustand";
import { api, errorMessage, isCancelled } from "@/lib/api";
import { qk, queryClient, waitForTask } from "@/lib/queries";
import type { Instance, ProjectHit } from "@/lib/types";
import { toast } from "@/components/ui";
import { t } from "@/i18n";
import { navigateTo, openExternal } from "./util";

interface InstallTasks {
  /** `${instanceId}|${source}|${projectId}` bzw. `pack|${source}|${projectId}` -> Task-ID */
  tasks: Record<string, string>;
}
export const useInstallTasks = create<InstallTasks>(() => ({ tasks: {} }));

export const installKey = (instanceId: string, p: Pick<ProjectHit, "source" | "id">) => `${instanceId}|${p.source}|${p.id}`;
export const packKey = (p: Pick<ProjectHit, "source" | "id">) => `pack|${p.source}|${p.id}`;

function remember(key: string, taskId: string) {
  useInstallTasks.setState((s) => ({ tasks: { ...s.tasks, [key]: taskId } }));
}
function forget(key: string, taskId: string) {
  useInstallTasks.setState((s) => {
    if (s.tasks[key] !== taskId) return s;
    const next = { ...s.tasks };
    delete next[key];
    return { tasks: next };
  });
}

function instanceName(id: string): string {
  return queryClient.getQueryData<Instance[]>(qk.instances)?.find((i) => i.id === id)?.name ?? id;
}

/** Mod/Pack/Shader in eine Instanz installieren. Gibt die Task-ID zurück; Erfolg/Fehler als Toast. */
export async function startContentInstall(
  instanceId: string,
  project: Pick<ProjectHit, "source" | "id" | "title">,
  versionId?: string | null,
  opts: { silent?: boolean } = {},
): Promise<string> {
  const key = installKey(instanceId, project);
  const taskId = await api.contentInstall(instanceId, project.source, project.id, versionId ?? null);
  remember(key, taskId);
  waitForTask(taskId)
    .then(() => {
      queryClient.invalidateQueries({ queryKey: ["content", instanceId] });
      if (!opts.silent)
        toast.success(t("install.done_title", { name: project.title }), t("install.done_text", { instance: instanceName(instanceId) }), {
          label: t("install.go_instance"),
          onClick: () => navigateTo({ to: "/instances/$id", params: { id: instanceId }, search: { tab: "content" } }),
        });
    })
    .catch((e) => {
      if (!opts.silent && !isCancelled(e)) toast.error(t("install.failed", { name: project.title }), errorMessage(e));
    })
    // Kurz stehen lassen, damit der Haken sichtbar bleibt, bis die Inhaltsliste neu geladen ist
    .finally(() => setTimeout(() => forget(key, taskId), 1500));
  return taskId;
}

// ------------------------------------------------------------------ Manuelle Downloads (CurseForge ohne Freigabe)

/** Wie lange eine vorgemerkte Datei im Knopf als „Wird erwartet“ gilt (Backend beobachtet den Download-Ordner so lange). */
const EXPECT_MS = 10 * 60_000;

interface ManualExpect {
  /** installKey -> Ende der Beobachtung (ms) */
  expected: Record<string, number>;
  /** Instanz -> Download-Ordner wird bis dahin beobachtet (ms) */
  watching: Record<string, number>;
}
export const useManualExpect = create<ManualExpect>(() => ({ expected: {}, watching: {} }));

export function setWatching(instanceId: string, until: number | null) {
  if (!until) return;
  useManualExpect.setState((s) => ({ watching: { ...s.watching, [instanceId]: Math.max(until, s.watching[instanceId] ?? 0) } }));
}

/** Ende der Beobachtung des Download-Ordners für diese Instanz (ms) oder null. */
export function useWatching(instanceId: string): number | null {
  return useManualExpect((s) => s.watching[instanceId] ?? null);
}

export function useExpected(key: string): boolean {
  return useManualExpect((s) => (s.expected[key] ?? 0) > Date.now());
}

/** Datei ist eingetroffen (Event `content://manual-arrived`). */
export function manualArrived(instanceId: string, projectId: string | null) {
  useManualExpect.setState((s) => {
    const next = { ...s.expected };
    for (const k of Object.keys(next)) if (k.startsWith(`${instanceId}|`) && (!projectId || k.endsWith(`|${projectId}`))) delete next[k];
    return { expected: next };
  });
}

/**
 * „Auf CurseForge herunterladen“ (`open`) bzw. „Zur Instanz hinzufügen“: passende Datei ermitteln; ist sie doch
 * automatisch ladbar (freigegeben oder identisch auf Modrinth), normal installieren. Sonst Dateiseite öffnen,
 * Abhängigkeiten installieren, Datei in `missing.json` vormerken – das Backend beobachtet den Download-Ordner
 * und übernimmt die Datei (nur bei passendem Hash).
 */
export async function startManualDownload(
  instanceId: string,
  project: Pick<ProjectHit, "source" | "id" | "title">,
  versionId?: string | null,
  opts: { open?: boolean; silent?: boolean } = {},
): Promise<string> {
  const open = opts.open ?? true;
  let target;
  try {
    target = await api.contentManualTarget(instanceId, project.source, project.id, versionId ?? null);
  } catch (e) {
    if (!opts.silent) toast.error(t("manual.failed", { name: project.title }), errorMessage(e));
    throw e;
  }
  if (target.downloadable) return startContentInstall(instanceId, project, target.version_id, opts);
  if (open) void openExternal(target.page_url);
  const key = installKey(instanceId, project);
  const taskId = await api.contentInstall(instanceId, project.source, project.id, target.version_id, true);
  remember(key, taskId);
  useManualExpect.setState((s) => ({ expected: { ...s.expected, [key]: Date.now() + EXPECT_MS } }));
  setWatching(instanceId, Date.now() + EXPECT_MS);
  waitForTask(taskId)
    .then(() => {
      queryClient.invalidateQueries({ queryKey: ["content", instanceId] });
      if (opts.silent) return;
      const go = { label: t("install.go_instance"), onClick: () => navigateTo({ to: "/instances/$id", params: { id: instanceId }, search: { tab: "content" } }) };
      if (open) toast.info(t("manual.started_title", { name: project.title }), t("manual.started_text", { instance: instanceName(instanceId) }), go, 9000);
      else toast.success(t("manual.added_title", { name: project.title }), t("manual.added_text", { instance: instanceName(instanceId) }), go);
    })
    .catch((e) => {
      manualArrived(instanceId, project.id);
      if (!opts.silent && !isCancelled(e)) toast.error(t("install.failed", { name: project.title }), errorMessage(e));
    })
    .finally(() => forget(key, taskId));
  return taskId;
}

/**
 * Modpack als neue Instanz installieren. Nach Erfolg wird das Spiel installiert (`instanceInstall`)
 * und – wenn `navigate()` true liefert – zur neuen Instanz gewechselt.
 */
export async function startModpackInstall(
  project: Pick<ProjectHit, "source" | "id" | "title">,
  versionId?: string | null,
  navigate: () => boolean = () => true,
): Promise<string> {
  const key = packKey(project);
  const taskId = await api.modpackInstall(project.source, project.id, versionId ?? null);
  remember(key, taskId);
  waitForTask(taskId)
    .then((task) => finishNewInstance(task.instance_id, project.title, navigate()))
    .catch((e) => {
      if (!isCancelled(e)) toast.error(t("install.failed", { name: project.title }), errorMessage(e));
    })
    .finally(() => forget(key, taskId));
  return taskId;
}

/** Nach Import/Modpack: Spiel installieren und zur Instanz wechseln. */
export function finishNewInstance(instanceId: string | null, name: string, go: boolean) {
  if (!instanceId) {
    toast.success(t("install.pack_done", { name }));
    return;
  }
  api.instanceInstall(instanceId).catch((e) => toast.error(t("install.game_failed"), errorMessage(e)));
  queryClient.invalidateQueries({ queryKey: qk.instances });
  const open = () => navigateTo({ to: "/instances/$id", params: { id: instanceId }, search: { tab: "content" } });
  if (go) {
    open();
    toast.success(t("install.pack_done", { name }), t("install.pack_done_text"));
  } else {
    toast.success(t("install.pack_done", { name }), t("install.pack_done_text"), { label: t("install.go_instance"), onClick: open });
  }
}
