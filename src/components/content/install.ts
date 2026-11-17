// Installationsabläufe (Inhalte in Instanz, Modpack als neue Instanz) + Merker laufender Installationen,
// damit Karten/Knöpfe auch nach Virtualisierung/Navigation ihren Fortschritt zeigen.
import { create } from "zustand";
import { api, errorMessage, isCancelled } from "@/lib/api";
import { qk, queryClient, waitForTask } from "@/lib/queries";
import type { Instance, ProjectHit } from "@/lib/types";
import { toast } from "@/components/ui";
import { t } from "@/i18n";
import { navigateTo } from "./util";

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
