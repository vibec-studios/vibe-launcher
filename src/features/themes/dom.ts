import DOMPurify from "dompurify";
import type { MNode } from "@/lib/themes/markup/sanitize";
import { HTML_ATTRS, HTML_TAGS, SVG_ATTRS, SVG_TAGS } from "@/lib/themes/rules";

const SVG_NS = "http://www.w3.org/2000/svg";
const TAGS = [...HTML_TAGS, ...SVG_TAGS].map((t) => t.toLowerCase());
const ATTRS = [...new Set([...Object.values(HTML_ATTRS).flat(), ...Object.values(SVG_ATTRS).flat()].map((a) => a.toLowerCase()))];
const PURIFY = {
  IN_PLACE: true,
  ALLOWED_TAGS: TAGS,
  ALLOWED_ATTR: ATTRS,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  ALLOWED_URI_REGEXP: /^(?:(?![a-z][a-z0-9+.-]*:)|data:image\/(?:png|webp|gif|svg\+xml)[;,])/i,
  ADD_DATA_URI_TAGS: ["img"],
  FORBID_TAGS: ["style", "script", "foreignobject", "a", "form", "input", "button", "iframe", "image", "animate", "set"],
};

export type PlaceholderRefs = [Text, string][];

function add(parent: Node, n: MNode, refs: PlaceholderRefs) {
  if (n.t === "tx") parent.appendChild(document.createTextNode(n.v));
  else if (n.t === "ph") {
    const t = document.createTextNode("");
    refs.push([t, n.k]);
    parent.appendChild(t);
  } else {
    const el = n.ns === "svg" ? document.createElementNS(SVG_NS, n.tag) : document.createElement(n.tag);
    for (const [k, v] of n.attrs) el.setAttribute(k, v);
    for (const c of n.kids) add(el, c, refs);
    parent.appendChild(el);
  }
}

export function buildSlot(target: HTMLElement, nodes: MNode[]): PlaceholderRefs {
  const refs: PlaceholderRefs = [];
  const holder = document.createElement("div");
  for (const n of nodes) add(holder, n, refs);
  DOMPurify.sanitize(holder, PURIFY);
  target.replaceChildren(...Array.from(holder.childNodes));
  return refs;
}

export function setThemeStyle(id: string, css: string | null, paused = false) {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
  const media = paused ? "not all" : "all";
  if (el.media !== media) el.media = media;
}
