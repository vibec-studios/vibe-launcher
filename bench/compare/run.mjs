#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { parseArgs, list, num } from "./lib/args.mjs";
import { pins, workDir, layout, resultsDir, benchDir } from "./lib/config.mjs";
import { readJson, writeJson } from "./lib/fsutil.mjs";
import { Probe } from "./lib/probe.mjs";
import { systemInfo, backgroundLoad } from "./lib/env.mjs";
import { adapters, defaultLaunchers } from "./adapters/index.mjs";
import { setup } from "./phases/setup.mjs";
import { idle } from "./phases/idle.mjs";
import { install } from "./phases/install.mjs";
import { launch } from "./phases/launch.mjs";
import { attach } from "./phases/attach.mjs";
import { cleanup } from "./phases/cleanup.mjs";
import { buildReport } from "./report/build.mjs";
import { usage } from "./lib/usage.mjs";

const args = parseArgs(process.argv.slice(2));
const phases = list(args.phase, []);
if (args.help || !phases.length) {
  console.log(usage);
  process.exit(args.help ? 0 : 1);
}

const log = (m) => console.log(m);
const l = layout(workDir(args));
const ids = list(args.launchers, defaultLaunchers);
for (const id of ids) if (!adapters[id]) throw new Error(`Unbekannter Launcher: ${id} (bekannt: ${Object.keys(adapters).join(", ")})`);
const launchers = ids.map((id) => adapters[id]);
if (phases.some((p) => !["report", "cleanup"].includes(p))) fs.mkdirSync(l.work, { recursive: true });

const probe = await Probe.start();
const state = await readJson(l.state, {});
const ctx = {
  args, l, pins, log, probe, state,
  repoDir: path.resolve(benchDir, "..", ".."),
  get javaw() { return this.state.java?.javaw; },
  get packFile() { return this.state.modpack?.file; },
  get packIndex() { return this.state.modpack?.index; },
  get vanillaPackFile() { return this.state.vanillaPack; },
  forApp(a) {
    const app = this.state.apps?.[a.id];
    if (!app) throw new Error(`${a.name} ist nicht vorbereitet – zuerst --phase setup ausführen`);
    return Object.assign(Object.create(this), { app });
  },
};

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
let system;

function scrub(value) {
  const enc = (s) => JSON.stringify(s).slice(1, -1);
  const text = JSON.stringify(value).split(enc(l.work)).join("<work>").split(enc(os.homedir())).join("~");
  return JSON.parse(text);
}

async function save(result) {
  system ??= await systemInfo();
  const file = path.join(resultsDir, `${result.phase}-${stamp()}.json`);
  await writeJson(file, scrub(result));
  log(`Ergebnis: ${file}`);
}

async function runPhase(name) {
  const meta = { startedAt: new Date().toISOString(), args: process.argv.slice(2), pins };
  let result;
  if (name === "setup") result = await setup(ctx, launchers);
  else if (name === "idle") result = await idle(ctx, launchers.filter((a) => a.automation.idle), { runs: num(args.runs, 5), longRuns: num(args["long-runs"], 2), shortMs: 30000, longMs: num(args["idle-seconds"], 300) * 1000 });
  else if (name === "install") result = await install(ctx, launchers, { runs: num(args.runs, 3), keep: !!args.keep });
  else if (name === "launch") result = await launch(ctx, launchers, { runs: num(args.runs, 3), kinds: list(args.kinds, ["vanilla", "pack"]) });
  else if (name === "attach") result = await attach(ctx, { exe: args.exe, name: args.name, args: list(args["exe-args"], []), runs: num(args.runs, 3) });
  else if (name === "cleanup") { await cleanup(ctx, { keepDownloads: !!args["keep-downloads"] }); return; }
  else if (name === "report") { log(`Bericht: ${buildReport(resultsDir)}`); return; }
  else throw new Error(`Unbekannte Phase: ${name}`);
  ctx.state = await readJson(l.state, {});
  meta.finishedAt = new Date().toISOString();
  meta.system = system ??= await systemInfo();
  result.meta = meta;
  await save(result);
  log(`Bericht: ${buildReport(resultsDir)}`);
}

let code = 0;
try {
  if (phases.some((p) => ["idle", "install", "launch"].includes(p))) {
    const bg = await backgroundLoad(probe, 3000);
    log(`Hintergrundlast: ${bg.cpuPct} % CPU, ${bg.freeGb} GB frei`);
    for (const w of bg.warnings) log(`⚠ ${w}`);
  }
  for (const p of phases) {
    log(`\n=== Phase ${p} ===`);
    await runPhase(p);
  }
} catch (e) {
  console.error(`Fehler: ${e.stack ?? e}`);
  code = 1;
} finally {
  probe.close();
}
process.exit(code);
