import { shade } from "./color";
import { grid, lazy, paint, rng, rows, type Grid } from "./texture";
import type { DesignGroup, FlatDesign } from "./types";

function flat(id: string, group: DesignGroup, fill: boolean, palette: string[] | ((a: string) => string[]), g: () => Grid, tint = false): FlatDesign {
  return { kind: "flat", id, group, fill, tint, palette: typeof palette === "function" ? palette : () => palette, grid: lazy(g) };
}

function field(n: number, fn: (x: number, y: number) => number): Grid {
  return paint(grid(n), (x, y) => fn(x, y));
}

const d2 = (x: number, y: number, cx: number, cy: number) => (x - cx) ** 2 + (y - cy) ** 2;

export const FLAT_DESIGNS: FlatDesign[] = [
  flat("gradient", "pattern", true, (a) => [shade(a, 0.45), shade(a, 0.2), a, shade(a, -0.28), shade(a, -0.5)], () =>
    field(16, (x, y) => {
      const band = Math.min(4, Math.floor((y * 5) / 16));
      return y % 4 === 3 && (x + y) % 2 === 0 && band < 4 ? band + 1 : band;
    }), true),
  flat("checker", "pattern", true, (a) => [shade(a, 0.12), shade(a, -0.35), shade(a, 0.4)], () =>
    field(16, (x, y) => {
      const on = ((x >> 2) + (y >> 2)) % 2 === 0;
      return on ? (x % 4 === 0 && y % 4 === 0 ? 2 : 0) : 1;
    }), true),
  flat("stripes", "pattern", true, (a) => [a, shade(a, -0.32), shade(a, 0.3)], () =>
    field(16, (x, y) => {
      const k = Math.floor((x + y) / 3) % 2;
      return k === 0 ? ((x + y) % 3 === 0 ? 2 : 0) : 1;
    }), true),
  flat("waves", "pattern", true, (a) => [shade(a, 0.22), shade(a, -0.3), shade(a, 0.55)], () =>
    field(16, (x, y) => {
      const b = y + Math.round(Math.sin((x / 16) * Math.PI * 2) * 1.5) + 2;
      return b % 5 === 0 ? 2 : Math.floor(b / 5) % 2;
    }), true),
  flat("stars", "pattern", true, ["#141836", "#191f48", "#ffffff", "#ffe9a3", "#8fa2ff"], () => {
    const r = rng(17);
    const g = field(16, (x, y) => (y < 6 ? 0 : y < 10 ? ((x + y) % 2 === 0 ? 1 : 0) : 1));
    const cells: [number, number, number][] = [];
    for (let i = 0; i < 14; i++) cells.push([Math.floor(r() * 16), Math.floor(r() * 16), r() < 0.5 ? 2 : r() < 0.5 ? 3 : 4]);
    for (const [cx, cy] of [[4, 4], [11, 10]]) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) cells.push([cx + dx, cy + dy, dx || dy ? 3 : 2]);
    return paint(g, (x, y, c) => cells.find(([cx, cy]) => cx === x && cy === y)?.[2] ?? c);
  }),
  flat("sunset", "pattern", true, ["#2b1d4f", "#6b2f6b", "#c2456b", "#f07a4a", "#ffc15a", "#ffe9a0"], () =>
    field(16, (x, y) => {
      if (y >= 11 && d2(x, y, 7.5, 12) <= 16) return y === 11 || d2(x, y, 7.5, 12) < 4 ? 5 : 4;
      if (y >= 12) return 0;
      const band = Math.min(3, Math.floor(y / 3));
      return y % 3 === 2 && (x + y) % 2 === 0 ? Math.min(3, band + 1) : band;
    })),
  flat("heart", "symbol", false, ["#7a1428", "#e0314f", "#ff9aae"], () =>
    rows(["............", "..000..000..", ".0221001110.", "021111111110", "011111111110", "011111111110", ".0111111110.", "..01111110..", "...011110...", "....0110....", ".....00.....", "............"])),
  flat("bolt", "symbol", false, ["#000", "#ffc928", "#fff1a0"], () =>
    rows(["............", ".......1111.", "......2111..", ".....2111...", "....2111....", "...21111111.", "......1111..", ".....1111...", "....111.....", "...111......", "..11........", "............"])),
  flat("moon", "symbol", false, ["#000", "#f3e9c6", "#d8cc9f", "#bfb284"], () =>
    field(12, (x, y) => {
      if (d2(x, y, 5.5, 5.5) > 26 || d2(x, y, 8.2, 3.6) <= 17) return -1;
      if (d2(x, y, 8.2, 3.6) <= 26) return 2;
      return (x === 3 && y === 7) || (x === 4 && y === 8) || (x === 2 && y === 4) ? 3 : 1;
    })),
  flat("sun", "symbol", false, ["#000", "#ffd23a", "#ff9f1f", "#fff1a0"], () =>
    field(12, (x, y) => {
      const r2 = d2(x, y, 5.5, 5.5);
      if (r2 <= 6.5) return r2 <= 2.5 && x <= 5 && y <= 5 ? 3 : 1;
      if (r2 <= 9.5) return 2;
      const ang = Math.atan2(y - 5.5, x - 5.5) / (Math.PI / 4);
      return r2 >= 16 && r2 <= 32 && Math.abs(ang - Math.round(ang)) < 0.14 ? 1 : -1;
    })),
  flat("gem", "symbol", false, (a) => ["#000", a, shade(a, 0.45), shade(a, -0.4), "#ffffff"], () =>
    rows(["............", "............", "...222111...", "..22221111..", ".2222411111.", ".1111113333.", "..11113333..", "...111333...", "....1133....", ".....13.....", "............", "............"]), true),
  flat("sword", "symbol", false, ["#000", "#c9d2dc", "#ffffff", "#e0a92a", "#6b4a2b", "#5a6470"], () =>
    field(12, (x, y) => {
      const s = x + y;
      if (y <= 7 && x >= 4 && (s === 11 || s === 12)) return s === 11 ? 2 : x === 11 ? 5 : 1;
      if (x - y === -3 && x >= 1 && x <= 5) return 3;
      if (s === 11 && y >= 8 && y <= 10) return 4;
      if (x === 0 && y === 11) return 3;
      return -1;
    })),
  flat("flame", "symbol", false, ["#000", "#ff8a1f", "#ffd23a", "#d9341f", "#fff3c4"], () =>
    rows(["......3.....", ".....33.....", ".....313....", "....3113.3..", "...31113.33.", "..331111133.", ".3311221113.", ".3112222113.", ".3112442113.", "..31244213..", "...312213...", "....3333...."])),
  flat("tree", "symbol", false, ["#000", "#4f9a35", "#7cc254", "#2f6a22", "#7a5230"], () =>
    rows(["............", "....1111....", "...121111...", "..12211113..", ".1221111133.", ".1111111133.", ".1111111333.", "..11113333..", "....3443....", ".....44.....", ".....44.....", "....4444...."])),
  flat("potion", "symbol", false, (a) => ["#000", a, shade(a, 0.45), "#cfe3ee", "#8a5a33", "#ffffff"], () =>
    rows(["....4444....", "....4444....", "....3..3....", "....3..3....", "...3....3...", "..3.5....3..", ".3.5......3.", ".3111111113.", ".3121111113.", ".3112111113.", "..31111113..", "...333333..."]), true),
  flat("toadstool", "symbol", false, ["#000", "#d23a2c", "#f6ece0", "#8f2219", "#efe2cc", "#c9b89c"], () =>
    rows(["............", "....1111....", "..11211211..", ".1122111211.", ".1111112211.", "112111111211", "333333333333", "....4445....", "....4445....", "....4445....", "...444455...", "............"])),
];
