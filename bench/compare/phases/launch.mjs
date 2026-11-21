import path from "node:path";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline/promises";
import { backgroundLoad } from "../lib/env.mjs";
import { sleep, summarize } from "../lib/stats.mjs";
import { startLauncher, stopLauncher, rotate, foreignMinecraft } from "../lib/session.mjs";
import { run as runCmd } from "../lib/shell.mjs";

const mib = (b) => +(b / 2 ** 20).toFixed(1);

async function ask(question) {
  if (!process.stdin.isTTY) throw new Error("Für die Anmeldung wird ein interaktives Terminal gebraucht. Bitte den Befehl direkt in einem Terminal starten.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(question); } finally { rl.close(); }
}

async function prepare(ctx, a) {
  const c = ctx.forApp(a);
  const dataDir = path.join(ctx.l.data, a.id, "login");
  const { app, ready } = await startLauncher(c, a, dataDir, { cdp: true });
  try {
    let info = await a.prepareLaunch(c, app, ready);
    if (!info.loggedIn) {
      ctx.log("");
      ctx.log(`== Anmeldung in ${a.name} (Test-Kopie, eigener Datenordner) ==`);
      for (const line of a.loginHint) ctx.log(`  • ${line}`);
      ctx.log("  • Danach das Fenster offen lassen und hier Enter drücken.");
      await ask("Angemeldet? Enter drücken … ");
      info = await a.prepareLaunch(c, app);
      if (!info.loggedIn) throw new Error(`${a.name}: kein Konto gefunden – Anmeldung nicht abgeschlossen`);
    }
    ctx.log(`${a.name}: Konto vorhanden, Test-Instanzen vorbereiten …`);
    const ids = await a.ensureInstances(c, app);
    return { dataDir, ids };
  } finally {
    await stopLauncher(ctx, app);
  }
}

async function gameStats(ctx, app) {
  const s = await ctx.probe.stats([app.pid]);
  const java = [];
  for (const pid of s.pids) {
    const one = await ctx.probe.stats([pid]);
    if (one.count && Object.keys(one.names).some((n) => /^javaw?$/i.test(n)) && one.pids.length === 1) java.push(pid);
  }
  return { java, total: s };
}

async function launchOnce(ctx, a, app, id, { timeoutMs }) {
  for (let i = 0; (await foreignMinecraft(ctx.l.work)).length; i++) {
    if (i === 0) ctx.log("  ⚠ Ein anderes Minecraft läuft – warte, bis es beendet ist (höchstens ein Minecraft gleichzeitig).");
    await sleep(10000);
  }
  const bg = await backgroundLoad(ctx.probe, 2000);
  const prevLog = path.join(app.dataDir, "instances", id, "minecraft", "logs", "latest.log");
  if (prevLog && fs.existsSync(prevLog)) fs.renameSync(prevLog, prevLog.replace(/latest.log$/, `bench-${Date.now()}.log`));
  const h = await a.launch(ctx.forApp(a), app, id);
  const { t0, logFile } = h;
  let javaMs = null;
  let markerMs = null;
  let failed = null;
  const end = t0 + timeoutMs;
  for (let i = 0; performance.now() < end; i++) {
    if (javaMs === null && (await gameStats(ctx, app)).java.length) javaMs = performance.now() - t0;
    try {
      if (fs.statSync(logFile).mtimeMs >= Date.now() - (performance.now() - t0) - 1000 && fs.readFileSync(logFile, "utf8").includes(ctx.pins.logMarker)) { markerMs = performance.now() - t0; break; }
    } catch {}
    if (h.check && i % 10 === 0 && (failed = await h.check())) break;
    await sleep(100);
  }
  h.close?.();
  await sleep(3000);
  const g = await gameStats(ctx, app);
  const gameMem = g.java.length ? await ctx.probe.stats(g.java) : null;
  for (const pid of g.java) await runCmd("taskkill", ["/PID", String(pid), "/T", "/F"]).catch(() => {});
  await sleep(4000);
  return { markerMs, javaSpawnMs: javaMs, gameWorkingSetMiB: gameMem ? mib(gameMem.workingSet) : null, background: bg, error: failed ?? (markerMs === null ? `Kein Hauptmenü-Marker („${ctx.pins.logMarker}“) in ${timeoutMs / 1000} s` : null) };
}

export async function launch(ctx, launchers, { runs = 3, kinds = ["vanilla", "pack"], timeoutMs = 600000 } = {}) {
  const usable = launchers.filter((a) => a.automation.launch);
  const out = { phase: "launch", params: { runs, kinds, marker: ctx.pins.logMarker, memory: ctx.pins.memory, java: ctx.pins.java.name }, launchers: {} };
  const prep = {};
  for (const a of usable) {
    out.launchers[a.id] = { name: a.name, version: a.version, runs: [] };
    prep[a.id] = await prepare(ctx, a);
  }
  for (let run = 1; run <= runs; run++) {
    for (const a of rotate(usable, run - 1)) {
      for (const kind of kinds) {
        const id = prep[a.id].ids[kind];
        ctx.log(`Spielstart: ${a.name}, ${kind}, Lauf ${run}/${runs}`);
        const { app, ready } = await startLauncher(ctx.forApp(a), a, prep[a.id].dataDir, { cdp: a.id === "vibe" });
        const r = { run, kind, launcherReadyMs: ready.readyMs };
        try {
          await sleep(3000);
          r.cold = await launchOnce(ctx, a, app, id, { timeoutMs });
          r.warm = await launchOnce(ctx, a, app, id, { timeoutMs });
          r.firstEver = run === 1;
          ctx.log(`  kalt ${fmt(r.cold.markerMs)}, warm ${fmt(r.warm.markerMs)}`);
        } catch (e) {
          r.error = String(e.message ?? e);
          ctx.log(`  ✗ ${r.error}`);
        } finally {
          await stopLauncher(ctx, app);
        }
        out.launchers[a.id].runs.push(r);
      }
    }
  }
  for (const a of usable) {
    const rs = out.launchers[a.id].runs;
    const s = {};
    for (const kind of kinds) {
      const k = rs.filter((r) => r.kind === kind && !r.error);
      const later = k.filter((r) => !r.firstEver);
      s[kind] = {
        firstEverMs: k.find((r) => r.firstEver)?.cold?.markerMs ?? null,
        coldMs: summarize(later.map((r) => r.cold?.markerMs)),
        warmMs: summarize(k.map((r) => r.warm?.markerMs)),
        gameRamMiB: summarize(k.map((r) => r.warm?.gameWorkingSetMiB)),
      };
    }
    out.launchers[a.id].summary = s;
  }
  return out;
}

const fmt = (ms) => (ms == null ? "–" : `${(ms / 1000).toFixed(1)} s`);
