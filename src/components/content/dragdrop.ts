// Datei-Drag&Drop aufs Fenster. Ein globaler Tauri-Listener (GlobalDropZone) verteilt Ereignisse:
// Ablageziele (z. B. die Mod-Liste) registrieren sich mit ihrem Element; liegt der Zeiger darüber,
// übernimmt das Ziel, sonst greift der globale Import.
import { create } from "zustand";

export interface DropTarget {
  id: string;
  el: HTMLElement;
  /** Nimmt das Ziel diese Dateien an? */
  accepts: (paths: string[]) => boolean;
  onDrop: (paths: string[]) => void;
}

interface DragState {
  /** Gezogene Dateien (null = kein Drag aktiv) */
  paths: string[] | null;
  /** ID des Ziels unter dem Zeiger */
  over: string | null;
}

export const useDragState = create<DragState>(() => ({ paths: null, over: null }));

const targets = new Map<string, DropTarget>();

export function registerDropTarget(t: DropTarget): () => void {
  targets.set(t.id, t);
  return () => {
    if (targets.get(t.id) === t) targets.delete(t.id);
  };
}

/** Ziel unter der Position (CSS-Pixel), das die Dateien annimmt. */
export function hitTarget(x: number, y: number, paths: string[]): DropTarget | null {
  for (const t of targets.values()) {
    if (!t.el.isConnected) continue;
    const r = t.el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && t.accepts(paths)) return t;
  }
  return null;
}
