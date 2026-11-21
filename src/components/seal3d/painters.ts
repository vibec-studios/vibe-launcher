export type Painter = (g: CanvasRenderingContext2D, w: number, h: number) => void;

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function hex(c: string) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Grundfarbe mit ganz leichtem Pixelrauschen. */
export function noisy(base: string, amount = 0.018, seed = 1): Painter {
  return (g, w, h) => {
    const r = rng(seed);
    const [R, G, B] = hex(base);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const f = 1 + (r() - 0.5) * 2 * amount;
        g.fillStyle = `rgb(${Math.min(255, R * f) | 0},${Math.min(255, G * f) | 0},${Math.min(255, B * f) | 0})`;
        g.fillRect(x, y, 1, 1);
      }
  };
}

export function px(color: string, list: [number, number][]): Painter {
  return (g) => {
    g.fillStyle = color;
    for (const [x, y] of list) g.fillRect(x, y, 1, 1);
  };
}

export function rows(color: string, y: number, h: number): Painter {
  return (g, w) => {
    g.fillStyle = color;
    g.fillRect(0, y, w, h);
  };
}

export const all =
  (...ps: Painter[]): Painter =>
  (g, w, h) => {
    for (const p of ps) p(g, w, h);
  };
