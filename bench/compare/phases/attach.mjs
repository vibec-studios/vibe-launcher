import path from "node:path";
import { startApp, measureReady, killTree } from "../lib/proc.mjs";
import { backgroundLoad } from "../lib/env.mjs";
import { sleep, summarize } from "../lib/stats.mjs";

export async function attach(ctx, { exe, name, args = [], runs = 3 }) {
  if (!exe) throw new Error("--exe <Pfad> fehlt");
  const out = { phase: "attach", name: name ?? path.basename(exe), exe, runs: [] };
  for (let run = 1; run <= runs; run++) {
    const bg = await backgroundLoad(ctx.probe, 2000);
    const app = startApp(exe, args, { cwd: path.dirname(exe) });
    const ready = await measureReady(ctx.probe, app, { timeout: 120000 });
    const r = { run, background: bg, ...ready };
    const wait = app.t0 + 30000 - performance.now();
    if (wait > 0) await sleep(wait);
    const s = await ctx.probe.stats([app.pid]);
    r.mem30 = { workingSetMiB: +(s.workingSet / 2 ** 20).toFixed(1), privateMiB: +(s.private / 2 ** 20).toFixed(1), processes: s.count };
    await killTree(ctx.probe, app.pid);
    ctx.log(`  ${out.name} #${run}: Fenster ${ready.windowMs?.toFixed(0)} ms, bedienbar ${ready.readyMs?.toFixed(0)} ms, RAM ${r.mem30.workingSetMiB} MiB`);
    out.runs.push(r);
    await sleep(3000);
  }
  out.summary = { windowMs: summarize(out.runs.map((r) => r.windowMs)), readyMs: summarize(out.runs.map((r) => r.readyMs)), ram30MiB: summarize(out.runs.map((r) => r.mem30.workingSetMiB)) };
  return out;
}
