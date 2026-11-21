export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Side = "right" | "left" | "bottom" | "top" | "over";

export interface Placement {
  side: Side;
  left: number;
  top: number;
  arrow: number | null;
}

const GAP = 14;
const MARGIN = 12;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export function clipBox(r: Box, frame: { width: number; height: number }): Box {
  const left = clamp(r.left, 0, frame.width);
  const top = clamp(r.top, 0, frame.height);
  const right = clamp(r.left + r.width, 0, frame.width);
  const bottom = clamp(r.top + r.height, 0, frame.height);
  return { left, top, width: right - left, height: bottom - top };
}

export function place(r: Box | null, frame: { width: number; height: number }, b: { w: number; h: number }): Placement {
  const centered = { side: "over" as const, left: (frame.width - b.w) / 2, top: clamp((frame.height - b.h) / 2, MARGIN, frame.height - b.h - MARGIN), arrow: null };
  if (!r) return centered;
  const right = r.left + r.width;
  const bottom = r.top + r.height;
  const fitsX = b.w + GAP + MARGIN;
  const fitsY = b.h + GAP + MARGIN;
  const midY = clamp(r.top + r.height / 2 - b.h / 2, MARGIN, frame.height - b.h - MARGIN);
  const midX = clamp(r.left + r.width / 2 - b.w / 2, MARGIN, frame.width - b.w - MARGIN);
  const arrowY = (top: number) => clamp(r.top + r.height / 2 - top - 6, 14, b.h - 26);
  const arrowX = (left: number) => clamp(r.left + r.width / 2 - left - 6, 14, b.w - 26);
  if (right < 280 && frame.width - right > fitsX) return { side: "right", left: right + GAP, top: midY, arrow: arrowY(midY) };
  if (frame.height - bottom > fitsY) return { side: "bottom", left: midX, top: bottom + GAP, arrow: arrowX(midX) };
  if (r.top > fitsY) return { side: "top", left: midX, top: r.top - GAP - b.h, arrow: arrowX(midX) };
  if (frame.width - right > fitsX) return { side: "right", left: right + GAP, top: midY, arrow: arrowY(midY) };
  if (r.left > fitsX) return { side: "left", left: r.left - GAP - b.w, top: midY, arrow: arrowY(midY) };
  return { ...centered, top: clamp(bottom - b.h - MARGIN * 2, MARGIN, frame.height - b.h - MARGIN), left: clamp(right - b.w - MARGIN * 2, MARGIN, frame.width - b.w - MARGIN) };
}
