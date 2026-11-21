import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { connect, LISTEN } from "./cdp.mjs";

const EXE = process.env.BENCH_EXE;
const HOME = process.env.BENCH_HOME;
const PORT = Number(process.env.BENCH_PORT || 9377);
const OUT = process.env.BENCH_OUT || path.join(HOME || ".", "bench-out");
const pidFile = () => path.join(HOME, "bench-launcher.pid");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start() {
  fs.mkdirSync(HOME, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const env = {
    ...process.env,
    VIBE_LAUNCHER_HOME: HOME,
    WEBVIEW2_USER_DATA_FOLDER: path.join(HOME, "wv2"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    VIBE_DEV_OFFLINE_ACCOUNT: process.env.BENCH_ACCOUNT || "BenchUser",
    VIBE_BENCH_OUT: OUT,
  };
  const t0 = Date.now();
  const child = spawn(EXE, [], { env, detached: true, stdio: ["ignore", fs.openSync(path.join(HOME, "launcher-stdout.log"), "a"), fs.openSync(path.join(HOME, "launcher-stderr.log"), "a")] });
  child.unref();
  fs.writeFileSync(pidFile(), String(child.pid));
  const c = await connect(PORT);
  console.log(JSON.stringify({ pid: child.pid, cdp_ready_ms: Date.now() - t0 }));
  c.close();
}

async function stop() {
  const pid = Number(fs.readFileSync(pidFile(), "utf8"));
  try { process.kill(pid); } catch (e) { console.log("kill:", e.message); }
  fs.rmSync(pidFile(), { force: true });
}

async function call(cmd, json) {
  const c = await connect(PORT);
  const r = await c.invoke(cmd, json ? JSON.parse(json) : {});
  console.log(JSON.stringify(r, null, 1));
  c.close();
}

async function waitTask(c, taskId, timeoutMs = 3_600_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const list = await c.invoke("tasks_list");
    const t = list.find((x) => x.id === taskId);
    if (t && t.status !== "running" && t.status !== "queued") return t;
    await sleep(100);
  }
  throw new Error("Zeitlimit für Aufgabe " + taskId);
}

async function waitInstall(id) {
  const c = await connect(PORT);
  const taskId = await c.invoke("instance_install", { id, force: false });
  const t0 = Date.now();
  const t = await waitTask(c, taskId);
  console.log(JSON.stringify({ id, status: t.status, error: t.error, ms: Date.now() - t0 }));
  c.close();
}

function spawnFilesSince(ts) {
  if (!fs.existsSync(OUT)) return [];
  return fs.readdirSync(OUT).filter((f) => f.startsWith("spawn-")).map((f) => ({ f, t: Number(f.slice(6, -5)) / 1e6 })).filter((x) => x.t >= ts).sort((a, b) => a.t - b.t);
}

async function launch(id, label, loader) {
  const c = await connect(PORT);
  await c.evaluate(LISTEN);
  await c.evaluate("window.__bench.length = 0, true");
  const tClick = Number(await c.evaluate("Date.now()"));
  let tAutofix = null;
  if (loader && loader !== "vanilla") {
    await c.invoke("autofix_quick", { instanceId: id });
    tAutofix = Number(await c.evaluate("Date.now()"));
  }
  const taskId = await c.invoke("instance_launch", { id, accountId: null, world: null, server: null, offline: null, afk: null });
  const tReturned = Number(await c.evaluate("Date.now()"));
  const task = await waitTask(c, taskId);
  let spawn = null;
  for (let i = 0; i < 100 && !spawn; i++) {
    spawn = spawnFilesSince(tClick)[0] ?? null;
    if (!spawn) await sleep(50);
  }
  const events = await c.evaluate("window.__bench");
  const msgs = [];
  let last = null;
  for (const e of events) {
    if (e.ev !== "task://update" || e.payload.id !== taskId) continue;
    const m = e.payload.message ?? "";
    if (m !== last) { msgs.push({ t: e.t - tClick, m }); last = m; }
  }
  const states = events.filter((e) => e.ev === "game://state").map((e) => ({ t: e.t - tClick, s: e.payload.state, pid: e.payload.pid }));
  const res = {
    label, id, status: task.status, error: task.error,
    autofix_ms: tAutofix ? tAutofix - tClick : 0,
    invoke_return_ms: tReturned - tClick,
    spawn_ms: spawn ? Math.round(spawn.t - tClick) : null,
    task_done_ms: null,
    stages: msgs, states,
  };
  const done = events.find((e) => e.ev === "task://update" && e.payload.id === taskId && e.payload.status !== "running");
  if (done) res.task_done_ms = done.t - tClick;
  fs.appendFileSync(path.join(OUT, "launch-results.jsonl"), JSON.stringify(res) + "\n");
  console.log(JSON.stringify(res, null, 1));
  c.close();
}

const [cmd, ...rest] = process.argv.slice(2);
const fns = { start, stop, call: () => call(rest[0], rest[1]), install: () => waitInstall(rest[0]), launch: () => launch(rest[0], rest[1] || "", rest[2] || "") };
await fns[cmd]();
process.exit(0);
