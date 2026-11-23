#!/usr/bin/env node
import { readFileSync } from "node:fs";

const THEMES = ["standard", "winter", "graphite", "light", "midnight", "ocean", "forest", "sunset", "sakura", "nether", "end", "retro", "pixel", "pixel_light", "contrast"];
const ENUMS = {
  tone: ["dark", "dim", "oled", "light"],
  radius: ["square", "slight", "round", "custom"],
  contrast: ["normal", "high"],
  cards: ["flat", "outlined", "raised", "pixel"],
  headings: ["default", "pixel", "pixel_all"],
  font: ["inter", "inter_tight", "system", "mono"],
  sidebar_style: ["solid", "floating", "tinted"],
};
const BG_ENUMS = {
  kind: ["none", "color", "gradient", "animated"],
  gradient: ["accent", "dusk", "ocean", "ember", "forest", "pixel", "custom"],
  animated: ["aurora", "particles", "waves", "blocks"],
};
const RANGES = { radius_px: [0, 24], font_scale: [90, 115], glass: [0, 100] };
const BG_RANGES = { gradient_angle: [0, 360], dim: [0, 90], blur: [0, 40] };
const LIGHT = ["light", "sakura", "pixel_light"];
const HEX = /^#[0-9a-f]{6}$/;

const errors = [];
const warnings = [];

function isObj(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function checkEnum(path, v, allowed) {
  if (v === undefined) return warnings.push(`${path} fehlt (Standardwert wird genutzt)`);
  if (!allowed.includes(v)) errors.push(`${path} = ${JSON.stringify(v)} ist ungültig, erlaubt: ${allowed.join(", ")}`);
}

function checkHex(path, v) {
  if (v === undefined) return warnings.push(`${path} fehlt (Standardwert wird genutzt)`);
  if (typeof v !== "string" || !HEX.test(v.trim().toLowerCase().replace(/^([^#])/, "#$1"))) errors.push(`${path} = ${JSON.stringify(v)} ist keine Farbe im Format #rrggbb`);
  else if (v !== v.toLowerCase() || !v.startsWith("#")) warnings.push(`${path}: besser klein und mit # schreiben`);
}

function checkNum(path, v, [min, max]) {
  if (v === undefined) return warnings.push(`${path} fehlt (Standardwert wird genutzt)`);
  if (typeof v !== "number" || !Number.isFinite(v)) return errors.push(`${path} muss eine Zahl sein`);
  if (!Number.isInteger(v)) warnings.push(`${path} wird auf ${Math.round(v)} gerundet`);
  if (v < min || v > max) warnings.push(`${path} = ${v} liegt außerhalb ${min}–${max} und wird begrenzt`);
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

function designHints(v) {
  if (THEMES.includes(v.theme) && ENUMS.tone.includes(v.tone)) {
    const lightBase = LIGHT.includes(v.theme);
    if (lightBase !== (v.tone === "light")) warnings.push(`tone "${v.tone}" passt nicht zum Basis-Theme "${v.theme}"`);
  }
  if (typeof v.accent === "string" && HEX.test(v.accent)) {
    const l = luminance(v.accent);
    if (v.tone === "light" && l > 0.35) warnings.push("accent ist für ein helles Theme sehr hell – schlecht lesbar auf Weiß");
    if (v.tone !== "light" && l < 0.08) warnings.push("accent ist für ein dunkles Theme sehr dunkel – kaum sichtbar");
  }
  if (typeof v.glass === "number" && v.glass > 0 && isObj(v.background) && v.background.kind === "none") {
    warnings.push("glass wirkt nur mit Hintergrund (background.kind ≠ none)");
  }
}

function b64url(text) {
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const file = process.argv[2];
if (!file) {
  console.error("Aufruf: node validate.mjs <theme.vibetheme>");
  process.exit(2);
}
const raw = readFileSync(file, "utf8");
let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error(`Kein gültiges JSON: ${e.message}`);
  process.exit(1);
}
if (raw.length > 20000) errors.push("Datei ist größer als 20.000 Zeichen");
if (data.format !== "vibe-launcher-theme") errors.push('format muss "vibe-launcher-theme" sein');
if (data.version !== 1) errors.push("version muss 1 sein");
if (typeof data.name !== "string" || !data.name.trim()) warnings.push("name fehlt");
else if (data.name.trim().length > 40) warnings.push("name ist länger als 40 Zeichen und wird gekürzt");

const v = data.values;
if (!isObj(v)) errors.push("values fehlt oder ist kein Objekt");
else {
  checkEnum("values.theme", v.theme, THEMES);
  checkHex("values.accent", v.accent);
  for (const [k, allowed] of Object.entries(ENUMS)) checkEnum(`values.${k}`, v[k], allowed);
  for (const [k, r] of Object.entries(RANGES)) checkNum(`values.${k}`, v[k], r);
  if (!isObj(v.status)) errors.push("values.status fehlt");
  else for (const k of ["ok", "warn", "danger"]) checkHex(`values.status.${k}`, v.status[k]);
  if (!isObj(v.background)) errors.push("values.background fehlt");
  else {
    const bg = v.background;
    if (bg.kind === "image") warnings.push("background.kind image wird beim Import zu none (Bilder sind nicht teilbar)");
    else checkEnum("values.background.kind", bg.kind, BG_ENUMS.kind);
    checkEnum("values.background.gradient", bg.gradient, BG_ENUMS.gradient);
    checkEnum("values.background.animated", bg.animated, BG_ENUMS.animated);
    for (const k of ["color", "gradient_from", "gradient_to"]) checkHex(`values.background.${k}`, bg[k]);
    for (const [k, r] of Object.entries(BG_RANGES)) checkNum(`values.background.${k}`, bg[k], r);
  }
  designHints(v);
}

for (const w of warnings) console.log(`Hinweis: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`Fehler: ${e}`);
  process.exit(1);
}
console.log("Theme ist gültig.\n");
console.log(`VIBE-THEME-1:${b64url(JSON.stringify(data))}`);
