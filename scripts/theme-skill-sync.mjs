#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src", "lib");
const OUT = path.join(ROOT, "skills", "vibe-launcher-theme", "gen");
const ENTRIES = ["themes/document.ts", "themes/compile.ts", "themes/placeholders.ts"];
const IMPORT = /(from\s+|import\s+)(["'])(\.{1,2}\/[^"']+)\.ts\2/g;

const HELP = `Theme-Kern für den KI-Skill erzeugen (src/lib/themes → skills/vibe-launcher-theme/gen)

  node scripts/theme-skill-sync.mjs           schreibt die .mjs-Dateien
  node scripts/theme-skill-sync.mjs --check   Exit 1, wenn die Dateien nicht zum Quellstand passen`;

function closure() {
  const seen = new Set();
  const todo = [...ENTRIES];
  while (todo.length) {
    const rel = todo.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const text = fs.readFileSync(path.join(SRC, rel), "utf8");
    for (const m of text.matchAll(IMPORT)) {
      if (/^\s*import\s+type\b/.test(text.slice(text.lastIndexOf("\n", m.index) + 1, m.index + m[0].length))) continue;
      todo.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), `${m[3]}.ts`)));
    }
  }
  return [...seen].sort();
}

function tidy(js) {
  const lines = js.split("\n").map((l) => l.replace(/\s+$/, ""));
  const out = [];
  for (const l of lines) if (l || out[out.length - 1]) out.push(l);
  while (out.length && !out[out.length - 1]) out.pop();
  return `${out.join("\n")}\n`;
}

function generate() {
  const files = new Map();
  for (const rel of closure()) {
    const ts = fs.readFileSync(path.join(SRC, rel), "utf8");
    const js = stripTypeScriptTypes(ts, { mode: "transform" }).replace(IMPORT, (_m, kw, q, spec) => `${kw}${q}${spec}.mjs${q}`);
    files.set(rel.replace(/\.ts$/, ".mjs"), tidy(js));
  }
  return files;
}

function existing(dir = OUT, base = "") {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? existing(path.join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`]));
}

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(HELP);
  process.exit(0);
}
process.removeAllListeners("warning");
const files = generate();
if (args.includes("--check")) {
  const same = (a, b) => a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
  const stale = [...files].filter(([rel, js]) => !fs.existsSync(path.join(OUT, rel)) || !same(fs.readFileSync(path.join(OUT, rel), "utf8"), js)).map(([rel]) => rel);
  const extra = existing().filter((rel) => !files.has(rel));
  if (stale.length || extra.length) {
    console.error(`Skill-Kern veraltet: ${[...stale, ...extra].join(", ")}\nAusführen: node scripts/theme-skill-sync.mjs`);
    process.exit(1);
  }
  console.log(`Skill-Kern aktuell (${files.size} Dateien).`);
} else {
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const [rel, js] of files) {
    fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
    fs.writeFileSync(path.join(OUT, rel), js);
  }
  console.log(`${files.size} Dateien nach ${path.relative(ROOT, OUT)} geschrieben.`);
}
