// Dateibaum des Datei-Bereichs: virtualisierte Zeilen (Ordner werden beim Aufklappen geladen), Spalten für
// Größe und Änderungsdatum, Kontextmenü je Eintrag und Tastatursteuerung (Pfeile, Enter, F2, Entf, Strg+D …).
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, ClipboardCopy, Copy, ExternalLink, FilePlus, FolderInput, FolderPlus, Pencil, Trash2, FileText } from "lucide-react";
import type { FileEntry } from "@/lib/types";
import { formatBytes } from "@/lib/format";
import { ContextItem, ContextMenu, ContextSeparator, Spinner, cn } from "@/components/ui";
import { useLang, useT } from "@/i18n";
import { FileIcon, dirName, fullDate, useShortDate } from "./util";

export const ROW_H = 28;

export type Row =
  | { type: "entry"; entry: FileEntry; depth: number; open: boolean }
  | { type: "note"; key: string; depth: number; text: ReactNode; dir: string };

/** Sichtbare Zeilen: Ordner nur, wenn aufgeklappt und geladen (sonst Ladezeile). */
export function buildRows(dirs: Map<string, FileEntry[] | undefined>, expanded: Set<string>, emptyText: string): Row[] {
  const rows: Row[] = [];
  const walk = (dir: string, depth: number) => {
    for (const e of dirs.get(dir) ?? []) {
      const open = e.is_dir && expanded.has(e.path);
      rows.push({ type: "entry", entry: e, depth, open });
      if (!open) continue;
      const kids = dirs.get(e.path);
      if (!kids) rows.push({ type: "note", key: `${e.path}/…`, depth: depth + 1, text: <Spinner size={11} />, dir: e.path });
      else if (!kids.length) rows.push({ type: "note", key: `${e.path}/∅`, depth: depth + 1, text: emptyText, dir: e.path });
      else walk(e.path, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

/** Aktionen, die Baum, Kontextmenü und Kopfzeile gemeinsam nutzen. */
export interface FileActions {
  open: (e: FileEntry) => void;
  newItem: (kind: "file" | "folder", dir: string) => void;
  importInto: (dir: string, folder: boolean) => void;
  rename: (e: FileEntry) => void;
  duplicate: (e: FileEntry) => void;
  remove: (e: FileEntry) => void;
  reveal: (path: string) => void;
  copyPath: (path: string, relative: boolean) => void;
}

/** Ordner, in den „Neu“/„Importieren“ für diesen Eintrag gehen. */
export const targetDir = (e: FileEntry | null | undefined) => (!e ? "" : e.is_dir ? e.path : dirName(e.path));

export function EntryMenu({ entry, actions }: { entry: FileEntry; actions: FileActions }) {
  const t = useT();
  const dir = targetDir(entry);
  return (
    <>
      {!entry.is_dir && (
        <ContextItem icon={<FileText size={14} />} shortcut="Enter" onSelect={() => actions.open(entry)}>
          {t("files.act.open")}
        </ContextItem>
      )}
      <ContextItem icon={<FilePlus size={14} />} shortcut="Strg+N" onSelect={() => actions.newItem("file", dir)}>
        {t("files.act.new_file")}
      </ContextItem>
      <ContextItem icon={<FolderPlus size={14} />} shortcut="Strg+⇧+N" onSelect={() => actions.newItem("folder", dir)}>
        {t("files.act.new_folder")}
      </ContextItem>
      <ContextItem icon={<FolderInput size={14} />} onSelect={() => actions.importInto(dir, false)}>
        {t("files.act.import_files")}
      </ContextItem>
      <ContextSeparator />
      <ContextItem icon={<Pencil size={14} />} shortcut="F2" onSelect={() => actions.rename(entry)}>
        {t("files.act.rename")}
      </ContextItem>
      <ContextItem icon={<Copy size={14} />} shortcut="Strg+D" onSelect={() => actions.duplicate(entry)}>
        {t("files.act.duplicate")}
      </ContextItem>
      <ContextSeparator />
      <ContextItem icon={<ClipboardCopy size={14} />} shortcut="Strg+⇧+C" onSelect={() => actions.copyPath(entry.path, false)}>
        {t("files.act.copy_path")}
      </ContextItem>
      <ContextItem icon={<ClipboardCopy size={14} />} onSelect={() => actions.copyPath(entry.path, true)}>
        {t("files.act.copy_rel")}
      </ContextItem>
      <ContextItem icon={<ExternalLink size={14} />} onSelect={() => actions.reveal(entry.path)}>
        {t("files.act.reveal")}
      </ContextItem>
      <ContextSeparator />
      <ContextItem icon={<Trash2 size={14} />} shortcut="Entf" danger onSelect={() => actions.remove(entry)}>
        {t("files.act.delete")}
      </ContextItem>
    </>
  );
}

export function RootMenu({ actions }: { actions: FileActions }) {
  const t = useT();
  return (
    <>
      <ContextItem icon={<FilePlus size={14} />} onSelect={() => actions.newItem("file", "")}>
        {t("files.act.new_file")}
      </ContextItem>
      <ContextItem icon={<FolderPlus size={14} />} onSelect={() => actions.newItem("folder", "")}>
        {t("files.act.new_folder")}
      </ContextItem>
      <ContextItem icon={<FolderInput size={14} />} onSelect={() => actions.importInto("", false)}>
        {t("files.act.import_files")}
      </ContextItem>
      <ContextItem icon={<FolderInput size={14} />} onSelect={() => actions.importInto("", true)}>
        {t("files.act.import_folder")}
      </ContextItem>
      <ContextSeparator />
      <ContextItem icon={<ClipboardCopy size={14} />} onSelect={() => actions.copyPath("", false)}>
        {t("files.act.copy_path")}
      </ContextItem>
      <ContextItem icon={<ExternalLink size={14} />} onSelect={() => actions.reveal("")}>
        {t("files.act.reveal")}
      </ContextItem>
    </>
  );
}

const TreeRow = memo(function TreeRow({
  row,
  selected,
  opened,
  dirty,
  dropTarget,
  actions,
  onPick,
}: {
  row: Extract<Row, { type: "entry" }>;
  selected: boolean;
  opened: boolean;
  dirty: boolean;
  dropTarget: boolean;
  actions: FileActions;
  onPick: (row: Extract<Row, { type: "entry" }>, how: "click" | "menu") => void;
}) {
  const e = row.entry;
  const t = useT();
  const lang = useLang((s) => s.lang);
  const short = useShortDate();
  const title = `${e.path}\n${t("files.modified")}: ${fullDate(e.modified, lang)}${e.is_dir ? "" : ` · ${formatBytes(e.size)}`}`;
  return (
    <ContextMenu content={<EntryMenu entry={e} actions={actions} />}>
      <div
        role="treeitem"
        aria-selected={selected}
        aria-expanded={e.is_dir ? row.open : undefined}
        data-drop-dir={e.is_dir ? e.path : dirName(e.path)}
        data-path={e.path}
        title={title}
        onClick={() => onPick(row, "click")}
        onDoubleClick={() => !e.is_dir && actions.open(e)}
        onContextMenu={() => onPick(row, "menu")}
        className={cn(
          "flex h-full w-full cursor-default select-none items-center gap-1.5 pr-3 text-left text-[13px] transition-colors duration-100",
          selected ? "bg-surface3 text-white" : "text-text hover:bg-white/[.04]",
          opened && "shadow-[inset_2px_0_0_var(--accent)]",
          e.kind === "binary" && !selected && "text-muted",
          dropTarget && "bg-accent/15 outline outline-1 -outline-offset-1 outline-accent",
        )}
        style={{ paddingLeft: 8 + row.depth * 14 }}
      >
        {e.is_dir ? (
          <ChevronRight size={13} className={cn("shrink-0 text-dim transition-transform duration-100", row.open && "rotate-90")} />
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        <FileIcon entry={e} open={row.open} />
        <span className="min-w-0 flex-1 truncate">{e.name}</span>
        {dirty && <span className="h-1.5 w-1.5 shrink-0 bg-warn" />}
        <span className="w-[58px] shrink-0 text-right text-[11.5px] tabular-nums text-dim">{e.is_dir ? (e.children ?? "") : formatBytes(e.size)}</span>
        <span className="w-[60px] shrink-0 text-right text-[11.5px] tabular-nums text-dim">{short(e.modified)}</span>
      </div>
    </ContextMenu>
  );
});

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
