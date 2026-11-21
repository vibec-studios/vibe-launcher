import { SIZE, type Rows } from "./grid";
import { MEDIA_MOTIFS } from "./motifs-media";
import { PEOPLE_MOTIFS } from "./motifs-people";
import { STATUS_MOTIFS } from "./motifs-status";
import { WORK_MOTIFS } from "./motifs-work";

export const PIXEL_MOTIFS = { ...WORK_MOTIFS, ...PEOPLE_MOTIFS, ...MEDIA_MOTIFS, ...STATUS_MOTIFS } satisfies Record<string, Rows>;

export type PixelMotif = keyof typeof PIXEL_MOTIFS;

export const PIXEL_MOTIF_NAMES = Object.keys(PIXEL_MOTIFS) as PixelMotif[];

export function isPixelMotif(v: unknown): v is PixelMotif {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PIXEL_MOTIFS, v);
}

export type PixelRun = { x: number; y: number; w: number };

const cache = new Map<PixelMotif, Map<string, PixelRun[]>>();

export function motifRuns(name: PixelMotif): Map<string, PixelRun[]> {
  const hit = cache.get(name);
  if (hit) return hit;
  const runs = new Map<string, PixelRun[]>();
  PIXEL_MOTIFS[name].slice(0, SIZE).forEach((row, y) => {
    let x = 0;
    while (x < SIZE) {
      const c = row[x] ?? ".";
      let w = 1;
      while (x + w < SIZE && row[x + w] === c) w++;
      if (c !== ".") {
        const list = runs.get(c) ?? [];
        list.push({ x, y, w });
        runs.set(c, list);
      }
      x += w;
    }
  });
  cache.set(name, runs);
  return runs;
}
