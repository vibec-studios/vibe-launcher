import type { MNode } from "./sanitize.ts";
import type { Report } from "../report.ts";
import { sanitizeStyleAttr } from "../css/sanitize.ts";
import type { Mode } from "../css/values.ts";
import { prefixFor } from "../css/values.ts";

export interface CompileMaps {
  keyframes: Map<string, string>;
  fonts: Map<string, string>;
}

function attr(name: string, v: string, pre: string, mode: Mode, maps: CompileMaps, report: Report): string {
  if (name === "class") return v.split(" ").map((c) => pre + c).join(" ");
  if (name === "id") return pre + v;
  if (name === "href") return `#${pre}${v.slice(1)}`;
  if (name === "style") return sanitizeStyleAttr(v, mode, report, maps.keyframes, maps.fonts);
  return v.replace(/url\(\s*(['"]?)#(.*?)\1\s*\)/gi, (_m, _q, id: string) => `url(#${pre}${id.trim()})`);
}

export function compileMarkup(nodes: MNode[], mode: Mode, maps: CompileMaps, report: Report): MNode[] {
  const pre = prefixFor(mode);
  return nodes.map((n) => {
    if (n.t !== "el") return n;
    const attrs = n.attrs.map(([k, v]) => [k, attr(k, v, pre, mode, maps, report)] as [string, string]).filter(([, v]) => v !== "");
    return { ...n, attrs, kids: compileMarkup(n.kids, mode, maps, report) };
  });
}

export function placeholdersOf(nodes: MNode[], out = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (n.t === "ph") out.add(n.k);
    else if (n.t === "el") placeholdersOf(n.kids, out);
  }
  return out;
}

export function fillText(nodes: MNode[], values: Partial<Record<string, string>>): string {
  return nodes.map((n) => (n.t === "tx" ? n.v : n.t === "ph" ? (values[n.k] ?? "") : fillText(n.kids, values))).join("");
}
