import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { api } from "@/lib/api";
import type { OptSyncCategory, OptSyncInfo, SyncArea, SyncKey } from "@/lib/types";

export const OPTSYNC_KEY = ["optsync"] as const;
export const ALL: OptSyncCategory[] = ["controls", "keybinds", "sound", "video", "language", "accessibility"];
export const AREAS: SyncArea[] = ["resourcepacks", "shaderpacks", "servers", "screenshots", "hotbars", "command_history"];
export const FOLDER_AREAS: SyncArea[] = ["resourcepacks", "shaderpacks", "screenshots"];
/** Vorauswahl beim ersten Einschalten: was fast jeder gleich haben will. Grafik (Leistung je Instanz verschieden),
 *  Shader (brauchen einen Shader-Mod) und Screenshots (optional) bleiben aus. */
export const DEFAULT_ON: SyncKey[] = ["controls", "keybinds", "sound", "language", "accessibility", "resourcepacks", "servers"];

export function useOptSync() {
  const qc = useQueryClient();
  // Nach dem Spielen hat der Abgleich evtl. etwas geändert (Backend-Event `sync://changed`)
  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    listen("sync://changed", () => void qc.invalidateQueries({ queryKey: OPTSYNC_KEY }))
      .then((f) => (gone ? f() : (off = f)))
      .catch(() => {});
    return () => {
      gone = true;
      off?.();
    };
  }, [qc]);
  return useQuery({ queryKey: OPTSYNC_KEY, queryFn: api.optsyncGet, staleTime: 30_000 });
}

/** Unterstützt diese Version die Pack-Auswahl (ab 1.13)? */
export function packSelection(mc: string) {
  const m = /^1\.(\d+)/.exec(mc);
  return !m || Number(m[1]) >= 13;
}

export function sharedOf(info: OptSyncInfo | undefined, area: SyncArea) {
  return info?.shared.find((s) => s.area === area);
}
