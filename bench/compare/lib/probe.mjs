import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export class Probe {
  static async start() {
    const p = new Probe();
    await p.#boot();
    return p;
  }

  #proc;
  #queue = [];
  #lines;

  #boot() {
    this.#proc = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(here, "probe.ps1"), "-Source", path.join(here, "probe.cs")], { stdio: ["pipe", "pipe", "inherit"], windowsHide: true });
    this.#lines = createInterface({ input: this.#proc.stdout });
    return new Promise((resolve, reject) => {
      this.#queue.push({ resolve, reject });
      this.#lines.on("line", (l) => {
        const w = this.#queue.shift();
        if (!w) return;
        try { w.resolve(JSON.parse(l)); } catch (e) { w.reject(new Error(`Probe-Antwort unlesbar: ${l}`)); }
      });
      this.#proc.on("exit", (c) => { for (const w of this.#queue.splice(0)) w.reject(new Error(`Probe beendet (${c})`)); });
    });
  }

  cmd(...parts) {
    return new Promise((resolve, reject) => {
      this.#queue.push({ resolve, reject });
      this.#proc.stdin.write(parts.join("\t") + "\n");
    });
  }

  stats(pids) { return this.cmd("stats", pids.join(",")); }
  windows(pids) { return this.cmd("windows", pids.join(",")); }
  sys() { return this.cmd("sys"); }
  topCpu(ms = 2000) { return this.cmd("topcpu", ms); }
  shot(pids, file) { return this.cmd("shot", pids.join(","), file); }
  shotWin(hwnd, file) { return this.cmd("shotwin", hwnd, file); }
  uiaDumpWin(hwnd) { return this.cmd("uia-dumpwin", hwnd); }
  uiaDump(pids) { return this.cmd("uia-dump", pids.join(",")); }
  uiaTitles(pids) { return this.cmd("uia-titles", pids.join(",")); }
  uiaClick(pids, window, name) { return this.cmd("uia-click", pids.join(","), window, name); }

  close() {
    try { this.#proc.stdin.end("exit\n"); } catch {}
  }
}
