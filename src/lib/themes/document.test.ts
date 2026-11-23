import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { exportCode, exportFile, parseThemeInput, revision } from "./document.ts";
import { compileTheme } from "./compile.ts";
import { ThemeImportError } from "./report.ts";
import { greetingPeriod, friendsOnline, lastPlayedName } from "./placeholders.ts";
import { LIMITS } from "./rules.ts";

const EXAMPLES = new URL("../../../skills/vibe-launcher-theme/examples/", import.meta.url);
const read = (name: string) => fs.readFileSync(new URL(name, EXAMPLES), "utf8");
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof ThemeImportError ? e.code : "other";
  }
  return "none";
}

test("v1 files and codes still import unchanged", () => {
  const raw = read("Creeper.vibetheme");
  const file = parseThemeInput(raw, "x");
  assert.equal(file.version, 1);
  assert.deepEqual(file.warnings, []);
  const legacy = parseThemeInput(`VIBE-THEME-1:${b64(JSON.stringify(JSON.parse(raw)))}`, "x");
  assert.deepEqual(legacy.doc, file.doc);
  assert.match(exportCode(file.doc), /^VIBE-THEME-1:/);
  assert.equal(JSON.parse(exportFile(file.doc)).version, 1);
  const lower = parseThemeInput(`vibe-theme-1:${b64(raw)}`, "x");
  assert.equal(lower.doc.name, "Creeper");
});

test("v1 keeps strict value checks and ignores v2-only fields", () => {
  const base = { format: "vibe-launcher-theme", version: 1, name: "A", values: { accent: "#123456" } };
  assert.equal(code(() => parseThemeInput(JSON.stringify({ ...base, values: { tone: "neon" } }), "x")), "values");
  const r = parseThemeInput(JSON.stringify({ ...base, css: "a{color:red}" }), "x");
  assert.equal(r.doc.css, "");
  assert.deepEqual(r.warnings.map((w) => w.code), ["field.ignored"]);
});

test("v2 examples round-trip through code and file", () => {
  for (const name of ["Iron Man.vibetheme", "Stiller See.vibetheme"]) {
    const a = parseThemeInput(read(name), "x");
    assert.equal(a.version, 2);
    assert.deepEqual(a.warnings, [], name);
    const c = exportCode(a.doc);
    assert.match(c, /^VIBE-THEME-2:/);
    assert.ok(c.length < LIMITS.code);
    assert.deepEqual(parseThemeInput(c, "x").doc, a.doc);
    assert.deepEqual(parseThemeInput(exportFile(a.doc), "x").doc, a.doc);
    assert.equal(revision(parseThemeInput(c, "x").doc), revision(a.doc));
    const compiled = compileTheme(a.doc, "scoped");
    assert.ok(compiled.css.length > 0 && compiled.slots["home-hero"]);
    assert.ok(compiled.placeholders.includes("greeting") && compiled.placeholders.includes("player"));
  }
});

test("errors: empty, format, version, size", () => {
  assert.equal(code(() => parseThemeInput("   ", "x")), "empty");
  assert.equal(code(() => parseThemeInput("hello", "x")), "format");
  assert.equal(code(() => parseThemeInput("VIBE-THEME-2:!!!", "x")), "format");
  assert.equal(code(() => parseThemeInput("VIBE-THEME-3:abc", "x")), "version");
  assert.equal(code(() => parseThemeInput('{"format":"vibe-launcher-theme","version":7,"values":{}}', "x")), "version");
  assert.equal(code(() => parseThemeInput("x".repeat(LIMITS.input + 1), "x")), "too_long");
  const bigCss = JSON.stringify({ format: "vibe-launcher-theme", version: 2, name: "B", values: {}, css: "a{}".repeat(LIMITS.css) });
  assert.equal(code(() => parseThemeInput(bigCss, "x")), "too_long");
  assert.equal(code(() => parseThemeInput('{"format":"vibe-launcher-theme","version":2,"values":{},"css":42}', "x")), "values");
});

test("palette: unknown keys dropped, unreadable text falls back to the base theme", () => {
  const doc = {
    format: "vibe-launcher-theme",
    version: 2,
    name: "P",
    values: { theme: "standard", tone: "dark", accent: "#ffcc00" },
    palette: { canvas: "#101010", surface: "#141414", text: "#151515", muted: "#9a9a9a", on_accent: "#fefefe", glow: "#fff", border: "red" },
  };
  const r = parseThemeInput(JSON.stringify(doc), "x");
  assert.deepEqual(Object.keys(r.doc.palette).sort(), ["canvas", "muted", "surface"]);
  const codes = r.warnings.map((w) => `${w.code}:${w.detail ?? ""}`);
  assert.ok(codes.includes("palette.key:glow"));
  assert.ok(codes.includes("palette.value:border"));
  assert.ok(codes.includes("contrast.dropped:text"));
  assert.ok(codes.includes("contrast.dropped:on_accent"));
  const light = parseThemeInput(JSON.stringify({ ...doc, palette: { canvas: "#ffffff", surface: "#fafafa" } }), "x");
  assert.deepEqual(light.doc.palette, {});
});

test("names are cleaned and bidi overrides removed", () => {
  const r = parseThemeInput(JSON.stringify({ format: "vibe-launcher-theme", version: 2, name: "Iron‮Man\u0007 that is a very long name for a theme", author: "A\u0000B", values: {} }), "x");
  assert.equal(r.doc.name, "IronMan that is a very long name for a t");
  assert.equal(r.doc.author, "A B");
});

test("placeholder helpers", () => {
  assert.equal(greetingPeriod(new Date(2026, 0, 1, 6)), "morning");
  assert.equal(greetingPeriod(new Date(2026, 0, 1, 12)), "day");
  assert.equal(greetingPeriod(new Date(2026, 0, 1, 23)), "evening");
  assert.equal(greetingPeriod(new Date(2026, 0, 1, 3)), "evening");
  assert.equal(friendsOnline([{ presence: { status: "online" } }, { presence: { status: "offline" } }, { presence: null }, { presence: { status: "busy" } }]), 2);
  assert.equal(lastPlayedName([{ name: "a", last_played: 5 }, { name: "b", last_played: 9 }, { name: "c", last_played: null }]), "b");
  assert.equal(lastPlayedName([{ name: "c", last_played: null }]), null);
});
