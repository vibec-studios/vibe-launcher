import { create } from "zustand";
import type { InstanceTab } from "@/app/router";
import type { InstanceArea } from "@/lib/simple-mode";

// ------------------------------------------------------------------ Bereiche
// Tabs wie in der Modrinth App: Inhalte, Welten, Logs, Dateien, Backups; Einstellungen als Popup über das Zahnrad
// im Kopf (alte Deep-Links `?tab=settings` öffnen das Popup).
// Die URL behält die bisherigen Tab-Werte (Deep-Links bleiben gültig): content/resourcepacks/shaders öffnen die
// Inhalte (mit passendem Typ-Filter), worlds/servers die Welten.
export type Area = InstanceArea;
export const areaOf: Record<InstanceTab, Area> = {
  content: "content",
  resourcepacks: "content",
  shaders: "content",
  worlds: "worlds",
  servers: "worlds",
  logs: "logs",
  files: "files",
  backups: "backups",
  settings: "content",
};

/** Zuletzt geöffnete Unterseite je Bereich (bleibt beim Wechsel erhalten). */
export const useLastSub = create<Partial<Record<Area, InstanceTab>>>(() => ({}));
