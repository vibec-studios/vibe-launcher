import type { CV, Declaration } from "./parse.ts";
import { quote, rawJoin, serialize } from "./serialize.ts";
import type { Report } from "../report.ts";
import { CSS_BLOCKED_PROPERTIES, CSS_FONT_DESCRIPTORS, CSS_FUNCTIONS, DANGEROUS, DATA_FONT, DATA_IMAGE, LIMITS } from "../rules.ts";

export type Mode = "clean" | "scoped" | "preview";

export interface DeclContext {
  report: Report;
  mode: Mode;
  keyframes: Map<string, string>;
  fonts: Map<string, string>;
}

const UNICODE_RANGE = /^\s*[uU]\+[0-9a-fA-F?]{1,6}(-[0-9a-fA-F]{1,6})?(\s*,\s*[uU]\+[0-9a-fA-F?]{1,6}(-[0-9a-fA-F]{1,6})?)*\s*$/;
const CUSTOM_PROP = /^--[a-zA-Z0-9_-]{1,62}$/;
const MOTION = /^(-webkit-)?(animation|transition)(-duration|-delay|-iteration-count)?$/;
const FUNCTION_IDENTS = ["url", "src", "image-set", "-webkit-image-set", "image", "element", "-moz-element", "cross-fade", "paint", "expression", "attr"];
export const FAMILY = /^[\p{L}\p{N} _-]{1,40}$/u;

export function prefixFor(mode: Mode): string {
  return mode === "scoped" ? "vt-" : mode === "preview" ? "vtp-" : "";
}

function urlOk(url: string, ctx: DeclContext, font: boolean): boolean {
  const u = url.trim();
  if (font && DATA_FONT.test(u)) return ctx.report.font(u);
  if (!font && DATA_IMAGE.test(u)) return ctx.report.image(u);
  ctx.report.warn("css.url", u.slice(0, 40));
  return false;
}

function single(args: CV[]): CV | null {
  const v = args.filter((x) => x.t !== "ws");
  return v.length === 1 ? v[0] : null;
}

export function walk(list: CV[], ctx: DeclContext, font = false): boolean {
  for (const x of list) {
    switch (x.t) {
      case "url":
        if (!urlOk(x.v, ctx, font)) return false;
        break;
      case "fn": {
        const name = x.name.toLowerCase();
        if (name === "url") {
          const arg = single(x.args);
          if (arg?.t !== "str" || !urlOk(arg.v, ctx, font)) {
            if (arg?.t !== "str") ctx.report.warn("css.url");
            return false;
          }
          break;
        }
        if (!CSS_FUNCTIONS.includes(name)) {
          ctx.report.warn("css.value", `${name}()`);
          return false;
        }
        if (!walk(x.args, ctx, font)) return false;
        break;
      }
      case "block":
        if (x.open === "{") {
          ctx.report.warn("css.nested");
          return false;
        }
        if (!walk(x.body, ctx, font)) return false;
        break;
      case "str":
      case "ident":
        if (DANGEROUS.test(x.v) || (x.t === "ident" && FUNCTION_IDENTS.includes(x.v.toLowerCase()))) {
          ctx.report.warn("css.value", x.v.slice(0, 30));
          return false;
        }
        break;
      case "badstr":
      case "badurl":
      case "at":
      case "cdo":
      case "cdc":
        ctx.report.warn("css.value");
        return false;
      case "delim":
        if (x.v === "\\") return false;
        break;
    }
  }
  return true;
}

function renameIdents(list: CV[], map: Map<string, string>): CV[] {
  return list.map((x) => {
    if (x.t === "ident" && map.has(x.v.toLowerCase())) return { t: "ident", v: map.get(x.v.toLowerCase()) as string };
    if (x.t === "str" && map.has(x.v.toLowerCase())) return { t: "str", v: map.get(x.v.toLowerCase()) as string };
    if (x.t === "fn") return { ...x, args: renameIdents(x.args, map) };
    return x;
  });
}

function splitCommas(list: CV[]): CV[][] {
  const out: CV[][] = [[]];
  for (const x of list) {
    if (x.t === ",") out.push([]);
    else out[out.length - 1].push(x);
  }
  return out.map((g) => {
    let a = 0;
    let b = g.length;
    while (a < b && g[a].t === "ws") a++;
    while (b > a && g[b - 1].t === "ws") b--;
    return g.slice(a, b);
  });
}

export function familyName(list: CV[]): string | null {
  const v = list.filter((x) => x.t !== "ws");
  if (v.length === 1 && v[0].t === "str") return v[0].v.trim();
  if (v.length && v.every((x) => x.t === "ident")) return v.map((x) => (x as { v: string }).v).join(" ");
  return null;
}

function fontFamilies(list: CV[], map: Map<string, string>): string {
  return splitCommas(list)
    .map((g) => {
      const n = familyName(g);
      const m = n ? map.get(n.toLowerCase()) : undefined;
      return m ? quote(m) : serialize(g);
    })
    .join(", ");
}

function fontSrc(list: CV[], ctx: DeclContext): string | null {
  const ok: string[] = [];
  for (const g of splitCommas(list)) {
    const parts = g.filter((x) => x.t !== "ws");
    const [u, ...rest] = parts;
    const url = u?.t === "url" ? u.v : u?.t === "fn" && u.name.toLowerCase() === "url" ? (single(u.args) as { v?: string } | null)?.v : undefined;
    const extraOk = rest.every((x) => x.t === "fn" && ["format", "tech"].includes(x.name.toLowerCase()) && x.args.every((a) => a.t === "str" || a.t === "ident" || a.t === "ws" || a.t === ","));
    if (typeof url !== "string" || !extraOk || !urlOk(url, ctx, true)) continue;
    ok.push([`url(${quote(url.trim())})`, ...rest.map((x) => serialize([x]))].join(" "));
  }
  if (!ok.length) {
    ctx.report.warn("css.font");
    return null;
  }
  return ok.join(", ");
}

function zIndex(list: CV[]): string | null {
  const v = list.filter((x) => x.t !== "ws");
  if (v.length !== 1) return null;
  const x = v[0];
  if (x.t === "ident" && ["auto", "inherit", "initial", "unset", "revert"].includes(x.v.toLowerCase())) return x.v.toLowerCase();
  if (x.t === "num" && x.int) return String(Math.max(-LIMITS.zIndex, Math.min(LIMITS.zIndex, x.v)));
  return null;
}

export function declaration(d: Declaration, ctx: DeclContext, fontFace = false): string | null {
  const custom = d.name.startsWith("--");
  const name = custom ? d.name : d.name.toLowerCase();
  const imp = d.important && !MOTION.test(name) ? " !important" : "";
  if (custom && !CUSTOM_PROP.test(name)) {
    ctx.report.warn("css.property", name);
    return null;
  }
  if (CSS_BLOCKED_PROPERTIES.includes(name) || CSS_BLOCKED_PROPERTIES.includes(name.replace(/^-(webkit|moz|ms|o)-/, ""))) {
    ctx.report.warn("css.property", name);
    return null;
  }
  if (fontFace && !CSS_FONT_DESCRIPTORS.includes(name)) {
    ctx.report.warn("css.property", name);
    return null;
  }
  if (fontFace && name === "unicode-range") {
    const raw = rawJoin(d.value);
    return UNICODE_RANGE.test(raw) ? `${name}: ${raw.trim()}` : null;
  }
  if (fontFace && name === "src") {
    const src = fontSrc(d.value, ctx);
    return src ? `src: ${src}` : null;
  }
  if (!walk(d.value, ctx)) return null;
  if (fontFace && name === "font-family") {
    const fam = familyName(d.value);
    if (!fam || !FAMILY.test(fam)) return null;
    return `font-family: ${quote(prefixFor(ctx.mode) + fam)}`;
  }
  if (name === "position" && d.value.some((x) => x.t === "ident" && x.v.toLowerCase() === "fixed")) {
    ctx.report.warn("css.value", "position: fixed");
    return null;
  }
  if (name === "z-index") {
    const z = zIndex(d.value);
    if (z === null) ctx.report.warn("css.value", "z-index");
    return z === null ? null : `z-index: ${z}${imp}`;
  }
  if (ctx.mode !== "clean" && (name === "animation" || name === "animation-name")) return `${name}: ${serialize(renameIdents(d.value, ctx.keyframes))}${imp}`;
  if (ctx.mode !== "clean" && name === "font-family") return `${name}: ${fontFamilies(d.value, ctx.fonts)}${imp}`;
  if (ctx.mode !== "clean" && name === "font") return `${name}: ${serialize(renameIdents(d.value, ctx.fonts))}${imp}`;
  const value = serialize(d.value);
  if (!value.trim() && !custom) return null;
  return `${name}: ${value}${imp}`;
}
