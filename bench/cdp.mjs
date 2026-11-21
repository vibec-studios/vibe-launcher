export async function connect(port) {
  let targets;
  for (let i = 0; i < 200; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.some((t) => t.type === "page")) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const page = targets.find((t) => t.type === "page" && !t.url.includes("console")) ?? targets.find((t) => t.type === "page");
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
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 2000));
    return r.result?.result?.value;
  };
  for (let i = 0; i < 100; i++) {
    if (await evaluate("!!(window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke)")) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const invoke = async (cmd, args = {}) => {
    const v = await evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}).then(r => ({ ok: true, r }), e => ({ ok: false, e: typeof e === 'string' ? e : JSON.stringify(e) }))`);
    if (!v.ok) throw new Error(`${cmd}: ${v.e}`);
    return v.r;
  };
  const close = () => ws.close();
  return { evaluate, invoke, close };
}

export const LISTEN = `(async () => {
  if (window.__bench) return true;
  window.__bench = [];
  const I = window.__TAURI_INTERNALS__;
  for (const ev of ["task://update", "game://state", "game://log"]) {
    const handler = I.transformCallback((e) => window.__bench.push({ t: Date.now(), p: performance.now(), ev, payload: e.payload }));
    await I.invoke("plugin:event|listen", { event: ev, target: { kind: "Any" }, handler });
  }
  return true;
})()`;
