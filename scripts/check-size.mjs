#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "scripts", "size-baseline.json");
const LIMIT = 300;
const EXTENSIONS = new Set([".ts", ".tsx", ".rs", ".mjs", ".cjs", ".js", ".css"]);
const EXEMPT = [
  { why: "Übersetzungs-Bundle", re: /(^|\/)i18n\/(?!index\.ts$|languages\.ts$)[^/]+\.ts$/ },
  { why: "Übersetzungen", re: /(^|\/)locales\// },
  { why: "Test", re: /(^|\/)tests?(\/|\.rs$)|_tests?\.rs$|\.(test|spec)\.[cm]?[jt]sx?$/ },
  { why: "Testdaten", re: /(^|\/)(testdata|fixtures)\// },
  { why: "Mock-Backend (nur Entwicklung)", re: /^src\/dev\/mock\// },
  { why: "generiert", re: /(^|\/)(gen|dist|panel-dist|target|node_modules)\/|\.d\.ts$|\.min\.js$|\.generated\./ },
];

const HELP = `Dateigrößen-Check (Richtwert ${LIMIT} Zeilen je Code-Datei)

  node scripts/check-size.mjs                    Liste aller Code-Dateien über ${LIMIT} Zeilen
  node scripts/check-size.mjs --baseline         Stand nach scripts/size-baseline.json schreiben
  node scripts/check-size.mjs --check            Fehler bei neuen Dateien über ${LIMIT} Zeilen
                                                 oder Dateien, die über ihren Baseline-Wert wachsen
  node scripts/check-size.mjs --check --warn-only
                                                 wie --check, aber nur Warnungen (Exit 0)

Ausnahmen: ${EXEMPT.map((e) => e.why).join(", ")}.`;

function listFiles() {
  try {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return out.split("\0").filter(Boolean);
  } catch {
    const out = [];
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "target") walk(r);
        else if (e.isFile()) out.push(r);
      }
    };
    walk("");
    return out;
  }
}

function countLines(file) {
  const text = fs.readFileSync(file, "utf8");
  if (!text) return 0;
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

export function exemption(rel) {
  return EXEMPT.find((e) => e.re.test(rel))?.why ?? null;
}

function measure() {
  const sizes = {};
  for (const rel of listFiles()) {
    const posix = rel.split(path.sep).join("/");
    if (!EXTENSIONS.has(path.extname(posix)) || exemption(posix)) continue;
    const abs = path.join(ROOT, posix);
    if (!fs.existsSync(abs)) continue;
    const n = countLines(abs);
    if (n > LIMIT) sizes[posix] = n;
  }
  return Object.fromEntries(Object.entries(sizes).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)));
}

function readBaseline() {
  if (!fs.existsSync(BASELINE)) return {};
  return JSON.parse(fs.readFileSync(BASELINE, "utf8")).files ?? {};
}

function writeBaseline(sizes) {
  const files = Object.fromEntries(Object.keys(sizes).sort().map((k) => [k, sizes[k]]));
  fs.writeFileSync(BASELINE, JSON.stringify({ limit: LIMIT, files }, null, 2) + "\n");
  console.log(`${Object.keys(files).length} Dateien über ${LIMIT} Zeilen nach ${path.relative(ROOT, BASELINE)} geschrieben.`);
}

function annotate(level, file, message) {
  if (process.env.GITHUB_ACTIONS) console.log(`::${level} file=${file},line=1,title=Dateigröße::${message}`);
  else console.log(`${level === "error" ? "FEHLER" : "WARNUNG"}: ${file}: ${message}`);
}

function check(sizes, warnOnly) {
  const baseline = readBaseline();
  const problems = [];
  for (const [file, n] of Object.entries(sizes)) {
    const before = baseline[file];
    if (before === undefined) problems.push([file, `neue Datei mit ${n} Zeilen (Richtwert ${LIMIT}) – bitte aufteilen`]);
    else if (n > before) problems.push([file, `von ${before} auf ${n} Zeilen gewachsen (Richtwert ${LIMIT}) – bitte aufteilen statt erweitern`]);
  }
  for (const [file, msg] of problems) annotate(warnOnly ? "warning" : "error", file, msg);
  const shrunk = Object.entries(baseline).filter(([file, n]) => (sizes[file] ?? 0) < n);
  if (shrunk.length) console.log(`${shrunk.length} Dateien sind kleiner als in der Baseline – mit \`node scripts/check-size.mjs --baseline\` nachziehen.`);
  console.log(`${Object.keys(sizes).length} Dateien über ${LIMIT} Zeilen, ${problems.length} neu oder gewachsen.`);
  return problems.length === 0 || warnOnly;
}

function list(sizes) {
  const baseline = readBaseline();
  for (const [file, n] of Object.entries(sizes)) {
    const before = baseline[file];
    const mark = before === undefined ? "  (neu)" : n > before ? `  (+${n - before})` : "";
    console.log(`${String(n).padStart(6)} ${file}${mark}`);
  }
  console.log(`${Object.keys(sizes).length} Code-Dateien über ${LIMIT} Zeilen.`);
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) return console.log(HELP);
  const sizes = measure();
  if (args.has("--baseline")) return writeBaseline(sizes);
  if (args.has("--check")) {
    if (!check(sizes, args.has("--warn-only"))) process.exitCode = 1;
    return;
  }
  list(sizes);
}

main();
