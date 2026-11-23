import type { CV, CssRule } from "./parse.ts";
import { parseDeclarationList, parseDeclarations, parseRuleList, parseStylesheet } from "./parse.ts";
import { serialize } from "./serialize.ts";
import { selectorList, selectorText } from "./selector.ts";
import type { DeclContext, Mode } from "./values.ts";
import { FAMILY, declaration, familyName, prefixFor, walk } from "./values.ts";
import type { Report } from "../report.ts";
import { CSS_AT_RULES, LIMITS } from "../rules.ts";

const KEYFRAME_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;

interface State {
  ctx: DeclContext;
  rules: number;
  keyframes: number;
  fontFaces: number;
  stopped: boolean;
}

const atName = (r: CssRule & { kind: "at" }) => r.name.toLowerCase().replace(/^-(webkit|moz|o)-(?=keyframes$)/, "");

function keyframeName(prelude: CV[]): string | null {
  const v = prelude.filter((x) => x.t !== "ws");
  if (v.length !== 1) return null;
  const n = v[0].t === "ident" || v[0].t === "str" ? v[0].v : "";
  return KEYFRAME_NAME.test(n) && !["none", "initial", "inherit", "unset"].includes(n.toLowerCase()) ? n : null;
}

function fontFamilyOf(block: CV[]): string | null {
  for (const item of parseDeclarations(block)) {
    if (item.kind === "decl" && item.decl.name.toLowerCase() === "font-family") return familyName(item.decl.value);
  }
  return null;
}

function collect(rules: CssRule[], kf: Set<string>, fonts: Set<string>, depth = 0) {
  for (const r of rules) {
    if (r.kind !== "at" || !r.block || depth > LIMITS.atRuleDepth) continue;
    const name = atName(r);
    if (name === "keyframes") {
      const n = keyframeName(r.prelude);
      if (n) kf.add(n);
    } else if (name === "font-face") {
      const f = fontFamilyOf(r.block);
      if (f && FAMILY.test(f)) fonts.add(f);
    } else if (name === "media" || name === "supports" || name === "container") collect(parseRuleList(r.block), kf, fonts, depth + 1);
  }
}

function declarations(block: CV[], st: State, fontFace = false): string[] {
  const out: string[] = [];
  for (const item of parseDeclarations(block)) {
    if (item.kind === "bad") {
      st.ctx.report.warn(item.nested ? "css.nested" : "css.value");
      continue;
    }
    if (out.length >= LIMITS.declarations) {
      st.ctx.report.warn("css.limit");
      break;
    }
    const d = declaration(item.decl, st.ctx, fontFace);
    if (d) out.push(d);
  }
  return out;
}

function block(head: string, body: string[], pad: string): string {
  return `${pad}${head} {\n${body.join("\n")}\n${pad}}`;
}

function keyframes(r: CssRule & { kind: "at" }, st: State, pad: string): string | null {
  const name = keyframeName(r.prelude);
  if (!name || !r.block || ++st.keyframes > LIMITS.keyframes) {
    st.ctx.report.warn("css.at_rule", "@keyframes");
    return null;
  }
  const frames: string[] = [];
  for (const f of parseRuleList(r.block)) {
    if (f.kind !== "qual") continue;
    const sel = f.prelude.filter((x) => x.t !== "ws");
    const ok = sel.length > 0 && sel.every((x) => x.t === "," || x.t === "pct" || (x.t === "ident" && ["from", "to"].includes(x.v.toLowerCase())));
    if (!ok) continue;
    const decls = declarations(f.block, st);
    if (decls.length) frames.push(block(serialize(f.prelude).trim().replace(/\s*,\s*/g, ", "), decls.map((d) => `${pad}    ${d};`), `${pad}  `));
  }
  return frames.length ? block(`@keyframes ${st.ctx.keyframes.get(name.toLowerCase()) ?? name}`, frames, pad) : null;
}

function emit(rules: CssRule[], st: State, depth: number): string[] {
  const pad = "  ".repeat(depth);
  const out: string[] = [];
  for (const r of rules) {
    if (st.stopped) break;
    if (st.rules >= LIMITS.cssRules) {
      st.ctx.report.warn("css.limit");
      st.stopped = true;
      break;
    }
    if (r.kind === "qual") {
      const sel = selectorList(r.prelude);
      const clean = sel ? selectorText(sel, "clean") : "";
      if (!sel || sel.length > LIMITS.selectorsPerRule || clean.length > LIMITS.selectorChars) {
        st.ctx.report.warn("css.selector", serialize(r.prelude).trim().slice(0, 60));
        continue;
      }
      const decls = declarations(r.block, st);
      if (!decls.length) continue;
      st.rules++;
      out.push(block(st.ctx.mode === "clean" ? clean : selectorText(sel, st.ctx.mode), decls.map((d) => `${pad}  ${d};`), pad));
      const pseudo = sel.filter((c) => c.pe);
      if (st.ctx.mode !== "clean" && pseudo.length) out.push(block(selectorText(pseudo, st.ctx.mode), [`${pad}  pointer-events: none !important;`], pad));
      continue;
    }
    const name = atName(r);
    if (name === "charset") continue;
    if (!(CSS_AT_RULES as readonly string[]).includes(name) || !r.block) {
      st.ctx.report.warn("css.at_rule", `@${name}`);
      continue;
    }
    if (name === "keyframes") {
      const k = keyframes(r, st, pad);
      if (k) out.push(k);
      continue;
    }
    if (name === "font-face") {
      const decls = ++st.fontFaces <= LIMITS.fontFaces ? declarations(r.block, st, true) : [];
      if (decls.some((d) => d.startsWith("font-family:")) && decls.some((d) => d.startsWith("src:"))) out.push(block("@font-face", decls.map((d) => `${pad}  ${d};`), pad));
      else st.ctx.report.warn("css.font");
      continue;
    }
    if (depth >= LIMITS.atRuleDepth || !walk(r.prelude, st.ctx)) {
      st.ctx.report.warn("css.at_rule", `@${name}`);
      continue;
    }
    const inner = emit(parseRuleList(r.block), st, depth + 1);
    if (inner.length) out.push(block(`@${name} ${serialize(r.prelude).trim()}`, inner, pad));
  }
  return out;
}

export function sanitizeCss(src: string, mode: Mode, report: Report): string {
  if (!src.trim()) return "";
  const rules = parseStylesheet(src);
  const kf = new Set<string>();
  const fonts = new Set<string>();
  collect(rules, kf, fonts);
  const pre = prefixFor(mode);
  const ctx: DeclContext = {
    report,
    mode,
    keyframes: new Map([...kf].map((n) => [n.toLowerCase(), pre + n])),
    fonts: new Map([...fonts].map((n) => [n.toLowerCase(), pre + n])),
  };
  const st: State = { ctx, rules: 0, keyframes: 0, fontFaces: 0, stopped: false };
  const out = emit(rules, st, 0);
  return out.length ? `${out.join("\n\n")}\n` : "";
}

export function sanitizeStyleAttr(src: string, mode: Mode, report: Report, keyframes: Map<string, string> = new Map(), fonts: Map<string, string> = new Map()): string {
  const ctx: DeclContext = { report, mode, keyframes, fonts };
  const out: string[] = [];
  for (const item of parseDeclarationList(src)) {
    if (item.kind !== "decl") {
      report.warn("css.value");
      continue;
    }
    const d = declaration(item.decl, ctx);
    if (d) out.push(d);
    if (out.length >= LIMITS.declarations) break;
  }
  return out.join("; ");
}

export function keyframeMap(src: string, mode: Mode): Map<string, string> {
  const kf = new Set<string>();
  collect(parseStylesheet(src), kf, new Set());
  return new Map([...kf].map((n) => [n.toLowerCase(), prefixFor(mode) + n]));
}

export function fontMap(src: string, mode: Mode): Map<string, string> {
  const fonts = new Set<string>();
  collect(parseStylesheet(src), new Set(), fonts);
  return new Map([...fonts].map((n) => [n.toLowerCase(), prefixFor(mode) + n]));
}
