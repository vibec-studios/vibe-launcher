import { useCallback, useMemo, useRef, useState } from "react";
import type { SkinVariant } from "@/lib/types";
import { History } from "./history";
import { hitAt, mirrorPoint, PARTS, partBounds, unionRect, type Layer, type Part, type Rect } from "./layout";
import { clearLayer, copyPartMirrored, emptyPixels, floodFill, getPx, hexToRgba, linePoints, rgbaToHex, setPx, type Pixels, type Rgba } from "./pixels";

export type Tool = "brush" | "eraser" | "picker" | "fill";
export type Focus = Part | "all";

const RECENT_MAX = 6;

export function useSkinEditor() {
  const px = useRef<Pixels>(emptyPixels());
  const history = useRef(new History());
  const last = useRef<[number, number] | null>(null);
  const changed = useRef(false);
  const erasing = useRef(false);
  const [version, setVersion] = useState(0);
  const [variant, setVariant] = useState<SkinVariant>("classic");
  const [tool, setTool] = useState<Tool>("brush");
  const [color, setColorRaw] = useState("#d9a77f");
  const [recent, setRecent] = useState<string[]>([]);
  const [size, setSize] = useState(1);
  const [mirror, setMirror] = useState(false);
  const [layer, setLayer] = useState<Layer>("base");
  const [focus, setFocus] = useState<Focus>("all");
  const [showOverlay, setShowOverlay] = useState(true);
  const [grid, setGrid] = useState(true);
  const [dirty, setDirty] = useState(false);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const editable = useCallback(
    (x: number, y: number) => {
      const hit = hitAt(x, y, variant);
      return !!hit && hit.layer === layer && (focus === "all" || hit.part === focus);
    },
    [variant, layer, focus],
  );

  const view: Rect = useMemo(() => {
    if (focus === "all") return { x: 0, y: 0, w: 64, h: 64 };
    return unionRect([partBounds(focus, layer, variant)]);
  }, [focus, layer, variant]);

  const setColor = useCallback((hex: string) => {
    setColorRaw(hex);
    setTool((t) => (t === "eraser" || t === "picker" ? "brush" : t));
  }, []);

  const remember = useCallback((hex: string) => {
    setRecent((r) => [hex, ...r.filter((c) => c !== hex)].slice(0, RECENT_MAX));
  }, []);

  const load = useCallback(
    (pixels: Pixels, v: SkinVariant) => {
      px.current = pixels;
      history.current.clear();
      setVariant(v);
      setDirty(false);
      bump();
    },
    [bump],
  );

  const paintAt = useCallback(
    (x: number, y: number, c: Rgba) => {
      const off = Math.floor((size - 1) / 2);
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          const tx = x - off + dx;
          const ty = y - off + dy;
          if (!editable(tx, ty)) continue;
          setPx(px.current, tx, ty, c);
          changed.current = true;
          if (mirror) {
            const m = mirrorPoint(tx, ty, variant);
            if (m && editable(m[0], m[1])) setPx(px.current, m[0], m[1], c);
          }
        }
      }
    },
    [size, editable, mirror, variant],
  );

  const strokeColor = (): Rgba => (erasing.current ? [0, 0, 0, 0] : hexToRgba(color));

  const begin = (x: number, y: number, erase = false) => {
    erasing.current = erase || tool === "eraser";
    history.current.push(px.current);
    changed.current = false;
    last.current = [x, y];
    paintAt(x, y, strokeColor());
    bump();
  };

  const move = (x: number, y: number) => {
    const from = last.current;
    if (!from || (from[0] === x && from[1] === y)) return;
    const c = strokeColor();
    for (const [lx, ly] of linePoints(from[0], from[1], x, y)) paintAt(lx, ly, c);
    last.current = [x, y];
    bump();
  };

  const end = () => {
    if (!last.current) return;
    last.current = null;
    if (!changed.current) history.current.dropLast();
    else {
      setDirty(true);
      if (!erasing.current) remember(color);
    }
    bump();
  };

  const pick = (x: number, y: number): boolean => {
    const c = getPx(px.current, x, y);
    if (c[3] === 0) return false;
    const hex = rgbaToHex(c);
    setColorRaw(hex);
    remember(hex);
    setTool("brush");
    return true;
  };

  const fill = (x: number, y: number) => {
    const hit = hitAt(x, y, variant);
    if (!hit || !editable(x, y)) return;
    const c = hexToRgba(color);
    history.current.push(px.current);
    const n = floodFill(px.current, x, y, c, hit, editable);
    if (mirror) {
      const m = mirrorPoint(x, y, variant);
      const mh = m && hitAt(m[0], m[1], variant);
      if (m && mh && editable(m[0], m[1])) floodFill(px.current, m[0], m[1], c, mh, editable);
    }
    if (n === 0) history.current.dropLast();
    else {
      setDirty(true);
      remember(color);
    }
    bump();
  };

  const mutate = (f: (p: Pixels) => void) => {
    history.current.push(px.current);
    f(px.current);
    setDirty(true);
    bump();
  };

  const mirrorSides = (from: "right" | "left") =>
    mutate((p) => {
      for (const part of from === "right" ? (["rightArm", "rightLeg"] as const) : (["leftArm", "leftLeg"] as const)) copyPartMirrored(p, part, layer, variant);
    });

  const clearCurrentLayer = () => mutate((p) => clearLayer(p, focus === "all" ? PARTS : [focus], layer, variant));

  const undo = () => {
    const prev = history.current.undo(px.current);
    if (!prev) return;
    px.current = prev;
    setDirty(true);
    bump();
  };

  const redo = () => {
    const next = history.current.redo(px.current);
    if (!next) return;
    px.current = next;
    setDirty(true);
    bump();
  };

  const changeVariant = (v: SkinVariant) => {
    if (v === variant) return;
    setVariant(v);
    setDirty(true);
  };

  return {
    px,
    version,
    variant,
    changeVariant,
    tool,
    setTool,
    color,
    setColor,
    recent,
    size,
    setSize,
    mirror,
    setMirror,
    layer,
    setLayer,
    focus,
    setFocus,
    showOverlay,
    setShowOverlay,
    grid,
    setGrid,
    dirty,
    setDirty,
    view,
    editable,
    load,
    begin,
    move,
    end,
    pick,
    fill,
    undo,
    redo,
    canUndo: history.current.canUndo,
    canRedo: history.current.canRedo,
    mirrorSides,
    clearCurrentLayer,
  };
}

export type SkinEditor = ReturnType<typeof useSkinEditor>;
