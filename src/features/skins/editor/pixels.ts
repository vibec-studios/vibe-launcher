import type { SkinVariant } from "@/lib/types";
import { faceRects, mirrorPart, SIZE, type Layer, type Part, type Rect } from "./layout";

export type Pixels = Uint8ClampedArray;
export type Rgba = [number, number, number, number];

export const emptyPixels = (): Pixels => new Uint8ClampedArray(SIZE * SIZE * 4);

export function getPx(px: Pixels, x: number, y: number): Rgba {
  const i = (y * SIZE + x) * 4;
  return [px[i], px[i + 1], px[i + 2], px[i + 3]];
}

export function setPx(px: Pixels, x: number, y: number, c: Rgba) {
  const i = (y * SIZE + x) * 4;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
  px[i + 3] = c[3];
}

export const sameColor = (a: Rgba, b: Rgba) => (a[3] === 0 && b[3] === 0) || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]);

export function hexToRgba(hex: string): Rgba {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function rgbaToHex(c: Rgba): string {
  return "#" + [c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export const isHex = (s: string) => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim());

export function normalizeHex(s: string): string {
  return rgbaToHex(hexToRgba(s.trim()));
}

export function floodFill(px: Pixels, x: number, y: number, color: Rgba, bounds: Rect, allowed: (x: number, y: number) => boolean): number {
  const start = getPx(px, x, y);
  if (sameColor(start, color)) return 0;
  const stack: [number, number][] = [[x, y]];
  const seen = new Uint8Array(SIZE * SIZE);
  let n = 0;
  while (stack.length) {
    const [cx, cy] = stack.pop()!;
    if (cx < bounds.x || cy < bounds.y || cx >= bounds.x + bounds.w || cy >= bounds.y + bounds.h) continue;
    const k = cy * SIZE + cx;
    if (seen[k]) continue;
    seen[k] = 1;
    if (!allowed(cx, cy) || !sameColor(getPx(px, cx, cy), start)) continue;
    setPx(px, cx, cy, color);
    n++;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  return n;
}

export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

export function copyPartMirrored(px: Pixels, from: Part, layer: Layer, variant: SkinVariant) {
  const to = mirrorPart(from);
  const src = faceRects(from, layer, variant);
  const dst = faceRects(to, layer, variant);
  const swap: Record<string, string> = { right: "left", left: "right" };
  const snapshot = px.slice();
  for (const s of src) {
    const d = dst.find((f) => f.face === (swap[s.face] ?? s.face));
    if (!d) continue;
    for (let fy = 0; fy < s.h; fy++) {
      for (let fx = 0; fx < s.w; fx++) setPx(px, d.x + (d.w - 1 - fx), d.y + fy, getPx(snapshot, s.x + fx, s.y + fy));
    }
  }
}

export function clearLayer(px: Pixels, parts: readonly Part[], layer: Layer, variant: SkinVariant) {
  for (const part of parts) {
    for (const f of faceRects(part, layer, variant)) {
      for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) setPx(px, x, y, [0, 0, 0, 0]);
    }
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });
}

export async function pixelsFromUrl(src: string): Promise<Pixels> {
  const img = await loadImage(src);
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false;
  const legacy = img.naturalHeight * 2 === img.naturalWidth;
  g.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, SIZE, legacy ? SIZE / 2 : SIZE);
  const px = new Uint8ClampedArray(g.getImageData(0, 0, SIZE, SIZE).data);
  if (legacy) {
    copyPartMirrored(px, "rightArm", "base", "classic");
    copyPartMirrored(px, "rightLeg", "base", "classic");
  }
  return px;
}

export function pixelsToDataUrl(px: Pixels): string {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(px), SIZE, SIZE), 0, 0);
  return c.toDataURL("image/png");
}

const TEMPLATE: Record<Part, { base: string; top?: string; bottom?: string; end?: string }> = {
  head: { base: "#d9a77f", top: "#6b4428" },
  body: { base: "#4f8a8b" },
  rightArm: { base: "#4f8a8b", end: "#d9a77f" },
  leftArm: { base: "#4f8a8b", end: "#d9a77f" },
  rightLeg: { base: "#3d4a6b", end: "#2f2f36" },
  leftLeg: { base: "#3d4a6b", end: "#2f2f36" },
};

export function templatePixels(variant: SkinVariant): Pixels {
  const px = emptyPixels();
  for (const part of Object.keys(TEMPLATE) as Part[]) {
    const t = TEMPLATE[part];
    for (const f of faceRects(part, "base", variant)) {
      const col = f.face === "top" && t.top ? t.top : f.face === "bottom" && t.end ? t.end : t.base;
      for (let y = f.y; y < f.y + f.h; y++) {
        for (let x = f.x; x < f.x + f.w; x++) {
          const end = t.end && (f.face === "bottom" || y >= f.y + f.h - (part.endsWith("Leg") ? 2 : 3));
          setPx(px, x, y, hexToRgba(end && f.face !== "top" ? t.end! : col));
        }
      }
    }
  }
  const head = faceRects("head", "base", variant);
  const hair = hexToRgba(TEMPLATE.head.top!);
  for (const f of head.filter((r) => r.face !== "top" && r.face !== "bottom")) {
    for (let x = f.x; x < f.x + f.w; x++) {
      setPx(px, x, f.y, hair);
      if (f.face !== "front") setPx(px, x, f.y + 1, hair);
    }
    if (f.face === "back") for (let y = f.y; y < f.y + 5; y++) for (let x = f.x; x < f.x + f.w; x++) setPx(px, x, y, hair);
  }
  const front = head.find((r) => r.face === "front")!;
  const white: Rgba = [245, 245, 245, 255];
  const eye: Rgba = [58, 86, 160, 255];
  setPx(px, front.x + 1, front.y + 4, white);
  setPx(px, front.x + 2, front.y + 4, eye);
  setPx(px, front.x + 5, front.y + 4, eye);
  setPx(px, front.x + 6, front.y + 4, white);
  setPx(px, front.x + 3, front.y + 6, [150, 92, 70, 255]);
  setPx(px, front.x + 4, front.y + 6, [150, 92, 70, 255]);
  return px;
}
