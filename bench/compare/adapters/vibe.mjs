import path from "node:path";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { download, extractZip, writeJson, findFiles } from "../lib/fsutil.mjs";
import { startApp } from "../lib/proc.mjs";
import { Cdp } from "../lib/cdp.mjs";
import { sleep, waitFor } from "../lib/stats.mjs";

const VERSION = "1.0.0-beta.7";
const ASSET = `Vibe-Launcher_${VERSION}_x64-portable.zip`;

let portSeq = 9370;

export const vibe = {
  id: "vibe",
  name: "Vibe Launcher",
  version: VERSION,
  source: `https://github.com/vibec-studios/vibe-launcher/releases/tag/v${VERSION}`,
  automation: { idle: true, install: true, launch: true },

  async prepare(ctx) {
    const url = await releaseAssetUrl();
    const dl = await download(url, path.join(ctx.l.downloads, "vibe"), ASSET);
    const dir = path.join(ctx.l.apps, "vibe");
    await extractZip(dl.file, dir);
    const exe = (await findFiles(dir, (p) => /vibe-launcher\.exe$/i.test(p), 3))[0];
    if (!exe) throw new Error("vibe-launcher.exe nicht im ZIP gefunden");
    return { download: dl, appDir: dir, exe: path.relative(dir, exe) };
  },

  async seed(ctx, dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    await writeJson(path.join(dataDir, "settings.json"), {
      language: "de",
      min_memory_mb: ctx.pins.memory.minMb,
      max_memory_mb: ctx.pins.memory.maxMb,
      java_overrides: { 21: ctx.javaw },
      auto_java: false,
      check_updates: false,
      launch_behavior: "keep",
      discord_rpc: false,
    });
  },

  start(ctx, dataDir, { cdp = false } = {}) {
    const port = cdp ? portSeq++ : null;
    const env = { VIBE_LAUNCHER_HOME: dataDir, WEBVIEW2_USER_DATA_FOLDER: path.join(dataDir, "wv2") };
    if (port) env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port}`;
    const app = startApp(path.join(ctx.app.appDir, ctx.app.exe), [], { env, cwd: ctx.app.appDir });
    app.port = port;
    app.dataDir = dataDir;
    return app;
  },

  domReady(app) {
    return async () => {
      const c = await Cdp.connect(app.port);
      try {
        await waitFor(() => c.eval("!!document.querySelector('nav.vl-rail, nav.vl2-rail') && document.readyState === 'complete'").catch(() => false), { timeout: 60000, interval: 50, label: "Vibe-Oberfläche" });
        return performance.now();
      } finally { c.close(); }
    };
  },

  async session(app) {
    const c = await Cdp.connect(app.port);
    await waitFor(() => c.eval("!!window.__TAURI_INTERNALS__").catch(() => false), { timeout: 60000, label: "Tauri-IPC" });
    return c;
  },

  async createVanilla(ctx, app) {
    const c = await this.session(app);
    try {
      const t0 = performance.now();
      const inst = await c.invoke("instance_create", { req: { name: "Bench Vanilla", mc_version: ctx.pins.mcVersion, loader: { kind: "vanilla", version: null }, icon: null, accent: null, group: null } });
      const created = performance.now() - t0;
      const task = await c.invoke("instance_install", { id: inst.id });
      await waitTask(c, task);
      return { createMs: created, installMs: performance.now() - t0 - created, totalMs: performance.now() - t0, instanceDir: path.join(app.dataDir, "instances", inst.id), id: inst.id };
    } finally { c.close(); }
  },

  async importPack(ctx, app, file) {
    const c = await this.session(app);
    try {
      const before = new Set((await c.invoke("instances_list")).map((i) => i.id));
      const t0 = performance.now();
      const task = await c.invoke("import_pack", { path: file, name: "Bench Pack" });
      await waitTask(c, task);
      const importMs = performance.now() - t0;
      const inst = (await c.invoke("instances_list")).find((i) => !before.has(i.id));
      if (!inst) throw new Error("importierte Instanz nicht gefunden");
      const t1 = performance.now();
      const task2 = await c.invoke("instance_install", { id: inst.id });
      await waitTask(c, task2);
      const installMs = performance.now() - t1;
      return { importMs, installMs, totalMs: importMs + installMs, instanceDir: path.join(app.dataDir, "instances", inst.id), id: inst.id };
    } finally { c.close(); }
  },

  async prepareLaunch(ctx, app) {
    const c = await this.session(app);
    try {
      const accounts = await c.invoke("accounts_list");
      const list = await c.invoke("instances_list");
      return { loggedIn: accounts.length > 0, instances: list.map((i) => ({ id: i.id, name: i.name })) };
    } finally { c.close(); }
  },

  async ensureInstances(ctx, app) {
    const c = await this.session(app);
    try {
      const list = await c.invoke("instances_list");
      const out = {};
      out.vanilla = list.find((i) => i.name === "Bench Vanilla")?.id;
      out.pack = list.find((i) => i.name === "Bench Pack")?.id;
      if (!out.vanilla) out.vanilla = (await c.invoke("instance_create", { req: { name: "Bench Vanilla", mc_version: ctx.pins.mcVersion, loader: { kind: "vanilla", version: null }, icon: null, accent: null, group: null } })).id;
      if (!out.pack) {
        const before = new Set(list.map((i) => i.id));
        await waitTask(c, await c.invoke("import_pack", { path: ctx.packFile, name: "Bench Pack" }));
        out.pack = (await c.invoke("instances_list")).find((i) => !before.has(i.id))?.id;
      }
      return out;
    } finally { c.close(); }
  },

  async launch(ctx, app, instanceId) {
    const c = await this.session(app);
    const t0 = performance.now();
    const task = await c.invoke("instance_launch", { id: instanceId, accountId: null, world: null, server: null, offline: null, afk: null });
    return {
      t0,
      logFile: path.join(app.dataDir, "instances", instanceId, "minecraft", "logs", "latest.log"),
      async check() {
        const t = (await c.invoke("tasks_list").catch(() => [])).find((x) => x.id === task);
        return t && (t.status === "failed" || t.status === "cancelled") ? `Vibe-Start fehlgeschlagen: ${t.error ?? t.status}` : null;
      },
      close: () => c.close(),
    };
  },

  loginHint: [
    "Im geöffneten Test-Vibe-Launcher links auf „Accounts“ (Konto-Symbol) gehen und „Mit Microsoft anmelden“ wählen.",
    "Die Anmeldung läuft im Login-Fenster des Launchers – das Skript liest keine Zugangsdaten.",
    "Der Test-Launcher speichert das Konto in einem eigenen Schlüsselbund-Eintrag (VibeLauncher-test-…), nicht im echten.",
  ],
};

async function waitTask(c, id) {
  for (;;) {
    const t = (await c.invoke("tasks_list")).find((x) => x.id === id);
    if (t && t.status !== "running") {
      if (t.status !== "done") throw new Error(`Aufgabe ${t.title}: ${t.status} ${t.error ?? ""}`);
      return t;
    }
    await sleep(100);
  }
}

async function releaseAssetUrl() {
  return `https://github.com/vibec-studios/vibe-launcher/releases/download/v${VERSION}/${ASSET}`;
}
