// Kopf (Gesicht + Hut-Schicht) und Ganzkörper-Vorderansicht aus fremden Skin-Texturen (https, CORS), pixelgenau
// auf Canvas, mit Cache. Wie Vanilla: Bei alten 64×32-Skins mit komplett deckender Hut-Schicht wird diese ignoriert.
import { useEffect, useState } from "react";

const images = new Map<string, Promise<HTMLImageElement>>();
const out = new Map<string, Promise<string>>();

function load(src: string): Promise<HTMLImageElement> {
  let p = images.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Skin nicht ladbar"));
      img.src = src;
    });
    p.catch(() => images.delete(src));
    images.set(src, p);
  }
  return p;
}

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

function memo(key: string, make: () => Promise<string>) {
  let p = out.get(key);
  if (!p) {
    p = make();
    p.catch(() => out.delete(key));
    out.set(key, p);
    if (out.size > 300) out.delete(out.keys().next().value!);
  }
  return p;
}

/** 8×8-Gesicht (+ Hut) als PNG-Daten-URL, Anzeige per CSS pixelgenau skaliert. */
export function renderFace(src: string): Promise<string> {
  return memo(`face|${src}`, async () => {
    const img = await load(src);
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    const g = c.getContext("2d")!;
    g.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8);
    if (img.height !== 32 || !hatOpaque(img)) g.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
    return c.toDataURL("image/png");
  });
}

/** Ganzkörper-Vorderansicht 16×32 (mit Overlays). */
export function renderBody(src: string, slim: boolean): Promise<string> {
  return memo(`body|${slim ? 1 : 0}|${src}`, async () => {
    const img = await load(src);
    const legacy = img.height === 32;
    const arm = slim ? 3 : 4;
    const ax = slim ? 1 : 0;
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 32;
    const g = c.getContext("2d")!;
    const d = (sx: number, sy: number, w: number, h: number, dx: number, dy: number, mirror = false) => {
      if (!mirror) return g.drawImage(img, sx, sy, w, h, dx, dy, w, h);
      g.save();
      g.translate(dx + w, dy);
      g.scale(-1, 1);
      g.drawImage(img, sx, sy, w, h, 0, 0, w, h);
      g.restore();
    };
    d(8, 8, 8, 8, 4, 0);
    d(20, 20, 8, 12, 4, 8);
    d(44, 20, arm, 12, ax, 8);
    d(4, 20, 4, 12, 4, 20);
    if (legacy) {
      d(44, 20, arm, 12, 12, 8, true);
      d(4, 20, 4, 12, 8, 20, true);
    } else {
      d(36, 52, arm, 12, 12, 8);
      d(20, 52, 4, 12, 8, 20);
    }
    if (!legacy || !hatOpaque(img)) d(40, 8, 8, 8, 4, 0);
    if (!legacy) {
      d(20, 36, 8, 12, 4, 8);
      d(44, 36, arm, 12, ax, 8);
      d(52, 52, arm, 12, 12, 8);
      d(4, 36, 4, 12, 4, 20);
      d(4, 52, 4, 12, 8, 20);
    }
    return c.toDataURL("image/png");
  });
}

/** Ergebnis einer Render-Funktion als State (null = lädt / fehlgeschlagen; `failed` getrennt). */
export function useRender(key: string | null, make: () => Promise<string>): { url: string | null; failed: boolean } {
  const [s, set] = useState<{ key: string | null; url: string | null; failed: boolean }>({ key: null, url: null, failed: false });
  useEffect(() => {
    if (!key) return;
    let dead = false;
    make().then(
      (url) => !dead && set({ key, url, failed: false }),
      () => !dead && set({ key, url: null, failed: true }),
    );
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return s.key === key ? s : { url: null, failed: false };
}
