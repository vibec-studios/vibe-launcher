import { useCallback, useEffect, useId, useRef } from "react";
import { registerDropTarget, useDragState } from "@/components/content/dragdrop";

export function useFileDrop(importPaths: (dir: string, paths: string[]) => Promise<void>) {
  const dropId = useId();
  const rootEl = useRef<HTMLDivElement>(null);
  const dragPos = useDragState((s) => (s.over === dropId ? s.pos : null));
  const dropDirAt = useCallback((pos: { x: number; y: number }) => {
    const el = document.elementFromPoint(pos.x, pos.y) as HTMLElement | null;
    return el?.closest<HTMLElement>("[data-drop-dir]")?.dataset.dropDir ?? "";
  }, []);
  const dropDir = dragPos ? dropDirAt(dragPos) : null;
  const importRef = useRef(importPaths);
  importRef.current = importPaths;
  useEffect(() => {
    const el = rootEl.current;
    if (!el) return;
    return registerDropTarget({ id: dropId, el, accepts: (paths) => paths.length > 0, onDrop: (paths, pos) => void importRef.current(dropDirAt(pos), paths) });
  }, [dropId, dropDirAt]);

  return { rootEl, dragPos, dropDir };
}
