import { useCallback, useEffect, useRef, type KeyboardEvent, type MutableRefObject } from "react";
import type { FileEntry } from "@/lib/types";
import { targetDir, type FileActions } from "../FileTree";

export function useFileShortcuts(save: () => Promise<void>, dirtyRef: MutableRefObject<boolean>, actions: FileActions) {
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirtyRef.current) void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const treeKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>, entry: FileEntry | null) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const run = (f: () => void) => {
        e.preventDefault();
        f();
        return true;
      };
      if (mod && k === "n") return run(() => actions.newItem(e.shiftKey ? "folder" : "file", targetDir(entry)));
      if (!entry) return false;
      if (e.key === "F2") return run(() => actions.rename(entry));
      if (e.key === "Delete") return run(() => actions.remove(entry));
      if (mod && !e.shiftKey && k === "d") return run(() => actions.duplicate(entry));
      if (mod && e.shiftKey && k === "c") return run(() => actions.copyPath(entry.path, false));
      return false;
    },
    [actions],
  );

  return treeKey;
}
