import fs from "node:fs";
import path from "node:path";
import { decodePng, encodePng } from "./png.mjs";
import { writeReport } from "./report.mjs";

function parseArgs(argv) {
  const opts = { baseline: null, current: null, threshold: 8, maxPixels: 20, report: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--threshold") opts.threshold = Number(argv[++i]);
    else if (a === "--max-pixels") opts.maxPixels = Number(argv[++i]);
    else if (a === "--report") opts.report = argv[++i];
    else if (!opts.baseline) opts.baseline = a;
    else if (!opts.current) opts.current = a;
    else throw new Error(`unbekanntes Argument: ${a}`);
  }
  if (!opts.baseline || !opts.current) throw new Error("Aufruf: node scripts/visual/compare.mjs <baseline> <neu> [--threshold 8] [--max-pixels 20] [--report <datei.html>]");
  return opts;
}

function listPngs(dir) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && !e.name.startsWith("_")) walk(r);
      else if (e.isFile() && e.name.endsWith(".png")) out.push(r);
    }
  };
  walk("");
  return out.sort();
}

function diffImages(a, b, threshold) {
  if (a.width !== b.width || a.height !== b.height) return { pixels: a.width * a.height, sizeMismatch: true, image: null };
  const out = Buffer.alloc(a.data.length);
  let pixels = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]), Math.abs(a.data[i + 3] - b.data[i + 3]));
    if (d > threshold) {
      pixels++;
      out[i] = 255;
      out[i + 1] = 0;
      out[i + 2] = 64;
      out[i + 3] = 255;
    } else {
      const g = Math.round((a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3 / 4) + 16;
      out[i] = out[i + 1] = out[i + 2] = g;
      out[i + 3] = 255;
    }
  }
  return { pixels, sizeMismatch: false, image: { width: a.width, height: a.height, data: out } };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const baseDir = path.resolve(opts.baseline);
  const curDir = path.resolve(opts.current);
  const diffDir = path.join(curDir, "_diff");
  fs.rmSync(diffDir, { recursive: true, force: true });
  const base = new Set(listPngs(baseDir));
  const cur = new Set(listPngs(curDir));
  const rows = [];
  for (const file of [...new Set([...base, ...cur])].sort()) {
    if (!base.has(file) || !cur.has(file)) {
      rows.push({ file, status: base.has(file) ? "fehlt" : "neu", pixels: null });
      continue;
    }
    const bb = fs.readFileSync(path.join(baseDir, file));
    const cb = fs.readFileSync(path.join(curDir, file));
    if (bb.equals(cb)) {
      rows.push({ file, status: "gleich", pixels: 0 });
      continue;
    }
    const res = diffImages(decodePng(bb), decodePng(cb), opts.threshold);
    const ok = !res.sizeMismatch && res.pixels <= opts.maxPixels;
    const row = { file, status: ok ? (res.pixels ? "toleriert" : "gleich") : "anders", pixels: res.pixels, sizeMismatch: res.sizeMismatch };
    if (res.image && res.pixels) {
      const target = path.join(diffDir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, encodePng(res.image));
      row.diff = path.relative(curDir, target).split(path.sep).join("/");
    }
    rows.push(row);
  }
  const report = path.resolve(opts.report ?? path.join(curDir, "report.html"));
  writeReport(report, { baseDir, curDir, rows, threshold: opts.threshold, maxPixels: opts.maxPixels });
  const bad = rows.filter((r) => r.status === "anders" || r.status === "fehlt" || r.status === "neu");
  for (const r of bad) console.log(`[visual] ${r.status.toUpperCase()}: ${r.file}${r.pixels ? ` (${r.pixels} Pixel)` : ""}`);
  const tolerated = rows.filter((r) => r.status === "toleriert").length;
  console.log(`[visual] ${rows.length} Bilder verglichen: ${bad.length} Unterschiede, ${tolerated} innerhalb der Toleranz. Bericht: ${report}`);
  process.exitCode = bad.length ? 1 : 0;
}

main();
