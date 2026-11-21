import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const UA = "vibe-launcher-bench/0.1";

export async function hashFile(file, algo = "sha256") {
  const h = crypto.createHash(algo);
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}

export async function download(url, dir, name, expect = {}) {
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
    if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status}): ${url}`);
    const tmp = file + ".part";
    await fsp.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
    await fsp.rename(tmp, file);
  }
  const size = (await fsp.stat(file)).size;
  if (!size) throw new Error(`Leere Datei: ${file}`);
  const sha256 = await hashFile(file, "sha256");
  if (expect.sha256 && expect.sha256 !== sha256) throw new Error(`SHA-256 stimmt nicht für ${name}: ${sha256}`);
  if (expect.sha512 && (await hashFile(file, "sha512")) !== expect.sha512) throw new Error(`SHA-512 stimmt nicht für ${name}`);
  return { file, size, sha256, url };
}

export async function extractZip(zip, dest) {
  await rmrf(dest);
  await fsp.mkdir(dest, { recursive: true });
  const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  await run(tar, ["-xf", zip, "-C", dest], { windowsHide: true, maxBuffer: 1 << 24 });
  return dest;
}

export async function dirSize(root) {
  const seen = new Set();
  let bytes = 0;
  let files = 0;
  async function walk(d) {
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { await walk(p); continue; }
      try {
        const s = await fsp.lstat(p, { bigint: true });
        const key = `${s.dev}:${s.ino}`;
        if (s.ino && seen.has(key)) continue;
        seen.add(key);
        bytes += Number(s.size);
        files++;
      } catch {}
    }
  }
  await walk(root);
  return { bytes, files };
}

export async function rmrf(p) {
  for (let i = 0; i < 20; i++) {
    try { await fsp.rm(p, { recursive: true, force: true }); return; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  await fsp.rm(p, { recursive: true, force: true });
}

export async function readJson(file, fallback = null) {
  try { return JSON.parse(await fsp.readFile(file, "utf8")); } catch { return fallback; }
}

export async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(value, null, 2));
}

export async function findFiles(root, test, depth = 6) {
  const out = [];
  async function walk(d, n) {
    if (n < 0) return;
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p, n - 1);
      else if (test(p)) out.push(p);
    }
  }
  await walk(root, depth);
  return out;
}
