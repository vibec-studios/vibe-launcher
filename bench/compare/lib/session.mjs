import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { measureReady, killTree } from "./proc.mjs";
import { readJson, writeJson } from "./fsutil.mjs";

const run = promisify(execFile);

function trackFile(ctx) {
  return path.join(ctx.l.work, "running.json");
}

async function track(ctx, pid, add) {
  const f = trackFile(ctx);
  const list = new Set(await readJson(f, []));
  if (add) list.add(pid); else list.delete(pid);
  await writeJson(f, [...list]);
}

export async function startLauncher(ctx, adapter, dataDir, { cdp = false, timeout = 120000 } = {}) {
  await adapter.seed(ctx, dataDir);
  const app = adapter.start(ctx, dataDir, { cdp });
  await track(ctx, app.pid, true);
  const ready = await measureReady(ctx.probe, app, {
    timeout,
    mainWindow: adapter.mainWindow,
    onWindow: adapter.onWindow ? (w) => adapter.onWindow(ctx, app, w) : undefined,
    extra: cdp && adapter.domReady ? adapter.domReady(app) : undefined,
  });
  return { app, ready };
}

export async function stopLauncher(ctx, app) {
  const pids = await killTree(ctx.probe, app.pid);
  await track(ctx, app.pid, false);
  return pids;
}

export async function ownProcesses(work) {
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${work.replaceAll("'", "''")}', [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { \"$($_.ProcessId)|$($_.Name)\" }`;
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-Command", ps], { windowsHide: true });
  return stdout.split(/\r?\n/).filter(Boolean).map((l) => { const [pid, name] = l.split("|"); return { pid: +pid, name }; });
}

export async function foreignMinecraft(work) {
  const ps = `Get-Process java,javaw -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match '^Minecraft' -and -not ($_.Path -and $_.Path.StartsWith('${work.replaceAll("'", "''")}', [StringComparison]::OrdinalIgnoreCase)) } | ForEach-Object { $_.Id }`;
  try {
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-Command", ps], { windowsHide: true });
    return stdout.split(/\r?\n/).filter(Boolean).map(Number);
  } catch { return []; }
}

export function rotate(list, i) {
  const k = i % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
}

export function exists(p) {
  return fs.existsSync(p);
}
