import type { ProjectDetails, Source } from "@/lib/types";

/** Quelle der Ansicht: Inhalte-Quellen plus Hangar (Server-Plugins). */
export type ViewSource = Source | "hangar";
/** Projektdaten der Ansicht (Hangar liefert dasselbe Format). */
export type ViewProject = Omit<ProjectDetails, "source" | "project_type"> & { source: ViewSource; project_type: ProjectDetails["project_type"] | "plugin" };
