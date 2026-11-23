import fs from "node:fs";
import path from "node:path";
import { loadChromium } from "./playwright.mjs";
import { serveStatic } from "./server.mjs";
import { buildMock } from "./build.mjs";
import { EXTRA_VARIANTS, VARIANTS, scenes } from "./scenes.mjs";
import { Driver, TOTAL_FAKE_MS } from "./driver.mjs";
import { BASE_FLAGS, FIXED_TIME, FREEZE_CSS, initScript } from "./determinism.mjs";

const VIEWPORT = { width: 1280, height: 720 };

function parseArgs(argv) {
  const opts = { out: null, dist: null, only: null, variants: Object.keys(VARIANTS), jobs: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dist") opts.dist = argv[++i];
    else if (a === "--only") opts.only = new RegExp(argv[++i]);
    else if (a === "--variants") opts.variants = argv[++i].split(",");
    else if (a === "--jobs") opts.jobs = Math.max(1, Number(argv[++i]) || 1);
    else if (!opts.out) opts.out = a;
    else throw new Error(`unbekanntes Argument: ${a}`);
  }
  if (!opts.out) throw new Error("Aufruf: node scripts/visual/capture.mjs <ausgabeordner> [--dist <ordner>] [--only <regex>] [--variants v1-dark,v2-light,pixel] [--jobs 3]");
  for (const v of opts.variants) if (!VARIANTS[v] && !EXTRA_VARIANTS[v]) throw new Error(`unbekannte Variante: ${v}`);
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function stableShot(page) {
  let prev = null;
  for (let i = 0; i < 24; i++) {
    const shot = await page.screenshot({ animations: "disabled", caret: "hide" });
    if (prev && shot.equals(prev)) return { shot, stable: true };
    prev = shot;
    await sleep(250);
  }
  return { shot: prev, stable: false };
}

async function captureOne(browser, baseUrl, variant, scene) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const origin = new URL(baseUrl).origin;
  await ctx.route((url) => /^(https?|wss?):$/.test(url.protocol) && url.origin !== origin, (route) => route.abort());
  await ctx.clock.install({ time: new Date(FIXED_TIME).getTime() - 1000 });
  await ctx.clock.pauseAt(FIXED_TIME);
  await ctx.addInitScript(initScript, { flags: { ...BASE_FLAGS, ...(VARIANTS[variant] ?? EXTRA_VARIANTS[variant]), ...(scene.flags ?? {}) }, css: FREEZE_CSS });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e?.message ?? e)));
  const ui = new Driver(page);
  let error = null;
  try {
    await page.goto(`${baseUrl}/${scene.file ?? ""}${scene.path ?? ""}`, { waitUntil: "load" });
    await ui.ready(page.locator("#root > *").first());
    await ui.settle();
    if (scene.act) {
      await scene.act(ui);
      await ui.settle();
    }
    if (!(await ui.finish())) error = `Szene braucht mehr als ${TOTAL_FAKE_MS} ms Uhrzeit`;
  } catch (e) {
    error = String(e?.message ?? e).split("\n")[0];
  }
  const { shot, stable } = await stableShot(page);
  await ctx.close();
  return { shot, stable, error, pageErrors: errors };
}

async function pool(items, size, fn) {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const out = path.resolve(opts.out);
  const dist = opts.dist ? path.resolve(opts.dist) : buildMock();
  const server = await serveStatic(dist);
  const browser = await loadChromium();
  const all = scenes().filter((s) => !opts.only || opts.only.test(s.name));
  const jobs = opts.variants.flatMap((variant) => all.map((scene) => ({ variant, scene })));
  const manifest = { fixedTime: FIXED_TIME, viewport: VIEWPORT, shots: [] };
  const started = Date.now();
  try {
    await pool(jobs, opts.jobs, async ({ variant, scene }, i) => {
      const file = `${variant}/${scene.name}.png`;
      let res = await captureOne(browser, server.url, variant, scene);
      for (let attempt = 1; attempt < 3 && (res.error || !res.stable); attempt++) {
        console.log(`[visual] ${file}: neuer Versuch (${res.error ?? "nicht stabil"})`);
        res = await captureOne(browser, server.url, variant, scene);
      }
      fs.mkdirSync(path.join(out, variant), { recursive: true });
      fs.writeFileSync(path.join(out, file), res.shot);
      manifest.shots.push({ variant, scene: scene.name, file, stable: res.stable, error: res.error, pageErrors: res.pageErrors });
      const flag = res.error ? ` FEHLER: ${res.error}` : res.stable ? "" : " (nicht stabil)";
      console.log(`[visual] ${i + 1}/${jobs.length} ${file}${flag}`);
    });
  } finally {
    await browser.close();
    await server.close();
    if (!opts.dist) fs.rmSync(dist, { recursive: true, force: true });
  }
  manifest.shots.sort((a, b) => a.file.localeCompare(b.file));
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
  const bad = manifest.shots.filter((s) => s.error || !s.stable);
  console.log(`[visual] ${manifest.shots.length} Aufnahmen in ${out} (${Math.round((Date.now() - started) / 1000)} s), ${bad.length} mit Fehler/instabil`);
  if (bad.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
