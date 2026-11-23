import type { CV } from "./parse.ts";
import { escapeIdent, quote, serialize } from "./serialize.ts";
import type { Mode } from "./values.ts";
import { prefixFor } from "./values.ts";
import {
  BOOST,
  CSS_PSEUDO_CLASSES,
  CSS_PSEUDO_ELEMENTS,
  CSS_PSEUDO_IDENT_FUNCTIONS,
  CSS_PSEUDO_NTH_FUNCTIONS,
  CSS_PSEUDO_SELECTOR_FUNCTIONS,
  LOCK_ATTR,
  PREVIEW_ATTR,
  PROTECT_ATTR,
  SCOPE_ATTR,
} from "../rules.ts";

type Simple =
  | { k: "type"; v: string }
  | { k: "class"; v: string }
  | { k: "id"; v: string }
  | { k: "attr"; name: string; op?: string; value?: string; mod?: string }
  | { k: "pc"; name: string }
  | { k: "fn"; name: string; sel?: Complex[]; raw?: string };
type Comb = " " | ">" | "+" | "~";
export interface Complex {
  parts: (Simple[] | Comb)[];
  pe?: string;
  peStates: string[];
}

const COMBS = [">", "+", "~"];
const LEGACY_PE = ["before", "after", "first-line", "first-letter"];
const PE_STATES = ["hover", "active", "focus"];

function attribute(body: CV[]): Simple | null {
  const v = body.filter((x) => x.t !== "ws");
  const name = v[0];
  if (name?.t !== "ident" || name.v.toLowerCase().startsWith("data-vt")) return null;
  if (v.length === 1) return { k: "attr", name: name.v };
  let k = 1;
  let op = "";
  const a = v[k];
  if (a?.t === "delim" && a.v === "=") {
    op = "=";
    k++;
  } else if (a?.t === "delim" && "~|^$*".includes(a.v) && v[k + 1]?.t === "delim" && (v[k + 1] as { v: string }).v === "=") {
    op = `${a.v}=`;
    k += 2;
  } else return null;
  const val = v[k];
  if (val?.t !== "ident" && val?.t !== "str") return null;
  k++;
  const mod = v[k];
  if (mod && (mod.t !== "ident" || !["i", "s"].includes(mod.v.toLowerCase()) || v.length > k + 1)) return null;
  return { k: "attr", name: name.v, op, value: val.v, mod: mod ? (mod as { v: string }).v.toLowerCase() : undefined };
}

function nthOk(args: CV[]): boolean {
  return args.every((x) => x.t === "ws" || x.t === "num" || x.t === "dim" || (x.t === "ident" && x.v.toLowerCase() !== "of") || (x.t === "delim" && (x.v === "+" || x.v === "-")));
}

function complex(list: CV[], relative: boolean, inner: boolean, depth: number): Complex | null {
  const parts: (Simple[] | Comb)[] = [];
  let cur: Simple[] = [];
  let pending: Comb | null = null;
  let sawWs = false;
  let pe: string | undefined;
  const peStates: string[] = [];
  let i = 0;
  const at = (k: number) => list[k];
  while (i < list.length && at(i).t === "ws") i++;
  let end = list.length;
  while (end > i && at(end - 1).t === "ws") end--;
  if (i >= end) return null;
  for (; i < end; i++) {
    const x = at(i);
    if (x.t === "ws") {
      sawWs = true;
      continue;
    }
    if (pe) {
      if (x.t === ":" && at(i + 1)?.t === "ident" && PE_STATES.includes((at(i + 1) as { v: string }).v.toLowerCase())) {
        peStates.push((at(i + 1) as { v: string }).v.toLowerCase());
        i++;
        continue;
      }
      return null;
    }
    if (x.t === "delim" && COMBS.includes(x.v)) {
      if (cur.length) {
        parts.push(cur);
        cur = [];
      } else if (pending && pending !== " ") return null;
      else if (!parts.length && !relative) return null;
      pending = x.v as Comb;
      sawWs = false;
      continue;
    }
    if (cur.length && sawWs) {
      parts.push(cur);
      cur = [];
      pending = " ";
    }
    if (!cur.length && pending) {
      parts.push(pending);
      pending = null;
    }
    sawWs = false;
    if (x.t === "ident" || (x.t === "delim" && x.v === "*")) {
      if (cur.length || (at(i + 1)?.t === "delim" && (at(i + 1) as { v: string }).v === "|")) return null;
      cur.push({ k: "type", v: x.t === "ident" ? x.v : "*" });
    } else if (x.t === "delim" && x.v === ".") {
      const n = at(i + 1);
      if (n?.t !== "ident") return null;
      cur.push({ k: "class", v: n.v });
      i++;
    } else if (x.t === "hash") {
      if (!x.id) return null;
      cur.push({ k: "id", v: x.v });
    } else if (x.t === "block" && x.open === "[") {
      const a = attribute(x.body);
      if (!a) return null;
      cur.push(a);
    } else if (x.t === ":") {
      const n = at(i + 1);
      if (n?.t === ":") {
        const m = at(i + 2);
        if (inner || m?.t !== "ident" || !CSS_PSEUDO_ELEMENTS.includes(m.v.toLowerCase())) return null;
        pe = m.v.toLowerCase();
        i += 2;
      } else if (n?.t === "ident") {
        const name = n.v.toLowerCase();
        if (LEGACY_PE.includes(name) && !inner) pe = name;
        else if (CSS_PSEUDO_CLASSES.includes(name)) cur.push({ k: "pc", name });
        else return null;
        i++;
      } else if (n?.t === "fn") {
        const name = n.name.toLowerCase();
        if (CSS_PSEUDO_SELECTOR_FUNCTIONS.includes(name)) {
          if (depth >= 3) return null;
          const sel = selectorList(n.args, name === "has", true, depth + 1);
          if (!sel) return null;
          cur.push({ k: "fn", name, sel });
        } else if (CSS_PSEUDO_NTH_FUNCTIONS.includes(name) && nthOk(n.args)) cur.push({ k: "fn", name, raw: serialize(n.args).trim() });
        else if (CSS_PSEUDO_IDENT_FUNCTIONS.includes(name) && n.args.filter((a) => a.t !== "ws").every((a) => a.t === "ident" || a.t === "str")) {
          cur.push({ k: "fn", name, raw: serialize(n.args).trim() });
        } else return null;
        i++;
      } else return null;
    } else return null;
  }
  if (pending || (!cur.length && !pe)) return null;
  if (cur.length) parts.push(cur);
  else if (pe) parts.push([{ k: "type", v: "*" }]);
  return { parts, pe, peStates };
}

export function selectorList(list: CV[], relative = false, inner = false, depth = 0): Complex[] | null {
  const groups: CV[][] = [[]];
  for (const x of list) {
    if (x.t === ",") groups.push([]);
    else groups[groups.length - 1].push(x);
  }
  const out: Complex[] = [];
  for (const g of groups) {
    const c = complex(g, relative, inner, depth);
    if (!c) return null;
    out.push(c);
  }
  return out;
}

function guard(mode: Mode): string {
  if (mode === "preview") return `${BOOST}:where([${PREVIEW_ATTR}] *):not(:where([${LOCK_ATTR}]))`;
  return `${BOOST}:where([${SCOPE_ATTR}],[${SCOPE_ATTR}] *):not(:where([${PROTECT_ATTR}],[${PROTECT_ATTR}] *,[${LOCK_ATTR}]))`;
}

function simple(s: Simple, mode: Mode): string {
  const pre = prefixFor(mode);
  switch (s.k) {
    case "type":
      return s.v === "*" ? "*" : escapeIdent(s.v);
    case "class":
      return `.${escapeIdent(pre + s.v)}`;
    case "id":
      return `#${escapeIdent(pre + s.v)}`;
    case "attr": {
      if (!s.op) return `[${escapeIdent(s.name)}]`;
      const op = mode !== "clean" && s.op === "=" && s.name.toLowerCase() === "data-part" ? "~=" : s.op;
      return `[${escapeIdent(s.name)}${op}${quote(s.value ?? "")}${s.mod ? ` ${s.mod}` : ""}]`;
    }
    case "pc":
      return `:${s.name}`;
    case "fn":
      return `:${s.name}(${s.sel ? s.sel.map((c) => one(c, mode, false)).join(", ") : (s.raw ?? "")})`;
  }
}

const isRootish = (c: Simple[]) => c.some((s) => (s.k === "pc" && s.name === "root") || (s.k === "type" && ["html", "body"].includes(s.v.toLowerCase())));

function one(c: Complex, mode: Mode, outer: boolean): string {
  let out = "";
  const parts = [...c.parts];
  const last = parts[parts.length - 1] as Simple[];
  if (outer && mode !== "clean" && !c.pe && isRootish(last)) parts.push(" ", [{ k: "type", v: "*" }]);
  parts.forEach((p, idx) => {
    if (typeof p === "string") out += p === " " ? " " : ` ${p} `;
    else {
      const body = p.map((s) => simple(s, mode)).join("");
      const tail = outer && mode !== "clean" && idx === parts.length - 1;
      const scopeRoot = tail && parts.length > c.parts.length;
      out += scopeRoot ? `:where([${mode === "preview" ? PREVIEW_ATTR : SCOPE_ATTR}] > *)${guard(mode)}` : tail ? `${body}${guard(mode)}` : body;
    }
  });
  if (c.pe) out += `::${c.pe}${c.peStates.map((x) => `:${x}`).join("")}`;
  return out;
}

export function selectorText(list: Complex[], mode: Mode): string {
  return list.map((c) => one(c, mode, true)).join(mode === "clean" ? ", " : ",\n");
}
