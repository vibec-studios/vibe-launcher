import type { ReactNode } from "react";
import type { FileEntry } from "@/lib/types";
import { Spinner } from "@/components/ui";
import { dirName } from "../util";

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
