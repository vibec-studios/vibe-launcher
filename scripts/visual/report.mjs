import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const href = (file) => esc(pathToFileURL(file).href);

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f6f4;--fg:#18181b;--muted:#6b6b73;--card:#fff;--line:#e2e2de;--bad:#c81e45;--ok:#0f7a5c;--warn:#8a5a00}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--fg:#ececf0;--muted:#9a9aa3;--card:#1b1b1f;--line:#2c2c31;--bad:#ff7b8e;--ok:#6ee7b7;--warn:#ffd27a}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:var(--muted)}
.sum{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px}.sum b{font-size:18px;display:block}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:16px}
.card h2{font-size:15px;margin:0 0 8px;display:flex;gap:8px;align-items:center}
.tag{font-size:12px;padding:1px 8px;border-radius:99px;border:1px solid currentColor}
.anders,.fehlt,.neu{color:var(--bad)}.toleriert{color:var(--warn)}.gleich{color:var(--ok)}
.imgs{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px}
.imgs figure{margin:0}.imgs figcaption{font-size:12px;color:var(--muted)}.imgs img{width:100%;border:1px solid var(--line)}
details{margin-top:12px}ul{columns:2;font-size:12px;color:var(--muted)}`;

function card(row, baseDir, curDir) {
  const imgs = [];
  if (row.status !== "neu") imgs.push(["Baseline", path.join(baseDir, row.file)]);
  if (row.status !== "fehlt") imgs.push(["Neu", path.join(curDir, row.file)]);
  if (row.diff) imgs.push(["Unterschied", path.join(curDir, row.diff)]);
  const info = row.sizeMismatch ? "Bildgröße unterschiedlich" : row.pixels != null ? `${row.pixels} Pixel` : "";
  return `<div class="card"><h2>${esc(row.file)} <span class="tag ${row.status}">${row.status}</span> <small>${esc(info)}</small></h2><div class="imgs">${imgs
    .map(([label, f]) => `<figure><figcaption>${label}</figcaption><a href="${href(f)}"><img loading="lazy" src="${href(f)}" alt="${label}"></a></figure>`)
    .join("")}</div></div>`;
}

export function writeReport(file, { baseDir, curDir, rows, threshold, maxPixels }) {
  const count = (s) => rows.filter((r) => r.status === s).length;
  const shown = rows.filter((r) => r.status !== "gleich");
  const same = rows.filter((r) => r.status === "gleich");
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Screenshot-Vergleich</title><style>${STYLE}</style></head><body>
<h1>Screenshot-Vergleich</h1><p>${esc(baseDir)} → ${esc(curDir)} · Toleranz ${threshold}/255 je Kanal, höchstens ${maxPixels} Pixel</p>
<div class="sum"><div class="anders"><b>${count("anders")}</b>anders</div><div class="fehlt"><b>${count("fehlt") + count("neu")}</b>fehlt/neu</div><div class="toleriert"><b>${count("toleriert")}</b>toleriert</div><div class="gleich"><b>${same.length}</b>gleich</div></div>
${shown.map((r) => card(r, baseDir, curDir)).join("\n")}
<details><summary>${same.length} gleiche Bilder</summary><ul>${same.map((r) => `<li>${esc(r.file)}</li>`).join("")}</ul></details>
</body></html>`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}
