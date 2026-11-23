import { THEMES } from "../appearance/themes.mjs";
import { PALETTE_KEYS, PALETTE_VARS } from "./rules.mjs";
const HEX = /^#[0-9a-f]{6}$/;
const SURFACES = [
    "frame",
    "canvas",
    "surface",
    "surface2",
    "surface3",
    "overlay"
];
export function normalizeHex(v) {
    if (typeof v !== "string") return null;
    const h = v.trim().toLowerCase();
    const full = h.startsWith("#") ? h : `#${h}`;
    return HEX.test(full) ? full : null;
}
export function validatePalette(raw, report) {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== "object" || Array.isArray(raw)) {
        report.warn("palette.value");
        return {};
    }
    const out = {};
    for (const [k, v] of Object.entries(raw)){
        if (!PALETTE_KEYS.includes(k)) {
            report.warn("palette.key", k.slice(0, 24));
            continue;
        }
        const hex = normalizeHex(v);
        if (!hex) report.warn("palette.value", k);
        else out[k] = hex;
    }
    return out;
}
function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (c)=>{
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(n >> 16 & 255) + 0.7152 * ch(n >> 8 & 255) + 0.0722 * ch(n & 255);
}
export function contrast(a, b) {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function onAccentFor(hex) {
    const l = luminance(hex);
    return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#000000" : "#ffffff";
}
export function baseSwatch(values) {
    const base = THEMES[values.theme] ?? THEMES.standard;
    const light = values.tone === "light";
    return base.tokens.tone === "light" === light ? base.swatch : THEMES[light ? "light" : "standard"].swatch;
}
function effective(p, values) {
    const sw = baseSwatch(values);
    return {
        canvas: p.canvas ?? sw.canvas,
        surface: p.surface ?? sw.surface,
        surface2: p.surface2 ?? sw.surface2,
        text: p.text ?? sw.text,
        muted: p.muted ?? sw.muted,
        dim: p.dim ?? sw.muted
    };
}
function textMin(p, values) {
    const e = effective(p, values);
    return Math.min(contrast(e.text, e.canvas), contrast(e.text, e.surface), contrast(e.text, e.surface2));
}
function drop(p, keys, report) {
    const out = {
        ...p
    };
    const gone = keys.filter((k)=>out[k] !== undefined);
    for (const k of gone)delete out[k];
    if (gone.length) report.warn("contrast.dropped", gone.join(", "));
    return out;
}
export function checkContrast(input, values, report) {
    let p = {
        ...input
    };
    if (textMin(p, values) < 3) {
        p = drop(p, [
            "text"
        ], report);
        if (textMin(p, values) < 3) p = drop(p, SURFACES, report);
    } else if (textMin(p, values) < 4.5) report.warn("contrast.low", "text");
    const e = effective(p, values);
    const muted = Math.min(contrast(e.muted, e.surface), contrast(e.muted, e.canvas));
    if (muted < 2.2) p = drop(p, [
        "muted"
    ], report);
    else if (muted < 3) report.warn("contrast.low", "muted");
    if (Math.min(contrast(e.dim, e.surface), contrast(e.dim, e.canvas)) < 1.8) p = drop(p, [
        "dim"
    ], report);
    if (p.on_accent) {
        const c = contrast(p.on_accent, values.accent);
        if (c < 3) p = drop(p, [
            "on_accent"
        ], report);
        else if (c < 4.5) report.warn("contrast.low", "on_accent");
    }
    if (contrast(values.accent, e.canvas) < 1.8) report.warn("contrast.low", "accent");
    return p;
}
export function paletteVars(p) {
    return PALETTE_KEYS.filter((k)=>p[k]).map((k)=>[
            PALETTE_VARS[k],
            p[k]
        ]);
}
export const PALETTE_CSS_VARS = Object.values(PALETTE_VARS);
