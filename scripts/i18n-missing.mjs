#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const i18nDir = join(root, "src", "i18n");
const localesDir = join(i18nDir, "locales");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (flag("--help") || flag("-h")) {
  console.log(`Fehlende Übersetzungen auflisten / list missing translations

  node scripts/i18n-missing.mjs                 Übersicht aller Sprachen
  node scripts/i18n-missing.mjs --lang fr       Fehlende Schlüssel einer Sprache mit englischem Text
  node scripts/i18n-missing.mjs --lang fr --write
                                                Fehlende Schlüssel als "<bereich>.todo.json" ablegen
  node scripts/i18n-missing.mjs --check         Exit 1 bei kaputten Platzhaltern oder ungültigem JSON`);
  process.exit(0);
}

const SKIP = new Set(["index.ts", "languages.ts"]);
const sources = {};
for (const file of readdirSync(i18nDir).filter((f) => f.endsWith(".ts") && !SKIP.has(f)).sort()) {
  const mod = await import(pathToFileURL(join(i18nDir, file)).href);
  const bundle = mod.default;
  if (!bundle?.en || !bundle?.de) continue;
  sources[basename(file, ".ts")] = { en: bundle.en, de: bundle.de };
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

const langs = existsSync(localesDir)
  ? readdirSync(localesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  : [];
const only = option("--lang");
if (only && !langs.includes(only)) {
  console.error(`Unbekannte Sprache "${only}". Vorhanden: ${langs.join(", ")}`);
  process.exit(2);
}

let broken = 0;
const total = Object.values(sources).reduce((n, b) => n + Object.keys(b.en).length, 0);
const rows = [];

for (const lang of only ? [only] : langs) {
  const dir = join(localesDir, lang);
  const dict = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".todo.json"))) {
    try {
      Object.assign(dict, JSON.parse(readFileSync(join(dir, file), "utf8")));
    } catch (e) {
      broken++;
      console.error(`✗ ${lang}/${file}: ungültiges JSON – ${e.message}`);
    }
  }
  const known = new Set();
  let missing = 0;
  const perBundle = {};
  for (const [name, { en, de }] of Object.entries(sources)) {
    for (const [key, text] of Object.entries(en)) {
      known.add(key);
      if (dict[key] === undefined) {
        missing++;
        (perBundle[name] ??= {})[key] = { en: text, de: de[key] };
      } else if (placeholders(dict[key]) !== placeholders(text)) {
        broken++;
        console.error(`✗ ${lang}: Platzhalter in "${key}" passen nicht – erwartet {${placeholders(text)}}, gefunden {${placeholders(dict[key])}}`);
      }
    }
  }
  const obsolete = Object.keys(dict).filter((k) => !known.has(k));
  rows.push({ lang, done: total - missing, missing, obsolete: obsolete.length });

  if (only) {
    for (const [name, keys] of Object.entries(perBundle)) {
      console.log(`\n# ${name} (${Object.keys(keys).length}) → src/i18n/locales/${lang}/${name}.json`);
      for (const [key, { en }] of Object.entries(keys)) console.log(`  ${key}: ${JSON.stringify(en)}`);
      if (flag("--write")) {
        const todo = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, v.en]));
        writeFileSync(join(dir, `${name}.todo.json`), JSON.stringify(todo, null, 2) + "\n");
      }
    }
    if (obsolete.length) console.log(`\nVeraltete Schlüssel (gibt es nicht mehr, können weg): ${obsolete.join(", ")}`);
  }
}

console.log("");
console.table(rows.map((r) => ({ Sprache: r.lang, Übersetzt: `${r.done}/${total}`, "%": Math.floor((r.done / total) * 100), Fehlend: r.missing, Veraltet: r.obsolete })));
if (flag("--check") && broken) process.exit(1);
