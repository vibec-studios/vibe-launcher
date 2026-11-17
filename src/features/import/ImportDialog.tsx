// OWNER: Frontend-Agent B. Öffnen von überall: `openImport()` bzw. `openImport(path)`.
import { create } from "zustand";

interface ImportState {
  open: boolean;
  path: string | null;
}
export const useImportDialog = create<ImportState>(() => ({ open: false, path: null }));

/** Import-Dialog öffnen, optional direkt mit einer Datei. */
export function openImport(path: string | null = null) {
  useImportDialog.setState({ open: true, path });
}

export function ImportDialog() {
  return null;
}
