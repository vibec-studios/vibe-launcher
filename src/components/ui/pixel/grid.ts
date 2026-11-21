export type Rows = readonly string[];

export const SIZE = 16;

export function recolor(rows: Rows, map: Record<string, string>): string[] {
  return rows.map((r) => [...r].map((c) => map[c] ?? c).join(""));
}

export function slash(rows: Rows, ch = "r"): string[] {
  return rows.map((r, y) =>
    [...r]
      .map((c, x) => {
        if (y < 1 || y > 14) return c;
        if (x === y || x === y + 1) return ch;
        if ((x === y - 1 || x === y + 2) && c !== ".") return ".";
        return c;
      })
      .join(""),
  );
}

const EDGE: [number, number][] = [[5, 10], [3, 12], [2, 13], [1, 14], [1, 14], [1, 14], [1, 14], [1, 14], [1, 14], [1, 14], [1, 14], [2, 13], [3, 12], [5, 10]];

export function disc(fill: Rows): string[] {
  const out = [".".repeat(SIZE)];
  EDGE.forEach(([a, b], i) => {
    const y = i + 1;
    const row = Array<string>(SIZE).fill(".");
    if (y === 1 || y === 14) for (let x = a; x <= b; x++) row[x] = "o";
    else {
      const inner = fill[y - 2] ?? "";
      const from = y === 2 || y === 13 ? a + 2 : a + 1;
      const to = y === 2 || y === 13 ? b - 2 : b - 1;
      for (let x = a; x <= b; x++) row[x] = x < from || x > to ? "o" : inner[x - from] ?? "l";
    }
    out.push(row.join(""));
  });
  out.push(".".repeat(SIZE));
  return out;
}
