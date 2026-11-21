export interface Grid {
  n: number;
  px: Int8Array;
}

export function grid(n: number, fill = 0): Grid {
  return { n, px: new Int8Array(n * n).fill(fill) };
}

export function rows(lines: string[]): Grid {
  const n = lines.length;
  const g = grid(n, -1);
  lines.forEach((line, y) => {
    for (let x = 0; x < n; x++) {
      const c = line[x] ?? ".";
      g.px[y * n + x] = c === "." ? -1 : parseInt(c, 36);
    }
  });
  return g;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function speckle(n: number, seed: number, weights: number[]): Grid {
  const r = rng(seed);
  const total = weights.reduce((a, b) => a + b, 0);
  const g = grid(n);
  for (let i = 0; i < g.px.length; i++) {
    let v = r() * total;
    let k = 0;
    while (k < weights.length - 1 && v >= weights[k]) v -= weights[k++];
    g.px[i] = k;
  }
  return g;
}

export function paint(g: Grid, fn: (x: number, y: number, cur: number) => number): Grid {
  const out = { n: g.n, px: new Int8Array(g.px) };
  for (let y = 0; y < g.n; y++) for (let x = 0; x < g.n; x++) out.px[y * g.n + x] = fn(x, y, g.px[y * g.n + x]);
  return out;
}

export function at(g: Grid, x: number, y: number): number {
  return x < 0 || y < 0 || x >= g.n || y >= g.n ? -1 : g.px[y * g.n + x];
}

export function stamp(g: Grid, cells: [number, number, number][]): Grid {
  const out = { n: g.n, px: new Int8Array(g.px) };
  for (const [x, y, c] of cells) if (x >= 0 && y >= 0 && x < g.n && y < g.n) out.px[y * g.n + x] = c;
  return out;
}

export function spots(seed: number, n: number, count: number, size: number, base: number): [number, number, number][] {
  const r = rng(seed);
  const cells: [number, number, number][] = [];
  const shapes = [
    [[0, 0], [1, 0], [0, 1]],
    [[0, 0], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [1, 1]],
    [[1, 0], [0, 1], [1, 1]],
  ];
  for (let i = 0; i < count; i++) {
    const ox = 1 + Math.floor(r() * (n - 3));
    const oy = 1 + Math.floor(r() * (n - 3));
    const s = shapes[Math.floor(r() * shapes.length)].slice(0, size);
    s.forEach(([dx, dy], k) => cells.push([ox + dx, oy + dy, base + (k === 0 ? 1 : k === 2 ? 2 : 0)]));
  }
  return cells;
}

const pathCache = new WeakMap<Grid, string[]>();

export function toPaths(g: Grid): string[] {
  const hit = pathCache.get(g);
  if (hit) return hit;
  const out: string[] = [];
  for (let y = 0; y < g.n; y++) {
    let x = 0;
    while (x < g.n) {
      const c = g.px[y * g.n + x];
      let len = 1;
      while (x + len < g.n && g.px[y * g.n + x + len] === c) len++;
      if (c >= 0) out[c] = (out[c] ?? "") + `M${x} ${y}h${len}v1h-${len}z`;
      x += len;
    }
  }
  pathCache.set(g, out);
  return out;
}

export function lazy<T>(fn: () => T): () => T {
  let v: T | undefined;
  return () => (v ??= fn());
}
