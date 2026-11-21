import { useEffect, useRef, useState } from "react";
import { faceRects, hitAt, PARTS, SIZE, type Hit } from "./layout";
import type { SkinEditor } from "./useSkinEditor";

interface Geometry {
  scale: number;
  ox: number;
  oy: number;
}

const CHECK_A = "#3a3a42";
const CHECK_B = "#2c2c33";

export function EditorCanvas({ ed, onHover }: { ed: SkinEditor; onHover: (h: Hit | null) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tex = useRef<HTMLCanvasElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<[number, number] | null>(null);
  const drawing = useRef(false);
  const geo = useRef<Geometry>({ scale: 1, ox: 0, oy: 0 });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || box.w === 0 || box.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(box.w * dpr);
    cv.height = Math.round(box.h * dpr);
    cv.style.width = `${box.w}px`;
    cv.style.height = `${box.h}px`;
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, box.w, box.h);

    const v = ed.view;
    const scale = Math.max(1, Math.floor(Math.min((box.w - 16) / v.w, (box.h - 16) / v.h)));
    const ox = Math.floor((box.w - v.w * scale) / 2);
    const oy = Math.floor((box.h - v.h * scale) / 2);
    geo.current = { scale, ox, oy };
    const sx = (x: number) => ox + (x - v.x) * scale;
    const sy = (y: number) => oy + (y - v.y) * scale;

    if (!tex.current) {
      tex.current = document.createElement("canvas");
      tex.current.width = SIZE;
      tex.current.height = SIZE;
    }
    tex.current.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(ed.px.current), SIZE, SIZE), 0, 0);

    const faces = PARTS.flatMap((p) => [...faceRects(p, "base", ed.variant), ...faceRects(p, "overlay", ed.variant)]);
    const inView = faces.filter((f) => f.x < v.x + v.w && f.x + f.w > v.x && f.y < v.y + v.h && f.y + f.h > v.y);

    for (const f of inView) {
      for (let y = f.y; y < f.y + f.h; y++) {
        for (let x = f.x; x < f.x + f.w; x++) {
          g.fillStyle = (x + y) % 2 ? CHECK_A : CHECK_B;
          g.fillRect(sx(x), sy(y), scale, scale);
        }
      }
    }
    g.save();
    g.beginPath();
    for (const f of inView) g.rect(sx(f.x), sy(f.y), f.w * scale, f.h * scale);
    g.clip();
    if (ed.layer === "overlay") {
      g.globalAlpha = 0.3;
      for (const f of inView) {
        if (f.layer !== "overlay") continue;
        const b = faceRects(f.part, "base", ed.variant).find((r) => r.face === f.face)!;
        g.drawImage(tex.current, b.x, b.y, b.w, b.h, sx(f.x), sy(f.y), f.w * scale, f.h * scale);
      }
      g.globalAlpha = 1;
    }
    g.drawImage(tex.current, v.x, v.y, v.w, v.h, ox, oy, v.w * scale, v.h * scale);
    g.restore();

    for (const f of inView) {
      const active = f.layer === ed.layer && (ed.focus === "all" || f.part === ed.focus);
      if (!active) {
        g.fillStyle = "rgba(10,10,14,0.62)";
        g.fillRect(sx(f.x), sy(f.y), f.w * scale, f.h * scale);
      } else if (ed.grid && scale >= 8) {
        g.strokeStyle = "rgba(255,255,255,0.09)";
        g.lineWidth = 1;
        g.beginPath();
        for (let x = f.x + 1; x < f.x + f.w; x++) {
          g.moveTo(sx(x) + 0.5, sy(f.y));
          g.lineTo(sx(x) + 0.5, sy(f.y + f.h));
        }
        for (let y = f.y + 1; y < f.y + f.h; y++) {
          g.moveTo(sx(f.x), sy(y) + 0.5);
          g.lineTo(sx(f.x + f.w), sy(y) + 0.5);
        }
        g.stroke();
      }
      g.strokeStyle = active ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.12)";
      g.lineWidth = 1;
      g.strokeRect(sx(f.x) + 0.5, sy(f.y) + 0.5, f.w * scale - 1, f.h * scale - 1);
    }

    if (hover && (ed.tool === "brush" || ed.tool === "eraser")) {
      const off = Math.floor((ed.size - 1) / 2);
      g.strokeStyle = "#ffffff";
      g.lineWidth = 2;
      g.strokeRect(sx(hover[0] - off) + 1, sy(hover[1] - off) + 1, ed.size * scale - 2, ed.size * scale - 2);
      g.strokeStyle = "rgba(0,0,0,0.7)";
      g.lineWidth = 1;
      g.strokeRect(sx(hover[0] - off) - 0.5, sy(hover[1] - off) - 0.5, ed.size * scale + 1, ed.size * scale + 1);
    } else if (hover) {
      g.strokeStyle = "#ffffff";
      g.lineWidth = 2;
      g.strokeRect(sx(hover[0]) + 1, sy(hover[1]) + 1, scale - 2, scale - 2);
    }
  }, [box, ed.version, ed.view, ed.variant, ed.layer, ed.focus, ed.grid, ed.size, ed.tool, hover, ed.px]);

  const toTex = (e: React.PointerEvent): [number, number] | null => {
    const cv = canvas.current;
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    const { scale, ox, oy } = geo.current;
    const x = ed.view.x + Math.floor((e.clientX - r.left - ox) / scale);
    const y = ed.view.y + Math.floor((e.clientY - r.top - oy) / scale);
    if (x < ed.view.x || y < ed.view.y || x >= ed.view.x + ed.view.w || y >= ed.view.y + ed.view.h) return null;
    return [x, y];
  };

  const onDown = (e: React.PointerEvent) => {
    const p = toTex(e);
    if (!p) return;
    e.preventDefault();
    const picking = ed.tool === "picker" || e.altKey;
    if (picking) return void ed.pick(p[0], p[1]);
    if (ed.tool === "fill" && e.button === 0) return ed.fill(p[0], p[1]);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drawing.current = true;
    ed.begin(p[0], p[1], e.button === 2);
  };

  const onMove = (e: React.PointerEvent) => {
    const p = toTex(e);
    setHover(p);
    onHover(p ? hitAt(p[0], p[1], ed.variant) : null);
    if (drawing.current && p) ed.move(p[0], p[1]);
  };

  const onUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    ed.end();
  };

  return (
    <div ref={host} className="absolute inset-0">
      <canvas
        ref={canvas}
        className="block touch-none"
        style={{ cursor: ed.tool === "picker" ? "copy" : "crosshair" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => {
          setHover(null);
          onHover(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
