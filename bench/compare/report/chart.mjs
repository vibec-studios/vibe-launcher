export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const SLOT = { vibe: 1, prism: 2, atlauncher: 3 };
export const slotOf = (id) => SLOT[id] ?? 4;

const nice = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v);
};

export function barChart({ title, unit, rows, scale = 1, digits = 1, note }) {
  const data = rows.filter((r) => r.s);
  if (!data.length) return "";
  const v = (x) => x / scale;
  const max = nice(Math.max(...data.map((r) => v(r.s.max))) * 1.05);
  const W = 640, L = 150, R = 70, rowH = 34, top = 8;
  const plot = W - L - R;
  const x = (val) => L + (val / max) * plot;
  const H = top + data.length * rowH + 24;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const fmt = (n) => n.toLocaleString("de-DE", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const grid = ticks.map((t) => `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${H - 22}"/><text class="tick" x="${x(t)}" y="${H - 6}" text-anchor="middle">${fmt(t)}</text>`).join("");
  const bars = data.map((r, i) => {
    const y = top + i * rowH + 7;
    const h = rowH - 14;
    const s = r.s;
    const tip = `${r.label}: Median ${fmt(v(s.median))} ${unit} · Spanne ${fmt(v(s.min))}–${fmt(v(s.max))} · IQR ${fmt(v(s.p25))}–${fmt(v(s.p75))} · n=${s.n}`;
    const w = Math.max(2, x(v(s.median)) - L);
    const whisk = s.n > 1 ? `<line class="whisker" x1="${x(v(s.min))}" x2="${x(v(s.max))}" y1="${y + h / 2}" y2="${y + h / 2}"/><line class="whisker" x1="${x(v(s.min))}" x2="${x(v(s.min))}" y1="${y + 4}" y2="${y + h - 4}"/><line class="whisker" x1="${x(v(s.max))}" x2="${x(v(s.max))}" y1="${y + 4}" y2="${y + h - 4}"/>` : "";
    return `<g class="mark"><title>${esc(tip)}</title><rect class="hit" x="0" y="${y - 6}" width="${W}" height="${rowH}"/><text class="label" x="${L - 10}" y="${y + h / 2 + 4}" text-anchor="end">${esc(r.label)}</text><path class="bar s${slotOf(r.id)}" d="M${L},${y} h${w - 4} a4,4 0 0 1 4,4 v${h - 8} a4,4 0 0 1 -4,4 h-${w - 4} z"/>${whisk}<text class="value" x="${Math.max(x(v(s.max)), L + w) + 8}" y="${y + h / 2 + 4}">${fmt(v(s.median))} ${esc(unit)}</text></g>`;
  }).join("");
  return `<figure class="chart"><figcaption>${esc(title)}</figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}<line class="axis" x1="${L}" x2="${L}" y1="${top}" y2="${H - 22}"/>${bars}</svg>${note ? `<p class="note">${esc(note)}</p>` : ""}</figure>`;
}

export function table(headers, rows) {
  return `<div class="tablewrap"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
