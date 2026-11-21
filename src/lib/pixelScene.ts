const cache = new Map<string, string>();

function rgb(hex: string): [number, number, number] {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? "ffb37d";
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

function ridge(seed: number, base: number, amp: number, step: number, w: number): number[] {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const out: number[] = [];
  let y = base;
  for (let x = 0; x < w; x += step) {
    y = Math.max(base - amp, Math.min(base + amp * 0.4, y + Math.round((r() - 0.52) * 3) * 2));
    out.push(y);
  }
  return out;
}

function hills(ys: number[], step: number, h: number, fill: string): string {
  return ys.map((y, i) => `<rect x='${i * step}' y='${y}' width='${step}' height='${h - y}' fill='${fill}'/>`).join("");
}

export function pixelScene(accent: string): string {
  const hit = cache.get(accent);
  if (hit) return hit;
  const W = 320;
  const H = 180;
  const top = "#0d0818";
  const horizon = mix("#3a1d52", accent, 0.35);
  const parts: string[] = [];
  const bands = 12;
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    parts.push(`<rect x='0' y='${i * 10}' width='${W}' height='${i === bands - 1 ? H : 10}' fill='${mix(top, horizon, t * t)}'/>`);
    if (i > 0 && i < bands - 1) {
      const prev = mix(top, horizon, ((i - 1) / (bands - 1)) ** 2);
      for (let x = (i % 2) * 2; x < W; x += 4) parts.push(`<rect x='${x}' y='${i * 10}' width='2' height='2' fill='${prev}'/>`);
    }
  }
  let s = 1337;
  const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 46; i++) {
    const x = Math.floor(r() * W);
    const y = Math.floor(r() * 90);
    const warm = r() < 0.3;
    parts.push(`<rect x='${x}' y='${y}' width='1' height='1' fill='${warm ? accent : "#ffffff"}' fill-opacity='${(0.35 + r() * 0.55).toFixed(2)}'/>`);
  }
  const sun = mix(accent, "#fff3c4", 0.55);
  const cx = 228;
  const cy = 126;
  for (let dy = -22; dy <= 0; dy += 2) {
    const half = Math.floor(Math.sqrt(22 * 22 - dy * dy) / 2) * 2;
    parts.push(`<rect x='${cx - half}' y='${cy + dy}' width='${half * 2}' height='2' fill='${sun}' fill-opacity='.85'/>`);
  }
  parts.push(hills(ridge(7, 128, 18, 6, W), 6, H, mix("#3b2160", accent, 0.12)));
  parts.push(hills(ridge(19, 146, 14, 4, W), 4, H, "#261540"));
  parts.push(hills(ridge(31, 162, 8, 4, W), 4, H, "#170e26"));
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' preserveAspectRatio='xMidYMax slice' shape-rendering='crispEdges'>${parts.join("")}</svg>`;
  const css = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") center bottom / cover no-repeat, ${top}`;
  cache.set(accent, css);
  return css;
}
