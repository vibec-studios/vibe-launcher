import { create } from "zustand";

export type ImportMode = "file" | "launcher";
interface ImportState {
  open: boolean;
  path: string | null;
  /** "file" = Modpack-Datei, "launcher" = aus anderem Launcher übernehmen */
  mode: ImportMode;
}
export const useImportDialog = create<ImportState>(() => ({ open: false, path: null, mode: "file" }));

/** Import-Dialog öffnen, optional direkt mit einer Datei oder im Launcher-Modus. */
export function openImport(path: string | null = null, mode?: ImportMode) {
  useImportDialog.setState((s) => ({ open: true, path, mode: path ? "file" : (mode ?? s.mode) }));
}

export const PACK_EXTENSIONS = ["mrpack", "zip", "vlpack"];
