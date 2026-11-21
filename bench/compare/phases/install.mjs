import path from "node:path";
import { rmrf, dirSize } from "../lib/fsutil.mjs";
import { backgroundLoad } from "../lib/env.mjs";
import { sleep, summarize } from "../lib/stats.mjs";
import { startLauncher, stopLauncher, rotate } from "../lib/session.mjs";

const mib = (b) => +(b / 2 ** 20).toFixed(1);
const sec = (ms) => (ms == null ? "–" : `${(ms / 1000).toFixed(1)} s`);

async function oneRun(ctx, a, run, keep) {
  const dataDir = path.join(ctx.l.data, a.id, `install-${run}`);
  await rmrf(dataDir);
  const bg = await backgroundLoad(ctx.probe, 2000);
  for (const w of bg.warnings) ctx.log(`  ⚠ ${w}`);
  const c = ctx.forApp(a);
  const { app, ready } = await startLauncher(c, a, dataDir, { cdp: true });
  const r = { run, background: bg, startup: ready };
  try {
    if (ready.windowMs === null) throw new Error(ready.error);
    const base = await dirSize(dataDir);
    const v = await a.createVanilla(c, app);
    const afterV = await dirSize(dataDir);
    r.vanilla = { ...v, instanceMiB: mib((await dirSize(v.instanceDir)).bytes), dataGrowthMiB: mib(afterV.bytes - base.bytes) };
    ctx.log(`  ${a.name} #${run}: Vanilla ${sec(v.totalMs)} (anlegen ${sec(v.createMs)}, Spieldateien ${sec(v.installMs)}), +${r.vanilla.dataGrowthMiB} MiB`);
    const p = await a.importPack(c, app, ctx.packFile);
    const afterP = await dirSize(dataDir);
    r.pack = { ...p, instanceMiB: mib((await dirSize(p.instanceDir)).bytes), dataGrowthMiB: mib(afterP.bytes - afterV.bytes) };
    r.dataTotalMiB = mib(afterP.bytes);
    ctx.log(`  ${a.name} #${run}: Modpack ${sec(p.totalMs)} (Import ${sec(p.importMs)}, Spieldateien ${sec(p.installMs)}), +${r.pack.dataGrowthMiB} MiB`);
  } catch (e) {
    r.error = String(e.message ?? e);
    ctx.log(`  ✗ ${a.name} #${run}: ${r.error}`);
    try { await ctx.probe.shot([app.pid], path.join(ctx.l.work, `fail-${a.id}-${run}.png`)); r.screenshot = path.join(ctx.l.work, `fail-${a.id}-${run}.png`); } catch {}
  } finally {
    await stopLauncher(ctx, app);
    if (!keep) await rmrf(dataDir);
  }
  return r;
}

export async function install(ctx, launchers, { runs = 3, keep = false } = {}) {
  const usable = launchers.filter((a) => a.automation.install);
  const out = { phase: "install", params: { runs, pack: ctx.pins.modpack, packIndex: ctx.packIndex, mcVersion: ctx.pins.mcVersion }, launchers: {} };
  for (const a of launchers.filter((x) => !x.automation.install)) out.launchers[a.id] = { name: a.name, version: a.version, skipped: "Instanz-Anlage für diesen Launcher noch nicht automatisiert" };
  for (const a of usable) out.launchers[a.id] = { name: a.name, version: a.version, runs: [] };
  for (let run = 1; run <= runs; run++) {
    for (const a of rotate(usable, run - 1)) {
      ctx.log(`Instanzen: ${a.name}, Lauf ${run}/${runs}`);
      out.launchers[a.id].runs.push(await oneRun(ctx, a, run, keep));
      await sleep(2000);
    }
  }
  for (const a of usable) {
    const rs = out.launchers[a.id].runs.filter((r) => !r.error);
    out.launchers[a.id].summary = {
      vanillaCreateMs: summarize(rs.map((r) => r.vanilla?.createMs)),
      vanillaInstallMs: summarize(rs.map((r) => r.vanilla?.installMs)),
      vanillaTotalMs: summarize(rs.map((r) => r.vanilla?.totalMs)),
      packImportMs: summarize(rs.map((r) => r.pack?.importMs)),
      packInstallMs: summarize(rs.map((r) => r.pack?.installMs)),
      packTotalMs: summarize(rs.map((r) => r.pack?.totalMs)),
      vanillaInstanceMiB: summarize(rs.map((r) => r.vanilla?.instanceMiB)),
      vanillaDataGrowthMiB: summarize(rs.map((r) => r.vanilla?.dataGrowthMiB)),
      packInstanceMiB: summarize(rs.map((r) => r.pack?.instanceMiB)),
      packDataGrowthMiB: summarize(rs.map((r) => r.pack?.dataGrowthMiB)),
      dataTotalMiB: summarize(rs.map((r) => r.dataTotalMiB)),
      domReadyMs: summarize(out.launchers[a.id].runs.map((r) => r.startup?.domMs)),
      notes: rs[0]?.vanilla?.note ? [rs[0].vanilla.note] : [],
      errors: out.launchers[a.id].runs.filter((r) => r.error).map((r) => r.error),
    };
  }
  return out;
}
