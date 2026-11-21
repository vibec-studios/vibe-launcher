import { sleep } from "./stats.mjs";

export class Cdp {
  static async connect(port, { timeout = 60000 } = {}) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((t) => t.type === "page" && /tauri\.localhost|^tauri:/.test(t.url)) ?? list.find((t) => t.type === "page");
        if (page?.webSocketDebuggerUrl) {
          const c = new Cdp();
          await c.#open(page.webSocketDebuggerUrl);
          return c;
        }
      } catch (e) { last = e; }
      await sleep(100);
    }
    throw new Error(`CDP nicht erreichbar (Port ${port}): ${last?.message ?? "kein Ziel"}`);
  }

  #ws;
  #id = 0;
  #pending = new Map();

  #open(url) {
    return new Promise((resolve, reject) => {
      this.#ws = new WebSocket(url);
      this.#ws.onopen = () => resolve();
      this.#ws.onerror = (e) => reject(new Error(`CDP-Verbindung fehlgeschlagen: ${e.message ?? e}`));
      this.#ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        const p = this.#pending.get(msg.id);
        if (!p) return;
        this.#pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      };
    });
  }

  send(method, params = {}) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  async invoke(cmd, args = {}) {
    const expr = `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}).then(v => ({ ok: true, v }), e => ({ ok: false, e: typeof e === "string" ? e : JSON.stringify(e) }))`;
    const r = await this.eval(expr);
    if (!r.ok) throw new Error(`${cmd}: ${r.e}`);
    return r.v;
  }

  close() {
    try { this.#ws.close(); } catch {}
  }
}
