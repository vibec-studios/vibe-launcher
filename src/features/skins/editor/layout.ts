import type { SkinVariant } from "@/lib/types";

export const SIZE = 64;

export type Part = "head" | "body" | "rightArm" | "leftArm" | "rightLeg" | "leftLeg";
export type Layer = "base" | "overlay";
export type Face = "top" | "bottom" | "right" | "front" | "left" | "back";

export const PARTS: readonly Part[] = ["head", "body", "rightArm", "leftArm", "rightLeg", "leftLeg"];
export const FACES: readonly Face[] = ["top", "bottom", "right", "front", "left", "back"];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaceRect extends Rect {
  part: Part;
  layer: Layer;
  face: Face;
}

export interface Hit extends FaceRect {
  fx: number;
  fy: number;
}

const ORIGINS: Record<Part, Record<Layer, [number, number]>> = {
  head: { base: [0, 0], overlay: [32, 0] },
  body: { base: [16, 16], overlay: [16, 32] },
  rightArm: { base: [40, 16], overlay: [40, 32] },
  leftArm: { base: [32, 48], overlay: [48, 48] },
  rightLeg: { base: [0, 16], overlay: [0, 32] },
  leftLeg: { base: [16, 48], overlay: [0, 48] },
};

function dims(part: Part, variant: SkinVariant): [number, number, number] {
  if (part === "head") return [8, 8, 8];
  if (part === "body") return [8, 12, 4];
  if (part === "rightArm" || part === "leftArm") return [variant === "slim" ? 3 : 4, 12, 4];
  return [4, 12, 4];
}

export function faceRects(part: Part, layer: Layer, variant: SkinVariant): FaceRect[] {
  const [u, v] = ORIGINS[part][layer];
  const [w, h, d] = dims(part, variant);
  const r = (face: Face, x: number, y: number, fw: number, fh: number): FaceRect => ({ part, layer, face, x, y, w: fw, h: fh });
  return [
    r("top", u + d, v, w, d),
    r("bottom", u + d + w, v, w, d),
    r("right", u, v + d, d, h),
    r("front", u + d, v + d, w, h),
    r("left", u + d + w, v + d, d, h),
    r("back", u + 2 * d + w, v + d, w, h),
  ];
}

export function partBounds(part: Part, layer: Layer, variant: SkinVariant): Rect {
  const [u, v] = ORIGINS[part][layer];
  const [w, h, d] = dims(part, variant);
  return { x: u, y: v, w: 2 * (w + d), h: d + h };
}

export function unionRect(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const tables = new Map<SkinVariant, (FaceRect | null)[]>();

function table(variant: SkinVariant): (FaceRect | null)[] {
  let t = tables.get(variant);
  if (t) return t;
  t = new Array<FaceRect | null>(SIZE * SIZE).fill(null);
  for (const part of PARTS) {
    for (const layer of ["base", "overlay"] as const) {
      for (const f of faceRects(part, layer, variant)) {
        for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) t[y * SIZE + x] = f;
      }
    }
  }
  tables.set(variant, t);
  return t;
}

export function hitAt(x: number, y: number, variant: SkinVariant): Hit | null {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return null;
  const f = table(variant)[y * SIZE + x];
  return f ? { ...f, fx: x - f.x, fy: y - f.y } : null;
}

const MIRROR_PART: Record<Part, Part> = {
  head: "head",
  body: "body",
  rightArm: "leftArm",
  leftArm: "rightArm",
  rightLeg: "leftLeg",
  leftLeg: "rightLeg",
};

const MIRROR_FACE: Record<Face, Face> = { top: "top", bottom: "bottom", right: "left", left: "right", front: "front", back: "back" };

export function mirrorPart(part: Part): Part {
  return MIRROR_PART[part];
}

export function mirrorPoint(x: number, y: number, variant: SkinVariant): [number, number] | null {
  const hit = hitAt(x, y, variant);
  if (!hit) return null;
  const target = faceRects(MIRROR_PART[hit.part], hit.layer, variant).find((f) => f.face === MIRROR_FACE[hit.face]);
  if (!target) return null;
  return [target.x + (target.w - 1 - hit.fx), target.y + hit.fy];
}
