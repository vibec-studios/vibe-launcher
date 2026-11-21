import type { MouseEvent } from "react";
import { useTask } from "@/lib/queries";
import type { ProjectHit } from "@/lib/types";
import type { InstallProject } from "@/components/content/installStore";
import { useInstallTasks } from "@/components/content/install";

export type P = InstallProject & Pick<ProjectHit, "game_versions" | "loaders" | "manual_download">;

export const stop = (e: MouseEvent) => e.stopPropagation();

/** Laufender Fortschritt für eine Instanz/ein Pack (oder null). */
export function useInstallProgress(key: string) {
  const taskId = useInstallTasks((s) => s.tasks[key]);
  return useTask(taskId);
}
