import { Report } from "./report.mjs";
import { SLOTS } from "./rules.mjs";
import { fontMap, keyframeMap, sanitizeCss } from "./css/sanitize.mjs";
import { sanitizeMarkup } from "./markup/sanitize.mjs";
import { compileMarkup, placeholdersOf } from "./markup/compile.mjs";
export function compileTheme(doc, mode) {
    const report = new Report();
    const css = sanitizeCss(doc.css, mode, report);
    const maps = {
        keyframes: keyframeMap(doc.css, mode),
        fonts: fontMap(doc.css, mode)
    };
    const budget = {
        total: 0
    };
    const slots = {};
    const ph = new Set();
    for (const s of SLOTS){
        const src = doc.slots[s];
        if (!src) continue;
        const nodes = compileMarkup(sanitizeMarkup(src, report, budget), mode, maps, report);
        if (!nodes.length) continue;
        slots[s] = nodes;
        placeholdersOf(nodes, ph);
    }
    return {
        css,
        slots,
        placeholders: [
            ...ph
        ]
    };
}
