import type { ThemeValues } from "../types";
import type { Palette } from "./palette.ts";
import { checkContrast, validatePalette } from "./palette.ts";
import type { ThemeWarning } from "./report.ts";
import { Report, ThemeImportError } from "./report.ts";
import type { SlotName } from "./rules.ts";
import { CODE_PREFIX_V1, CODE_PREFIX_V2, FILE_FORMAT, LIMITS, MAX_AUTHOR, MAX_DESCRIPTION, MAX_NAME, SLOTS } from "./rules.ts";
import { sanitizeCss } from "./css/sanitize.ts";
import { sanitizeMarkup, serializeMarkup } from "./markup/sanitize.ts";
import { obj, portableValues, validateValues } from "./values.ts";

export interface ThemeDoc {
  name: string;
  author?: string;
  description?: string;
  values: ThemeValues;
  palette: Palette;
  css: string;
  slots: Partial<Record<SlotName, string>>;
}

export interface ParsedTheme {
  doc: ThemeDoc;
  version: 1 | 2;
  warnings: ThemeWarning[];
}

export function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function cleanName(name: string, fallback: string): string {
  return name.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, MAX_NAME) || fallback;
}

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64decode(code: string): string {
  const norm = code.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "===".slice((norm.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function hasExtension(doc: Pick<ThemeDoc, "css" | "slots">): boolean {
  return !!doc.css || Object.keys(doc.slots).length > 0;
}

export function isV2(doc: ThemeDoc): boolean {
  return hasExtension(doc) || Object.keys(doc.palette).length > 0 || !!doc.author || !!doc.description;
}

function slotsOf(raw: unknown, report: Report): Partial<Record<SlotName, string>> {
  const src = obj(raw);
  const out: Partial<Record<SlotName, string>> = {};
  const budget = { total: 0 };
  for (const [name, value] of Object.entries(src)) {
    if (!(SLOTS as readonly string[]).includes(name)) {
      report.warn("slot.unknown", name.slice(0, 24));
      continue;
    }
    if (typeof value !== "string") throw new ThemeImportError("values");
    if (value.length > LIMITS.slotChars) throw new ThemeImportError("too_long");
    const markup = serializeMarkup(sanitizeMarkup(value, report, budget)).trim();
    if (markup) out[name as SlotName] = markup;
  }
  return out;
}

function decode(text: string): string {
  const up = text.slice(0, 16).toUpperCase();
  const m = /^VIBE-THEME-(\d+):/.exec(up);
  if (m) {
    if (Number(m[1]) > 2) throw new ThemeImportError("version");
    try {
      return b64decode(text.slice(m[0].length).replace(/\s+/g, ""));
    } catch {
      throw new ThemeImportError("format");
    }
  }
  if (text.startsWith("{")) return text;
  throw new ThemeImportError("format");
}

export function parseThemeInput(input: string, fallbackName: string): ParsedTheme {
  const text = input.replace(/^﻿/, "").trim();
  if (!text) throw new ThemeImportError("empty");
  if (text.length > LIMITS.input) throw new ThemeImportError("too_long");
  const json = decode(text);
  if (json.length > LIMITS.document + 4096) throw new ThemeImportError("too_long");
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new ThemeImportError("format");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ThemeImportError("format");
  const f = data as Record<string, unknown>;
  if (f.format !== FILE_FORMAT) throw new ThemeImportError("format");
  if (f.version !== 1 && f.version !== 2) throw new ThemeImportError(typeof f.version === "number" && f.version > 2 ? "version" : "format");
  const report = new Report();
  const values = validateValues(f.values);
  const doc: ThemeDoc = { name: cleanName(typeof f.name === "string" ? f.name : "", fallbackName), values, palette: {}, css: "", slots: {} };
  if (f.version === 1) {
    for (const k of ["palette", "css", "slots"]) if (f[k] !== undefined) report.warn("field.ignored", k);
    return { doc, version: 1, warnings: report.list() };
  }
  const author = cleanText(f.author, MAX_AUTHOR);
  const description = cleanText(f.description, MAX_DESCRIPTION);
  if (author) doc.author = author;
  if (description) doc.description = description;
  doc.palette = checkContrast(validatePalette(f.palette, report), values, report);
  if (f.css !== undefined) {
    if (typeof f.css !== "string") throw new ThemeImportError("values");
    if (f.css.length > LIMITS.css) throw new ThemeImportError("too_long");
    doc.css = sanitizeCss(f.css, "clean", report);
  }
  doc.slots = slotsOf(f.slots, report);
  return { doc, version: 2, warnings: report.list() };
}

export function documentJson(doc: ThemeDoc): Record<string, unknown> {
  const v2 = isV2(doc);
  const out: Record<string, unknown> = { format: FILE_FORMAT, version: v2 ? 2 : 1, name: doc.name };
  if (doc.author) out.author = doc.author;
  if (doc.description) out.description = doc.description;
  out.values = portableValues(doc.values);
  if (Object.keys(doc.palette).length) out.palette = doc.palette;
  if (doc.css) out.css = doc.css;
  if (Object.keys(doc.slots).length) out.slots = Object.fromEntries(SLOTS.filter((s) => doc.slots[s]).map((s) => [s, doc.slots[s]]));
  return out;
}

export function exportCode(doc: ThemeDoc): string {
  return (isV2(doc) ? CODE_PREFIX_V2 : CODE_PREFIX_V1) + b64encode(JSON.stringify(documentJson(doc)));
}

export function exportFile(doc: ThemeDoc): string {
  return `${JSON.stringify(documentJson(doc), null, 2)}\n`;
}

export function revision(doc: Pick<ThemeDoc, "css" | "slots" | "author" | "description">): string {
  const text = JSON.stringify([doc.css, SLOTS.map((s) => doc.slots[s] ?? ""), doc.author ?? "", doc.description ?? ""]);
  let h = 0x811c9dc5;
  let g = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    g = Math.imul(g + text.charCodeAt(i), 0x9e3779b1) >>> 0;
  }
  return h.toString(36) + g.toString(36);
}
