import { parseMarkup } from "./parse.mjs";
import { sanitizeStyleAttr } from "../css/sanitize.mjs";
import { DANGEROUS, DATA_IMAGE, HTML_ATTRS, HTML_TAGS, HTML_VOID, LIMITS, LONG_ATTRS, MARKUP_DROP, PLACEHOLDERS, SVG_ATTRS, SVG_TAGS } from "../rules.mjs";
const SVG_MAP = new Map(SVG_TAGS.map((t)=>[
        t.toLowerCase(),
        t
    ]));
const lowerMap = (list)=>new Map(list.map((a)=>[
            a.toLowerCase(),
            a
        ]));
const SVG_ATTR_MAP = new Map(Object.entries(SVG_ATTRS).map(([k, v])=>[
        k,
        lowerMap(v)
    ]));
const HTML_ATTR_MAP = new Map(Object.entries(HTML_ATTRS).map(([k, v])=>[
        k,
        lowerMap(v)
    ]));
const NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,40}$/;
const LOCAL_REF = /^#[A-Za-z_][A-Za-z0-9_-]{0,40}$/;
const URL_FN = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
const PH = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;
const MAX_TEXT = 2000;
function attrName(ns, tag, raw) {
    const lower = raw.toLowerCase() === "xlink:href" ? "href" : raw.toLowerCase();
    const maps = ns === "svg" ? [
        SVG_ATTR_MAP.get(tag),
        SVG_ATTR_MAP.get("*")
    ] : [
        HTML_ATTR_MAP.get(tag),
        HTML_ATTR_MAP.get("*")
    ];
    for (const m of maps){
        const hit = m?.get(lower);
        if (hit) return hit;
    }
    return null;
}
function urlRefsOk(v) {
    for (const m of v.matchAll(URL_FN))if (!LOCAL_REF.test(m[2].trim())) return false;
    return true;
}
function attrValue(name, value, tag, w) {
    const v = value.trim();
    const max = name === "src" ? LIMITS.imageBytes * 1.4 : LONG_ATTRS.includes(name) ? LIMITS.longAttrChars : LIMITS.attrChars;
    if (v.length > max) {
        w.report.warn("markup.limit", name);
        return null;
    }
    if (name === "src") return tag === "img" && DATA_IMAGE.test(v) && w.report.image(v) ? v : null;
    if (name === "href") return LOCAL_REF.test(v) ? v : null;
    if (name === "class") {
        const names = v.split(/\s+/).filter((c)=>NAME.test(c)).slice(0, 12);
        return names.length ? names.join(" ") : null;
    }
    if (name === "id") return NAME.test(v) ? v : null;
    if (name === "style") {
        const css = sanitizeStyleAttr(v, "clean", w.report);
        return css || null;
    }
    if (DANGEROUS.test(v) || /data:/i.test(v) || !urlRefsOk(v)) {
        w.report.warn("markup.url", name);
        return null;
    }
    return v;
}
function textNodes(v, w) {
    const out = [];
    let last = 0;
    const text = v.length > MAX_TEXT ? v.slice(0, MAX_TEXT) : v;
    for (const m of text.matchAll(PH)){
        const key = m[1].toLowerCase();
        if (!PLACEHOLDERS.includes(key)) {
            w.report.warn("markup.placeholder", m[1]);
            continue;
        }
        if (m.index > last) out.push({
            t: "tx",
            v: text.slice(last, m.index)
        });
        out.push({
            t: "ph",
            k: key
        });
        last = m.index + m[0].length;
    }
    if (last < text.length) out.push({
        t: "tx",
        v: text.slice(last)
    });
    return out;
}
function count(w) {
    if (w.stopped) return false;
    if (w.nodes >= LIMITS.slotNodes || w.budget.total >= LIMITS.totalNodes) {
        w.report.warn("markup.limit");
        w.stopped = true;
        return false;
    }
    w.nodes++;
    w.budget.total++;
    return true;
}
function element(raw, ns, depth, w) {
    const lower = raw.tag.toLowerCase();
    if (depth > LIMITS.depth) {
        w.report.warn("markup.limit");
        return [];
    }
    let tag = null;
    let childNs = ns;
    if (ns === "html" && lower === "svg") {
        tag = "svg";
        childNs = "svg";
    } else if (ns === "html" && HTML_TAGS.includes(lower)) tag = lower;
    else if (ns === "svg") tag = SVG_MAP.get(lower) ?? null;
    if (!tag) {
        w.report.warn("markup.element", lower);
        if (ns === "svg" || MARKUP_DROP.includes(lower) || lower.includes(":")) return [];
        return children(raw.kids, ns, depth, w);
    }
    if (!count(w)) return [];
    const attrs = [];
    for (const [k, value] of raw.attrs){
        const name = attrName(childNs, tag, k);
        if (!name) {
            if (!/^xmlns(:|$)/i.test(k)) w.report.warn("markup.attribute", k.toLowerCase().slice(0, 30));
            continue;
        }
        if (attrs.some(([a])=>a === name)) continue;
        const v = attrValue(name, value, tag, w);
        if (v === null) {
            if (name === "src" || name === "href") w.report.warn("markup.url", name);
            continue;
        }
        attrs.push([
            name,
            v
        ]);
    }
    if (tag === "img" && !attrs.some(([a])=>a === "src") || tag === "use" && !attrs.some(([a])=>a === "href")) return [];
    const kids = HTML_VOID.includes(tag) ? [] : children(raw.kids, childNs, depth + 1, w);
    return [
        {
            t: "el",
            ns: childNs,
            tag,
            attrs,
            kids
        }
    ];
}
function children(list, ns, depth, w) {
    const out = [];
    for (const k of list){
        if (w.stopped) break;
        if (k.t === "tx") {
            if (ns === "svg" && !k.v.trim()) continue;
            for (const n of textNodes(k.v, w))if (count(w)) out.push(n);
        } else out.push(...element(k, ns, depth, w));
    }
    return out;
}
export function sanitizeMarkup(src, report, budget) {
    const w = {
        report,
        budget,
        nodes: 0,
        stopped: false
    };
    return children(parseMarkup(src), "html", 0, w);
}
const escText = (v)=>v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (v)=>escText(v).replace(/"/g, "&quot;");
export function serializeMarkup(nodes) {
    return nodes.map((n)=>{
        if (n.t === "tx") return escText(n.v);
        if (n.t === "ph") return `{{${n.k}}}`;
        const attrs = n.attrs.map(([k, v])=>` ${k}="${escAttr(v)}"`).join("");
        if (n.ns === "html" && HTML_VOID.includes(n.tag)) return `<${n.tag}${attrs}>`;
        if (n.ns === "svg" && !n.kids.length) return `<${n.tag}${attrs}/>`;
        return `<${n.tag}${attrs}>${serializeMarkup(n.kids)}</${n.tag}>`;
    }).join("");
}
