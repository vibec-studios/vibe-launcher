#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { exportCode, exportFile, hasExtension, parseThemeInput } from "./gen/themes/document.mjs";
import { ThemeImportError, dataBytes } from "./gen/themes/report.mjs";
import { LIMITS } from "./gen/themes/rules.mjs";
import { ERRORS, MESSAGES, designHints, rawHints } from "./hints.mjs";

const HELP = `Aufruf: node validate.mjs <theme.vibetheme | -> [--code-only] [--clean <ausgabe.vibetheme>] [--strict]

  Prüft ein Vibe-Launcher-Theme mit denselben Regeln wie der Launcher und gibt den Teilen-Code aus
  (VIBE-THEME-1 für reine Werte-Themes, VIBE-THEME-2 für Palette, CSS und Deko-Plätze).
  --code-only   nur den Code ausgeben
  --clean       bereinigte Fassung speichern (so, wie der Launcher sie übernimmt)
  --strict      Exit 3, wenn beim Prüfen etwas entfernt oder angepasst wurde`;

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--clean");
if (!file || args.includes("--help")) {
  console.log(HELP);
  process.exit(file ? 0 : 2);
}
const codeOnly = args.includes("--code-only");
const cleanOut = args.includes("--clean") ? args[args.indexOf("--clean") + 1] : null;
const raw = readFileSync(file === "-" ? 0 : file, "utf8");
const log = (s) => !codeOnly && console.log(s);

let parsed;
try {
  parsed = parseThemeInput(raw, "Theme");
} catch (e) {
  const code = e instanceof ThemeImportError ? e.code : "format";
  console.error(`Fehler: ${ERRORS[code] ?? code}`);
  process.exit(1);
}

let data = null;
try {
  data = JSON.parse(raw);
} catch {
  data = null;
}
const { doc, version, warnings } = parsed;
for (const h of rawHints(data)) log(`Hinweis: ${h}`);
for (const w of warnings) log(`Angepasst: ${MESSAGES[w.code] ?? w.code}${w.detail ? ` – ${w.detail}` : ""}${w.count > 1 ? ` (${w.count}×)` : ""}`);
for (const h of designHints(doc)) log(`Design: ${h}`);

const fileText = exportFile(doc);
const code = exportCode(doc);
const fonts = [...doc.css.matchAll(/url\("(data:(?:font|application)\/[^"]+)"\)/g)].reduce((n, m) => n + dataBytes(m[1]), 0);
log(`\n„${doc.name}“ ist gültig (Format v${version}${hasExtension(doc) ? ", mit CSS/Deko" : ""}).`);
log(`Größe: ${(fileText.length / 1024).toFixed(1)} KB Datei, ${(code.length / 1024).toFixed(1)} KB Code, Schriften ${(fonts / 1024).toFixed(0)} KB.`);
if (version === 2) log("Braucht Vibe Launcher 1.0.0-beta.9 oder neuer. Für ältere Versionen ein Theme mit version 1 (ohne palette/css/slots) liefern.");
if (cleanOut) {
  writeFileSync(cleanOut, fileText);
  log(`Bereinigte Fassung gespeichert: ${cleanOut}`);
}
if (code.length > LIMITS.code) {
  log(`\nZu groß für einen Code (${code.length} Zeichen, max. ${LIMITS.code}). Teile die .vibetheme-Datei.`);
} else {
  log("");
  console.log(code);
}
process.exit(args.includes("--strict") && warnings.length ? 3 : 0);
