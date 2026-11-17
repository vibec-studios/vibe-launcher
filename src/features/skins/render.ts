// OWNER: Auth-Agent. 2D-Vorschauen aus Skin-/Cape-Texturen (Canvas, pixelgenau, mit Cache).
import { useEffect, useState } from "react";
import type { SkinVariant } from "@/lib/types";

const cache = new Map<string, Promise<string>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild nicht ladbar"));
    img.src = src;
  });
}

type Rect = [number, number, number, number];

/** Ist die Hut-Schicht (32,0 – 64,16) vollständig deckend? */
function hatOpaque(img: HTMLImageElement): boolean {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 16;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 32, 0, 32, 16, 0, 0, 32, 16);
  const d = g.getImageData(0, 0, 32, 16).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 128) return false;
  return true;
}

/** Vorderansicht des ganzen Körpers (16×32 Skin-Pixel, mit Overlay-Schichten). */
async function renderFront(src: string, variant: SkinVariant, scale: number): Promise<string> {
  const img = await loadImage(src);
  const legacy = img.height === 32;
  const arm = variant === "slim" ? 3 : 4;
  const c = document.createElement("canvas");
  c.width = 16 * scale;
  c.height = 32 * scale;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  const draw = ([sx, sy, w, h]: Rect, dx: number, dy: number, mirror = false) => {
    if (mirror) {
      g.save();
      g.translate((dx + w) * scale, dy * scale);
      g.scale(-1, 1);
      g.drawImage(img, sx, sy, w, h, 0, 0, w * scale, h * scale);
      g.restore();
    } else {
      g.drawImage(img, sx, sy, w, h, dx * scale, dy * scale, w * scale, h * scale);
    }
  };
  const ax = variant === "slim" ? 1 : 0;
  // Grundschicht
  draw([8, 8, 8, 8], 4, 0); // Kopf
  draw([20, 20, 8, 12], 4, 8); // Körper
  draw([44, 20, arm, 12], ax, 8); // rechter Arm (links im Bild)
  draw([4, 20, 4, 12], 4, 20); // rechtes Bein
  if (legacy) {
    draw([44, 20, arm, 12], 12, 8, true);
    draw([4, 20, 4, 12], 8, 20, true);
  } else {
    draw([36, 52, arm, 12], 12, 8);
    draw([20, 52, 4, 12], 8, 20);
  }
  // Overlays. Alte 64×32-Skins mit komplett deckender Hut-Schicht: wie Vanilla ignorieren ("Notch-Hack").
  if (!legacy || !hatOpaque(img)) draw([40, 8, 8, 8], 4, 0);
  if (!legacy) {
    draw([20, 36, 8, 12], 4, 8);
    draw([44, 36, arm, 12], ax, 8);
    draw([52, 52, arm, 12], 12, 8);
    draw([4, 36, 4, 12], 4, 20);
    draw([4, 52, 4, 12], 8, 20);
  }
  return c.toDataURL("image/png");
}

/** Cape-Vorderseite (10×16 aus der 64×32-Textur). */
async function renderCape(src: string, scale: number): Promise<string> {
  const img = await loadImage(src);
  // Manche Capes sind hochauflösend (Vielfache von 64×32)
  const f = Math.max(1, Math.round(img.width / 64));
  const c = document.createElement("canvas");
  c.width = 10 * scale;
  c.height = 16 * scale;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 1 * f, 1 * f, 10 * f, 16 * f, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

function cached(key: string, make: () => Promise<string>): Promise<string> {
  let p = cache.get(key);
  if (!p) {
    p = make();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    if (cache.size > 400) cache.delete(cache.keys().next().value!);
  }
  return p;
}

function useRendered(key: string | null, make: () => Promise<string>): string | null {
  const [out, setOut] = useState<string | null>(null);
  useEffect(() => {
    if (!key) {
      setOut(null);
      return;
    }
    let dead = false;
    cached(key, make).then(
      (v) => !dead && setOut(v),
      () => !dead && setOut(null),
    );
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return out;
}

export function useSkinFront(src: string | null | undefined, variant: SkinVariant, scale = 6) {
  return useRendered(src ? `f|${variant}|${scale}|${src}` : null, () => renderFront(src!, variant, scale));
}

export function useCapeFront(src: string | null | undefined, scale = 4) {
  return useRendered(src ? `c|${scale}|${src}` : null, () => renderCape(src!, scale));
}
