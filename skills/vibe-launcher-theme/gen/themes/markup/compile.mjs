import { sanitizeStyleAttr } from "../css/sanitize.mjs";
import { prefixFor } from "../css/values.mjs";
function attr(name, v, pre, mode, maps, report) {
    if (name === "class") return v.split(" ").map((c)=>pre + c).join(" ");
    if (name === "id") return pre + v;
    if (name === "href") return `#${pre}${v.slice(1)}`;
    if (name === "style") return sanitizeStyleAttr(v, mode, report, maps.keyframes, maps.fonts);
    return v.replace(/url\(\s*(['"]?)#(.*?)\1\s*\)/gi, (_m, _q, id)=>`url(#${pre}${id.trim()})`);
}
export function compileMarkup(nodes, mode, maps, report) {
    const pre = prefixFor(mode);
    return nodes.map((n)=>{
        if (n.t !== "el") return n;
        const attrs = n.attrs.map(([k, v])=>[
                k,
                attr(k, v, pre, mode, maps, report)
            ]).filter(([, v])=>v !== "");
        return {
            ...n,
            attrs,
            kids: compileMarkup(n.kids, mode, maps, report)
        };
    });
}
export function placeholdersOf(nodes, out = new Set()) {
    for (const n of nodes){
        if (n.t === "ph") out.add(n.k);
        else if (n.t === "el") placeholdersOf(n.kids, out);
    }
    return out;
}
export function fillText(nodes, values) {
    return nodes.map((n)=>n.t === "tx" ? n.v : n.t === "ph" ? values[n.k] ?? "" : fillText(n.kids, values)).join("");
}
