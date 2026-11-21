// Dateibaum des Datei-Bereichs: virtualisierte Zeilen (Ordner werden beim Aufklappen geladen), Spalten für
// Größe und Änderungsdatum, Kontextmenü je Eintrag und Tastatursteuerung (Pfeile, Enter, F2, Entf, Strg+D …).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FileEntry } from "@/lib/types";
import { dirName } from "./util";
import { TreeRow } from "./tree/TreeRow";
import type { FileActions, Row } from "./tree/rows";

export { buildRows, targetDir, type FileActions, type Row } from "./tree/rows";
export { EntryMenu, RootMenu } from "./tree/menus";

export const ROW_H = 28;
export interface FileTreeHandle {
  focus: () => void;
  scrollTo: (path: string) => void;
}

export const FileTree = forwardRef<
  FileTreeHandle,
  {
    rows: Row[];
    selected: string | null;
    openPath: string | null;
    dirty: boolean;
    dropDir: string | null;
    actions: FileActions;
    onSelect: (path: string | null) => void;
    onToggle: (path: string, open?: boolean) => void;
    onKey?: (e: KeyboardEvent<HTMLDivElement>, entry: FileEntry | null) => boolean;
  }
>(function FileTree({ rows, selected, openPath, dirty, dropDir, actions, onSelect, onToggle, onKey }, ref) {
  const scroller = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_H, overscan: 16 });
  const index = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => r.type === "entry" && m.set(r.entry.path, i));
    return m;
  }, [rows]);
  const pendingScroll = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => scroller.current?.focus({ preventScroll: true }),
    scrollTo: (path) => {
      const i = index.get(path);
      if (i === undefined) pendingScroll.current = path;
      else v.scrollToIndex(i, { align: "auto" });
    },
  }));

  // Nach dem Einblenden (z. B. Suche geleert) zur Markierung springen
  useEffect(() => {
    const i = selected ? index.get(selected) : undefined;
    if (i !== undefined) v.scrollToIndex(i, { align: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ziel einer früheren scrollTo-Anfrage erscheint erst, wenn sein Ordner geladen ist
  useEffect(() => {
    const p = pendingScroll.current;
    if (!p) return;
    const i = index.get(p);
    if (i !== undefined) {
      pendingScroll.current = null;
      v.scrollToIndex(i, { align: "center" });
    }
  }, [index, v]);

  // Stabil halten, damit die memoisierten Zeilen nicht bei jeder Änderung neu rendern
  const cbs = useRef({ onSelect, onToggle, actions });
  cbs.current = { onSelect, onToggle, actions };
  const pick = useCallback((row: Extract<Row, { type: "entry" }>, how: "click" | "menu") => {
    const c = cbs.current;
    c.onSelect(row.entry.path);
    if (how === "click") {
      if (row.entry.is_dir) c.onToggle(row.entry.path);
      else c.actions.open(row.entry);
    }
  }, []);

  const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = selected ? index.get(selected) : undefined;
    const cur = i !== undefined ? (rows[i] as Extract<Row, { type: "entry" }>) : null;
    if (onKey?.(e, cur?.entry ?? null)) return;
    const move = (to: number) => {
      // Notizzeilen (lädt / leer) überspringen
      const dir = to < (i ?? -1) ? -1 : 1;
      let j = Math.max(0, Math.min(rows.length - 1, to));
      while (rows[j] && rows[j].type !== "entry") j += dir;
      const r = rows[j];
      if (r?.type === "entry") {
        onSelect(r.entry.path);
        v.scrollToIndex(j, { align: "auto" });
      }
    };
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(i === undefined ? 0 : i + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(i === undefined ? 0 : i - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(rows.length - 1);
        break;
      case "ArrowRight":
        if (!cur) return;
        e.preventDefault();
        if (cur.entry.is_dir && !cur.open) onToggle(cur.entry.path, true);
        else if (cur.entry.is_dir) move(i! + 1);
        break;
      case "ArrowLeft": {
        if (!cur) return;
        e.preventDefault();
        if (cur.entry.is_dir && cur.open) onToggle(cur.entry.path, false);
        else {
          const parent = dirName(cur.entry.path);
          if (parent) {
            onSelect(parent);
            const j = index.get(parent);
            if (j !== undefined) v.scrollToIndex(j, { align: "auto" });
          }
        }
        break;
      }
      case "Enter":
        if (!cur) return;
        e.preventDefault();
        if (cur.entry.is_dir) onToggle(cur.entry.path);
        else actions.open(cur.entry);
        break;
    }
  };

  return (
    <div
      ref={scroller}
      role="tree"
      tabIndex={0}
      onKeyDown={keyDown}
      className="scroll h-full outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-line2)]"
    >
      <div className="relative w-full" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((it) => {
          const r = rows[it.index];
          return (
            <div
              key={r.type === "entry" ? r.entry.path : r.key}
              className="absolute left-0 top-0 w-full"
              style={{ height: ROW_H, transform: `translateY(${it.start}px)` }}
            >
              {r.type === "entry" ? (
                <TreeRow
                  row={r}
                  selected={r.entry.path === selected}
                  opened={r.entry.path === openPath}
                  dirty={dirty && r.entry.path === openPath}
                  dropTarget={dropDir !== null && r.entry.is_dir && r.entry.path === dropDir}
                  actions={actions}
                  onPick={pick}
                />
              ) : (
                <div data-drop-dir={r.dir} className="flex h-full items-center text-[12px] italic text-dim" style={{ paddingLeft: 8 + r.depth * 14 + 19 }}>
                  {r.text}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
