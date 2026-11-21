import path from "node:path";
import { performance } from "node:perf_hooks";
import { rmrf } from "../lib/fsutil.mjs";
import { backgroundLoad } from "../lib/env.mjs";
import { sleep, summarize } from "../lib/stats.mjs";
import { startLauncher, stopLauncher, rotate } from "../lib/session.mjs";

const mib = (b) => +(b / 2 ** 20).toFixed(1);

async function sampleAt(ctx, app, atMs) {
  const wait = app.t0 + atMs - performance.now();
  if (wait > 0) await sleep(wait);
  const s = await ctx.probe.stats([app.pid]);
  return { t: performance.now() - app.t0, cpuMs: s.cpuMs, ws: s.workingSet, priv: s.private, procs: s.count, names: s.names };
}

const cpuPct = (a, b) => (b && a ? +(((b.cpuMs - a.cpuMs) / (b.t - a.t)) * 100).toFixed(2) : null);

async function oneRun(ctx, a, run, opts) {
  const dataDir = path.join(ctx.l.data, a.id, "idle");
  if (run === 1) await rmrf(dataDir);
  const bg = await backgroundLoad(ctx.probe, 2000);
  for (const w of bg.warnings) ctx.log(`  ⚠ ${w}`);
  const { app, ready } = await startLauncher(ctx.forApp(a), a, dataDir);
  const r = { run, firstStart: run === 1, background: bg, ...ready };
  try {
    if (ready.windowMs === null) throw new Error(ready.error);
    const s10 = await sampleAt(ctx, app, 10000);
    const s30 = await sampleAt(ctx, app, opts.shortMs);
    r.mem30 = { workingSetMiB: mib(s30.ws), privateMiB: mib(s30.priv), processes: s30.procs, names: s30.names };
    r.cpu10to30 = cpuPct(s10, s30);
    if (run <= opts.longRuns + 1 && run > 1) {
      const sL = await sampleAt(ctx, app, opts.longMs);
      r.memLong = { workingSetMiB: mib(sL.ws), privateMiB: mib(sL.priv), processes: sL.procs };
      r.cpuLong = cpuPct(s30, sL);
    }
  } catch (e) {
    r.error = String(e.message ?? e);
  } finally {
    await stopLauncher(ctx, app);
  }
  ctx.log(`  ${a.name} #${run}: Fenster ${fmt(r.windowMs)}, bedienbar ${fmt(r.readyMs)}, RAM30 ${r.mem30?.workingSetMiB ?? "–"} MiB${r.memLong ? `, RAM${opts.longMs / 1000}s ${r.memLong.workingSetMiB} MiB, CPU ${r.cpuLong} %` : ""}`);
  return r;
}

const fmt = (ms) => (ms == null ? "–" : `${(ms / 1000).toFixed(2)} s`);

export async function idle(ctx, launchers, { runs = 5, longRuns = 2, shortMs = 30000, longMs = 300000 } = {}) {
  const out = { phase: "idle", params: { runs, longRuns, shortMs, longMs }, launchers: {} };
  for (const a of launchers) out.launchers[a.id] = { name: a.name, version: a.version, runs: [] };
  for (let run = 1; run <= runs; run++) {
    for (const a of rotate(launchers, run - 1)) {
      ctx.log(`Leerlauf/Start: ${a.name}, Lauf ${run}/${runs}`);
      out.launchers[a.id].runs.push(await oneRun(ctx, a, run, { longRuns, shortMs, longMs }));
      await sleep(3000);
    }
  }
  for (const a of launchers) {
    const rs = out.launchers[a.id].runs;
    const warm = rs.filter((r) => !r.firstStart && !r.error);
    out.launchers[a.id].summary = {
      firstStartWindowMs: rs.find((r) => r.firstStart)?.windowMs ?? null,
      firstStartReadyMs: rs.find((r) => r.firstStart)?.readyMs ?? null,
      windowMs: summarize(warm.map((r) => r.windowMs)),
      readyMs: summarize(warm.map((r) => r.readyMs)),
      ram30MiB: summarize(warm.map((r) => r.mem30?.workingSetMiB)),
      private30MiB: summarize(warm.map((r) => r.mem30?.privateMiB)),
      ramLongMiB: summarize(warm.map((r) => r.memLong?.workingSetMiB)),
      privateLongMiB: summarize(warm.map((r) => r.memLong?.privateMiB)),
      cpu10to30Pct: summarize(warm.map((r) => r.cpu10to30)),
      cpuLongPct: summarize(warm.map((r) => r.cpuLong)),
    };
  }
  return out;
}
