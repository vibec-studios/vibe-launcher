// ------------------------------------------------------------------ Frost (Winter)

/**
 * Eisblumen an einer oberen Dialogecke als Pixel-SVG (1-px-Linien): Kristalle wachsen von Ober- und Seitenkante
 * schräg nach innen und verzweigen sich wie Farnwedel; nahe der Ecke dichter und länger, nach außen schnell
 * spärlicher und blasser. Deterministisch, als CSS-url().
 */
export function frostSvg(mirror: boolean): string {
  const W = 120,
    H = 72;
  let s = 48271;
  const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const px = new Map<number, number>(); // y*W+x -> Deckkraft
  const plot = (x: number, y: number, o: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const k = y * W + x;
    px.set(k, Math.max(px.get(k) ?? 0, o));
  };
  // Ein Kristallast: diagonal (dx/dy je ±1/0), mit kurzen Seitenzweigen im 45°-Winkel
  const grow = (x: number, y: number, dx: number, dy: number, len: number, o: number, depth: number) => {
    for (let i = 0; i < len; i++) {
      x += dx;
      y += dy;
      const fade = o * (1 - (i / len) * 0.6);
      plot(x, y, fade);
      if (depth < 2 && i > 0 && i % 2 === 0 && r() < 0.55) {
        // Zweig im 45°-Winkel zur Hauptrichtung, etwa halb so lang wie der Rest des Asts
        const side = r() < 0.5 ? 1 : -1;
        const [bx, by] = dx !== 0 && dy !== 0 ? (side > 0 ? [dx, 0] : [0, dy]) : dx === 0 ? [side, dy] : [dx, side];
        grow(x, y, bx, by, Math.max(1, Math.round((len - i) * 0.45)), fade * 0.8, depth + 1);
      }
    }
  };
  // Oberkante: Keime werden nach außen seltener, Äste kürzer
  for (let x = 0; x < W; x++) {
    const d = x / W;
    if (r() < 0.32 * Math.exp(-d * 3.2)) {
      const len = Math.round(3 + (1 - d) * 11 * (0.5 + r()));
      const dir = r();
      grow(x, 0, dir < 0.4 ? 1 : dir < 0.8 ? -1 : 0, 1, len, 0.75 - d * 0.45, 0);
    }
  }
  // Seitenkante
  for (let y = 0; y < H; y++) {
    const d = y / H;
    if (r() < 0.3 * Math.exp(-d * 3.4)) {
      const len = Math.round(3 + (1 - d) * 9 * (0.5 + r()));
      const dir = r();
      grow(0, y, 1, dir < 0.4 ? 1 : dir < 0.8 ? -1 : 0, len, 0.7 - d * 0.45, 0);
    }
  }
  // Ein paar einzelne Reifkörner direkt an der Kante
  for (let x = 0; x < W * 0.6; x++) if (r() < 0.18 * (1 - x / (W * 0.6))) plot(x, 0, 0.5);
  const rects: string[] = [];
  for (const [k, o] of px) {
    const y = Math.floor(k / W),
      x = k % W;
    rects.push(`<rect x='${mirror ? W - 1 - x : x}' y='${y}' width='1' height='1' fill-opacity='${o.toFixed(2)}'/>`);
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' shape-rendering='crispEdges' fill='%23e4f4ff'>${rects.join("")}</svg>`;
  return `url("data:image/svg+xml;utf8,${svg}")`;
}
