import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { download, extractZip } from "../lib/fsutil.mjs";
import { startApp } from "../lib/proc.mjs";
import { sleep, waitFor } from "../lib/stats.mjs";

const VERSION = "11.1.1";
const ASSET = `PrismLauncher-Windows-MSVC-Portable-${VERSION}.zip`;
const SHA256 = "ab35a770fb06d89d2ccc098079db5db329fb4e68f42b72babd8b095efde3d2d7";
const MAIN = /^Prism Launcher \d/;

export const prism = {
  id: "prism",
  name: "Prism Launcher",
  version: VERSION,
  source: `https://github.com/PrismLauncher/PrismLauncher/releases/tag/${VERSION}`,
  automation: { idle: true, install: true, launch: true },
  mainWindow: MAIN,

  async prepare(ctx) {
    const url = `https://github.com/PrismLauncher/PrismLauncher/releases/download/${VERSION}/${ASSET}`;
    const dl = await download(url, path.join(ctx.l.downloads, "prism"), ASSET, { sha256: SHA256 });
    const dir = path.join(ctx.l.apps, "prism");
    await extractZip(dl.file, dir);
    return { download: dl, appDir: dir, exe: "prismlauncher.exe" };
  },

  async seed(ctx, dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    const cfg = [
      "[General]",
      "ApplicationTheme=dark",
      "AutoUpdate=false",
      "AutomaticJavaDownload=false",
      "AutomaticJavaSwitch=false",
      "IconTheme=pe_colored",
      "IgnoreJavaWizard=true",
      `JavaPath=${ctx.javaw.replaceAll("\\", "/")}`,
      "Language=en_US",
      `LastHostname=${os.hostname()}`,
      `MaxMemAlloc=${ctx.pins.memory.maxMb}`,
      `MinMemAlloc=${ctx.pins.memory.minMb}`,
      "UserAskedAboutAutomaticJavaDownload=true",
      "",
    ].join("\r\n");
    const file = path.join(dataDir, "prismlauncher.cfg");
    if (!fs.existsSync(file)) fs.writeFileSync(file, cfg);
  },

  start(ctx, dataDir) {
    const app = startApp(path.join(ctx.app.appDir, ctx.app.exe), ["-d", dataDir], { cwd: ctx.app.appDir });
    app.dataDir = dataDir;
    return app;
  },

  async onWindow(ctx, app, wins) {
    const wiz = wins.find((w) => /Setup/i.test(w.title));
    if (!wiz) return null;
    const now = performance.now();
    if (app.lastWizardAt && now - app.lastWizardAt < 1000) return null;
    const r = await ctx.probe.uiaClick([app.pid], "Setup", "Finish");
    if (r.ok) app.lastWizardAt = performance.now();
    return { action: "Finish per UI-Automation", ok: !!r.ok, ms: performance.now() - now };
  },

  instances(app) {
    const dir = path.join(app.dataDir, "instances");
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith(".")).map((d) => d.name);
    } catch { return []; }
  },

  async importFile(ctx, app, file, done) {
    const probe = ctx.probe;
    const before = new Set(this.instances(app));
    spawn(path.join(ctx.app.appDir, ctx.app.exe), ["-d", app.dataDir, "-I", file], { stdio: "ignore", windowsHide: true });
    await waitFor(async () => (await probe.windows([app.pid])).some((w) => /New Instance/.test(w.title)), { timeout: 30000, interval: 50, label: "Prism-Importdialog" });
    await sleep(500);
    const t0 = performance.now();
    const r = await waitFor(async () => { const x = await probe.uiaClick([app.pid], "New Instance", "OK"); return x.ok ? x : null; }, { timeout: 15000, interval: 100, label: "OK-Knopf" });
    let id = null;
    await waitFor(async () => {
      id = this.instances(app).find((n) => !before.has(n)) ?? null;
      if (!id) return false;
      const wins = await probe.windows([app.pid]);
      return wins.length === 1 && done(path.join(app.dataDir, "instances", id));
    }, { timeout: 30 * 60000, interval: 100, label: "Prism-Import" });
    return { ms: performance.now() - t0, id, instanceDir: path.join(app.dataDir, "instances", id), clicked: r.window };
  },

  async createVanilla(ctx, app) {
    const r = await this.importFile(ctx, app, ctx.vanillaPackFile, (d) => fs.existsSync(path.join(d, "mmc-pack.json")) && fs.existsSync(path.join(d, "instance.cfg")));
    return { createMs: null, installMs: null, totalMs: r.ms, instanceDir: r.instanceDir, id: r.id, note: `Prism lädt beim Import auch die Spieldateien (ein Schritt). Parallele Downloads: ${ctx.args?.["prism-downloads"] ?? "6 (Standard)"}, Vibe: 16 (Standard).` };
  },

  async importPack(ctx, app, file) {
    const want = ctx.packIndex.mods;
    const r = await this.importFile(ctx, app, file, (d) => {
      const mods = path.join(d, "minecraft", "mods");
      try { return fs.readdirSync(mods).filter((f) => !f.endsWith(".part") && !f.endsWith(".tmp")).length >= want; } catch { return false; }
    });
    return { importMs: null, installMs: null, totalMs: r.ms, instanceDir: r.instanceDir, id: r.id };
  },

  async prepareLaunch(ctx, app, ready) {
    let size = 0;
    try { size = fs.statSync(path.join(app.dataDir, "accounts.json")).size; } catch {}
    const loggedIn = size > 300 && !(ready?.interventions?.length);
    return { loggedIn, instances: this.instances(app).map((id) => ({ id, name: id })) };
  },

  async ensureInstances(ctx, app) {
    const out = {};
    const has = (re) => this.instances(app).find((n) => re.test(n));
    out.vanilla = has(/Bench Vanilla/) ?? (await this.createVanilla(ctx, app)).id;
    out.pack = has(/Fabulously/) ?? (await this.importPack(ctx, app, ctx.packFile)).id;
    return out;
  },

  async launch(ctx, app, instanceId) {
    const t0 = performance.now();
    spawn(path.join(ctx.app.appDir, ctx.app.exe), ["-d", app.dataDir, "-l", instanceId], { stdio: "ignore", windowsHide: true });
    return { t0, logFile: path.join(app.dataDir, "instances", instanceId, "minecraft", "logs", "latest.log") };
  },

  loginHint: [
    "Im geöffneten Test-Prism oben rechts auf „Accounts“ → „Manage Accounts…“ → „Add Microsoft“ klicken.",
    "Die Anmeldung erfolgt im Browser/Gerätecode-Dialog von Prism – das Skript liest keine Zugangsdaten.",
    "Das Konto landet nur im Test-Datenordner (accounts.json dort), nicht in einer echten Prism-Installation.",
  ],
};
