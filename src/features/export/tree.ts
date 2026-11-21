import type { ExportEntry, PackFormat } from "@/lib/types";

export type Fmt = Extract<PackFormat, "mrpack" | "curseforge" | "vlpack">;
export const FORMATS: { value: Fmt; ext: string }[] = [
  { value: "mrpack", ext: "mrpack" },
  { value: "curseforge", ext: "zip" },
  { value: "vlpack", ext: "vlpack" },
];

// ------------------------------------------------------------------ Dateibaum

export interface Node {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  depth: number;
  children: Node[];
  /** Alle Datei-Pfade unterhalb (für Ordner) bzw. der eigene Pfad */
  leaves: string[];
}

export function buildTree(entries: ExportEntry[]): Node[] {
  const root: Node = { path: "", name: "", isDir: true, size: 0, depth: -1, children: [], leaves: [] };
  const byPath = new Map<string, Node>([["", root]]);
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const ensure = (path: string): Node => {
    const hit = byPath.get(path);
    if (hit) return hit;
    const i = path.lastIndexOf("/");
    const parent = ensure(i === -1 ? "" : path.slice(0, i));
    const n: Node = { path, name: path.slice(i + 1), isDir: true, size: 0, depth: parent.depth + 1, children: [], leaves: [] };
    parent.children.push(n);
    byPath.set(path, n);
    return n;
  };
  for (const e of sorted) {
    const p = e.path.replace(/\\/g, "/").replace(/\/$/, "");
    if (e.is_dir) {
      const n = ensure(p);
      n.size = Math.max(n.size, e.size);
    } else {
      const i = p.lastIndexOf("/");
      const parent = ensure(i === -1 ? "" : p.slice(0, i));
      const n: Node = { path: p, name: p.slice(i + 1), isDir: false, size: e.size, depth: parent.depth + 1, children: [], leaves: [p] };
      parent.children.push(n);
      byPath.set(p, n);
    }
  }
  const finish = (n: Node) => {
    n.children.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
    if (n.isDir) {
      let sum = 0;
      const leaves: string[] = [];
      for (const c of n.children) {
        finish(c);
        sum += c.size;
        leaves.push(...c.leaves);
      }
      // Ordner ohne aufgelistete Kinder zählt als ein Eintrag
      n.leaves = n.children.length ? leaves : [n.path];
      n.size = Math.max(n.size, sum);
    }
  };
  finish(root);
  return root.children;
}

/** Ausgewählte Blätter -> kompakte Include-Liste (ganze Ordner, wenn vollständig). */
export function compactInclude(nodes: Node[], sel: Set<string>): string[] {
  const out: string[] = [];
  const walk = (n: Node) => {
    const on = n.leaves.filter((l) => sel.has(l)).length;
    if (!on) return;
    if (on === n.leaves.length) out.push(n.path);
    else n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}
