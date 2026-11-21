import { call } from "./call";
import type * as T from "../types";

export const systemApi = {
  // ---------------------------------------------------------------- Einstellungen / System / Aufgaben
  settingsGet: () => call<T.Settings>("settings_get"),
  settingsSet: (settings: T.Settings) => call<T.Settings>("settings_set", { settings }),
  /** Hintergrund-Datei in den Datenordner kopieren; gibt den neuen Pfad zurück. */
  appearanceImportBackground: (path: string, slot: "image" | "video") => call<string>("appearance_import_background", { path, slot }),
  appearanceThemeWrite: (path: string, content: string) => call<void>("appearance_theme_write", { path, content }),
  appearanceThemeRead: (path: string) => call<string>("appearance_theme_read", { path }),
  /** Eigenes Bild fürs App-Icon (bzw. `slot` "discord" für den Discord-Status) übernehmen; gibt den gespeicherten Pfad zurück. */
  appIconImport: (path: string, slot?: "discord") => call<string>("app_icon_import", { path, slot: slot ?? null }),
  /** App-Icon-Vorschau als data:-URL. */
  appIconPreview: (motif: string, color: string, image: string | null, size?: number) => call<string>("app_icon_preview", { motif, color, image, size }),
  systemInfo: () => call<T.SystemInfo>("system_info"),
  tasksList: () => call<T.TaskInfo[]>("tasks_list"),
  taskCancel: (id: string) => call<boolean>("task_cancel", { id }),
  tasksClear: () => call<void>("tasks_clear"),
  openPath: (path: string) => call<void>("open_path", { path }),
  openDataDir: () => call<void>("open_data_dir"),
  updateCheck: () => call<T.UpdateInfo | null>("update_check"),
  updateInstall: (force = false) => call<string>("update_install", { force }),
  updateBlockers: () => call<T.UpdateBlockers>("update_blockers"),
  gpuSettingsOpen: () => call<void>("gpu_settings_open"),
  launchSkipStep: (taskId: string) => call<void>("launch_skip_step", { taskId }),
  datadirPreview: (target: string | null) => call<T.DataDirPreview>("datadir_preview", { target }),
  datadirMove: (target: string) => call<string>("datadir_move", { target }),
};
