import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { sleep } from "./stats.mjs";

const run = promisify(execFile);

export function startApp(exe, args = [], { env = {}, cwd } = {}) {
  const t0 = performance.now();
  const proc = spawn(exe, args, { cwd, env: { ...process.env, ...env }, stdio: "ignore", detached: false, windowsHide: false });
  return { proc, pid: proc.pid, t0, exe };
}

export async function treePids(probe, pid) {
  const s = await probe.stats([pid]);
  return s.pids ?? [];
}

export async function killTree(probe, pid) {
  const pids = probe ? await treePids(probe, pid).catch(() => []) : [];
  await run("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }).catch(() => {});
  await sleep(500);
  if (probe && pids.length) {
    const alive = (await probe.stats(pids).catch(() => ({ pids: [] }))).pids ?? [];
    for (const p of alive) await run("taskkill", ["/PID", String(p), "/F"], { windowsHide: true }).catch(() => {});
  }
  return pids;
}

export async function measureReady(probe, app, { timeout = 90000, settleMs = 1000, settleCorePct = 10, extra, mainWindow, onWindow } = {}) {
  const end = app.t0 + timeout;
  let windowMs = null;
  let firstWindowMs = null;
  let title = null;
  const interventions = [];
  while (performance.now() < end) {
    const w = await probe.windows([app.pid]);
    if (Array.isArray(w) && w.length) {
      if (firstWindowMs === null) firstWindowMs = performance.now() - app.t0;
      const main = w.find((x) => !x.owned && (!mainWindow || mainWindow.test(x.title)));
      if (main) {
        windowMs = performance.now() - app.t0;
        title = main.title;
        break;
      }
      if (onWindow) {
        const r = await onWindow(w);
        if (r) interventions.push({ atMs: performance.now() - app.t0, ...r });
      }
    }
    await sleep(50);
  }
  if (windowMs === null) return { windowMs: null, readyMs: null, firstWindowMs, interventions, error: "kein Hauptfenster" };
  const extraP = extra ? extra().then((ms) => ms, (e) => ({ error: String(e.message ?? e) })) : Promise.resolve(null);
  const step = 250;
  const need = Math.ceil(settleMs / step);
  let quiet = 0;
  let firstQuietAt = null;
  let prev = await probe.stats([app.pid]);
  let prevT = performance.now();
  let readyMs = null;
  while (performance.now() < end) {
    await sleep(step);
    const cur = await probe.stats([app.pid]);
    const now = performance.now();
    const pct = ((cur.cpuMs - prev.cpuMs) / (now - prevT)) * 100;
    prev = cur;
    prevT = now;
    if (pct < settleCorePct) {
      if (quiet === 0) firstQuietAt = now - step;
      quiet++;
      if (quiet >= need) { readyMs = firstQuietAt - app.t0; break; }
    } else quiet = 0;
  }
  const extraRes = await Promise.race([extraP, sleep(Math.max(0, end - performance.now())).then(() => ({ error: "Zeitüberschreitung" }))]);
  const domMs = typeof extraRes === "number" ? extraRes - app.t0 : null;
  return { firstWindowMs, windowMs, readyMs: readyMs === null ? null : Math.max(readyMs, windowMs), domMs, domError: extraRes?.error ?? null, title, interventions };
}
