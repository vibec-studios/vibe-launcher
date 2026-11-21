import { create } from "zustand";

export type ImportMode = "source" | "file" | "launcher" | "folder";
interface ImportState {
  open: boolean;
  path: string | null;
  mode: ImportMode;
}
export const useImportDialog = create<ImportState>(() => ({ open: false, path: null, mode: "source" }));

/** Import-Dialog öffnen, optional direkt mit einer Datei oder im Launcher-Modus. */
export function openImport(path: string | null = null, mode?: ImportMode) {
  useImportDialog.setState({ open: true, path, mode: path ? "file" : (mode ?? "source") });
}

export const PACK_EXTENSIONS = ["mrpack", "zip", "vlpack"];
