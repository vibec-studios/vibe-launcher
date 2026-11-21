import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EXE = process.env.MEM_EXE;
const HOME = process.env.MEM_HOME;
const PORT = Number(process.env.MEM_PORT || 9361);
const LABEL = process.env.MEM_LABEL || "run";
const LONG = Number(process.env.MEM_LONG || 300);
const EXTRA_ARGS = process.env.MEM_BROWSER_ARGS || "";
const OUT = process.env.MEM_OUT || path.join(HOME, "..", "mem-out");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

function procTree(root) {
  const ps = `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,PrivatePageCount,WorkingSetSize | ConvertTo-Json -Compress`;
  const all = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { maxBuffer: 64 << 20 }).toString());
  const kids = new Map();
  for (const p of all) {
    if (!kids.has(p.ParentProcessId)) kids.set(p.ParentProcessId, []);
    kids.get(p.ParentProcessId).push(p);
  }
  const out = [];
  const walk = (pid) => {
    for (const c of kids.get(pid) ?? []) {
      out.push(c);
      walk(c.ProcessId);
    }
  };
  const self = all.find((p) => p.ProcessId === root);
  if (self) out.push(self);
  walk(root);
  return out.map((p) => ({
    pid: p.ProcessId,
    name: p.Name,
    kind: kindOf(p),
    priv: Number(p.PrivatePageCount),
    ws: Number(p.WorkingSetSize),
  }));
}

function kindOf(p) {
  const cl = p.CommandLine || "";
  if (!/msedgewebview2/i.test(p.Name)) return p.Name.replace(/\.exe$/i, "");
  const t = /--type=([\w-]+)/.exec(cl)?.[1];
  if (!t) return "wv2-browser";
  if (t === "utility") return "wv2-utility:" + (/--utility-sub-type=([\w.]+)/.exec(cl)?.[1] ?? "?").split(".").pop();
  if (t === "renderer" && /--extension-process/.test(cl)) return "wv2-renderer-ext";
  return "wv2-" + t;
}

async function connect() {
  let targets;
  for (let i = 0; i < 400; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      if (targets.some((t) => t.type === "page")) break;
    } catch {}
    await sleep(250);
  }
  const page = targets.find((t) => t.type === "page" && !t.url.includes("console"));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 1500));
    return r.result?.result?.value;
  };
  await send("Performance.enable");
  return { send, evaluate, close: () => ws.close() };
}

async function cdpMetrics(c) {
  const m = await c.send("Performance.getMetrics");
  const o = Object.fromEntries((m.result?.metrics ?? []).map((x) => [x.name, x.value]));
  const dom = await c.evaluate(`({ imgs: document.images.length, nodes: document.getElementsByTagName('*').length, canvases: document.querySelectorAll('canvas').length, videos: document.querySelectorAll('video').length, url: location.hash,
    imgBytes: [...document.images].reduce((a, i) => a + (i.naturalWidth * i.naturalHeight * 4), 0),
    bigImgs: [...document.images].filter(i => i.naturalWidth * i.naturalHeight > 4 * i.clientWidth * i.clientHeight * devicePixelRatio * devicePixelRatio && i.naturalWidth > 128).length })`);
  return { jsUsed: o.JSHeapUsedSize, jsTotal: o.JSHeapTotalSize, nodes: o.Nodes, docs: o.Documents, listeners: o.JSEventListeners, layoutObjects: o.LayoutObjects, ...dom };
}

const MiB = (b) => (b / 1048576).toFixed(1);

async function snapshot(c, pid, tag) {
  const procs = procTree(pid);
  const cdp = await cdpMetrics(c);
  const groups = {};
  for (const p of procs) {
    const g = (groups[p.kind] ??= { n: 0, priv: 0, ws: 0 });
    g.n++; g.priv += p.priv; g.ws += p.ws;
  }
  const tot = procs.reduce((a, p) => ({ priv: a.priv + p.priv, ws: a.ws + p.ws }), { priv: 0, ws: 0 });
  const rec = { tag, t: new Date().toISOString(), n: procs.length, tot, groups, cdp, procs };
  console.log(`[${tag}] n=${procs.length} priv=${MiB(tot.priv)} ws=${MiB(tot.ws)} | js=${MiB(cdp.jsUsed)}/${MiB(cdp.jsTotal)} nodes=${cdp.nodes} imgs=${cdp.imgs} imgDec≈${MiB(cdp.imgBytes)}`);
  for (const [k, g] of Object.entries(groups)) console.log(`   ${k.padEnd(34)} n=${g.n} priv=${MiB(g.priv).padStart(7)} ws=${MiB(g.ws).padStart(7)}`);
  return rec;
}

const NAV_WAIT = `(async (hash) => {
  const t0 = performance.now();
  let last = t0;
  const mo = new MutationObserver(() => { last = performance.now(); });
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  location.hash = hash;
  const start = performance.now();
  while (performance.now() - start < 6000) {
    await new Promise(r => setTimeout(r, 50));
    if (performance.now() - last > 600 && performance.now() - t0 > 700) break;
  }
  mo.disconnect();
  return Math.round(last - t0);
})`;

const PAGES = ["#/instances", "#/discover", "#/modsets", "#/accounts", "#/skins", "#/stats", "#/screenshots", "#/servers", "#/social", "#/settings?tab=appearance", "#/"];

async function main() {
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(path.join(HOME, "settings.json"), JSON.stringify({ onboarding_done: true}));
  const env = {
    ...process.env,
    VIBE_LAUNCHER_HOME: HOME,
    WEBVIEW2_USER_DATA_FOLDER: path.join(HOME, "wv2"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}${EXTRA_ARGS ? " " + EXTRA_ARGS : ""}`,
    VIBE_DEV_OFFLINE_ACCOUNT: "MemUser",
  };
  const child = spawn(EXE, [], { env, detached: true, stdio: ["ignore", fs.openSync(path.join(HOME, "stdout.log"), "a"), fs.openSync(path.join(HOME, "stderr.log"), "a")] });
  child.unref();
  const pid = child.pid;
  fs.writeFileSync(path.join(OUT, `${LABEL}.pid`), String(pid));
  const res = { label: LABEL, extra: EXTRA_ARGS, snaps: [], nav: [] };
  try {
    const c = await connect();
    await sleep(30_000);
    res.snaps.push(await snapshot(c, pid, "start-30s"));
    for (let round = 0; round < 2; round++) {
      for (const h of PAGES) {
        const ms = await c.evaluate(`${NAV_WAIT}(${JSON.stringify(h)})`);
        res.nav.push({ round, h, ms });
        if (process.env.MEM_PERPAGE && round === 0) { await sleep(1500); const g = procTree(pid).filter((p) => /gpu|renderer/.test(p.kind)).map((p) => `${p.kind}=${MiB(p.priv)}`).join(" "); console.log("  page", h, g); }
        if (h.startsWith("#/settings")) {
          await sleep(500);
          await c.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`);
          await sleep(500);
        }
      }
      console.log("nav", round, res.nav.filter((n) => n.round === round).map((n) => `${n.h}:${n.ms}`).join(" "));
    }
    await sleep(3000);
    res.snaps.push(await snapshot(c, pid, "after-nav"));
    await sleep(Math.max(0, LONG * 1000 - 60_000));
    res.snaps.push(await snapshot(c, pid, `idle-${LONG}s`));
    await c.send("HeapProfiler.enable");
    await c.send("HeapProfiler.collectGarbage");
    await sleep(2000);
    res.snaps.push(await snapshot(c, pid, "after-gc"));
    c.close();
  } finally {
    fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(res, null, 1));
    if (!process.env.MEM_KEEP) {
      try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"]); } catch {}
    }
  }
}

await main();
process.exit(0);
