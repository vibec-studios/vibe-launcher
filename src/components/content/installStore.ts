import { create } from "zustand";
import type { ProjectHit } from "@/lib/types";

export type InstallProject = Pick<ProjectHit, "source" | "id" | "slug" | "title" | "icon_url" | "project_type" | "loaders" | "game_versions" | "author" | "manual_download">;

export interface InstallTarget {
  project: InstallProject;
  instanceId?: string | null;
  versionId?: string | null;
}

export const useInstallDialog = create<{ target: InstallTarget | null; seq: number }>(() => ({ target: null, seq: 0 }));

export function openInstall(target: InstallTarget) {
  useInstallDialog.setState((s) => ({ target, seq: s.seq + 1 }));
}
