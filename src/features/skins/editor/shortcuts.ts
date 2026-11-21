import { useEffect, useRef } from "react";
import type { SkinEditor, Tool } from "./useSkinEditor";

const TOOL_KEYS: Record<string, Tool> = { b: "brush", e: "eraser", i: "picker", g: "fill" };

export function useEditorShortcuts(ed: SkinEditor, active: boolean) {
  const ref = useRef(ed);
  ref.current = ed;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const cur = ref.current;
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (key === "z" && !e.shiftKey) cur.undo();
        else if (key === "y" || (key === "z" && e.shiftKey)) cur.redo();
        else return;
        e.preventDefault();
        return;
      }
      if (e.altKey) return;
      if (TOOL_KEYS[key]) cur.setTool(TOOL_KEYS[key]);
      else if (key === "m") cur.setMirror(!cur.mirror);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}
