import fs from "node:fs";
import path from "node:path";
import { ownProcesses } from "../lib/session.mjs";
import { run } from "../lib/shell.mjs";
import { rmrf } from "../lib/fsutil.mjs";
import { sleep } from "../lib/stats.mjs";

export async function cleanup(ctx, { keepDownloads = false } = {}) {
  const procs = await ownProcesses(ctx.l.work);
  for (const p of procs) {
    ctx.log(`  beende eigenen Prozess ${p.name} (${p.pid})`);
    await run("taskkill", ["/PID", String(p.pid), "/T", "/F"]).catch(() => {});
  }
  if (procs.length) await sleep(2000);
  const left = await ownProcesses(ctx.l.work);
  if (left.length) throw new Error(`Noch laufende Testprozesse: ${left.map((p) => `${p.name}(${p.pid})`).join(", ")}`);
  if (!fs.existsSync(ctx.l.work)) return { removed: false };
  if (keepDownloads) {
    for (const d of fs.readdirSync(ctx.l.work)) if (d !== "downloads") await rmrf(path.join(ctx.l.work, d));
  } else {
    await rmrf(ctx.l.work);
  }
  ctx.log(`Testordner ${keepDownloads ? "geleert (Downloads behalten)" : "gelöscht"}: ${ctx.l.work}`);
  return { removed: true, killed: procs.length };
}
