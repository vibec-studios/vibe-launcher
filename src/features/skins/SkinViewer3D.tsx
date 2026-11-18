// OWNER: Auth-Agent. 3D-Skin-Viewer (skinview3d, MIT). Wird per React.lazy geladen – three.js landet
// so nicht im Haupt-Bundle. MinecraftCapes-Extras (animiertes Cape, Glanz, kopfüber, Ohren) wie in der Mod.
import { useEffect, useRef } from "react";
import { IdleAnimation, SkinViewer, WalkingAnimation } from "skinview3d";
import type { SkinVariant } from "@/lib/types";
import type { McCapeFrames } from "./minecraftcapes";

export type ViewerAnimation = "idle" | "walk";

export interface SkinViewer3DProps {
  skin: string | null;
  variant: SkinVariant;
  cape: string | null;
  animation: ViewerAnimation;
  /** Langsames Drehen, solange der Nutzer nicht selbst dreht */
  autoRotate?: boolean;
  /** MinecraftCapes-Cape (ersetzt `cape`, wie im Spiel mit der Mod) */
  mcCape?: McCapeFrames | null;
  /** Verzauberungs-Glanz auf dem Cape */
  glint?: boolean;
  /** Ohren-Textur (14×7, Deadmau5-Layout) */
  ears?: string | null;
  /** Spieler kopfüber („Dinnerbone“) */
  upsideDown?: boolean;
}

// three.js-Konstanten (gleiche Werte in allen Versionen; skinview3d bringt seine eigene three-Version mit,
// darum werden keine three-Klassen importiert, sondern die vorhandenen Objekte geklont)
const REPEAT_WRAPPING = 1000;
const ADDITIVE_BLENDING = 2;
/** Tiefe der MinecraftCapes-Ohren (1 + 2·0,2) im Verhältnis zu skinview3d (4/3) */
const EAR_DEPTH_SCALE = 1.4 / (4 / 3);

/** Kachelbare Glanz-Textur: weiche diagonale Streifen (Graustufen, wird violett eingefärbt). */
function glintCanvas(): HTMLCanvasElement {
  const n = 64;
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const g = c.getContext("2d")!;
  const img = g.createImageData(n, n);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const stripes = Array.from({ length: 7 }, () => ({ off: rnd() * n, w: 1.5 + rnd() * 5, a: 0.25 + rnd() * 0.55 }));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // (x + y) mod n ist in beiden Richtungen periodisch -> nahtlos kachelbar
      const d = (x + y) % n;
      let v = 0;
      for (const s of stripes) {
        const dist = Math.min(Math.abs(d - s.off), n - Math.abs(d - s.off));
        v += s.a * Math.exp(-(dist * dist) / (2 * s.w * s.w));
      }
      const b = Math.min(255, Math.round(v * 255));
      const i = (y * n + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

type CapeMesh = SkinViewer["playerObject"]["cape"]["cape"];
type Tex = NonNullable<SkinViewer["playerObject"]["cape"]["map"]>;

/** Glanz-Schicht über dem Cape: Klon des Cape-Meshes, additiv, nur auf deckenden Pixeln. */
class GlintLayer {
  private mesh: CapeMesh;
  private tex: Tex | null = null;
  private raf = 0;
  constructor(private cape: CapeMesh) {
    this.mesh = cape.clone();
    const mat = (Array.isArray(cape.material) ? cape.material[0] : cape.material).clone() as CapeMesh["material"] & {
      color: { setRGB: (r: number, g: number, b: number) => void };
      emissive: { setRGB: (r: number, g: number, b: number) => void };
      emissiveMap: Tex | null;
      map: Tex | null;
      alphaTest: number;
      depthWrite: boolean;
      blending: number;
      transparent: boolean;
      polygonOffset: boolean;
      polygonOffsetFactor: number;
      polygonOffsetUnits: number;
      roughness: number;
      metalness: number;
      needsUpdate: boolean;
    };
    mat.color.setRGB(0, 0, 0);
    mat.emissive.setRGB(0.62, 0.32, 1);
    mat.roughness = 1;
    mat.metalness = 0;
    mat.alphaTest = 0.1;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = ADDITIVE_BLENDING;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;
    this.mesh.material = mat;
    this.mesh.position.set(0, 0, 0);
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    cape.add(this.mesh);
  }

  private get mat() {
    return this.mesh.material as unknown as { map: Tex | null; emissiveMap: Tex | null; needsUpdate: boolean; dispose: () => void };
  }

  /** Mit der aktuellen Cape-Textur verbinden (nach jedem `loadCape`). */
  set(capeMap: Tex | null, on: boolean) {
    const show = on && !!capeMap;
    if (show && !this.tex) {
      const Ctor = capeMap!.constructor as new (c: HTMLCanvasElement) => Tex;
      const t = new Ctor(glintCanvas());
      t.wrapS = REPEAT_WRAPPING;
      t.wrapT = REPEAT_WRAPPING;
      t.repeat.set(5, 2.5);
      t.center.set(0.5, 0.5);
      t.rotation = Math.PI / 18;
      this.tex = t;
    }
    const m = this.mat;
    if (m.map !== capeMap || m.emissiveMap !== this.tex) {
      m.map = capeMap;
      m.emissiveMap = this.tex;
      m.needsUpdate = true;
    }
    this.mesh.visible = show;
    if (show && !this.raf) {
      const t0 = performance.now();
      const tick = (now: number) => {
        const s = (now - t0) / 1000;
        if (this.tex) this.tex.offset.set((s * 0.16) % 1, (s * 0.07) % 1);
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    } else if (!show && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.cape.remove(this.mesh);
    this.mat.dispose();
    this.tex?.dispose();
  }
}

export default function SkinViewer3D({
  skin,
  variant,
  cape,
  animation,
  autoRotate = false,
  mcCape = null,
  glint = false,
  ears = null,
  upsideDown = false,
}: SkinViewer3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<SkinViewer | null>(null);
  const glintLayer = useRef<GlintLayer | null>(null);

  // Viewer einmal anlegen, Größe an den Container koppeln
  useEffect(() => {
    const el = host.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const v = new SkinViewer({
      canvas: cv,
      width: Math.max(1, el.clientWidth),
      height: Math.max(1, el.clientHeight),
      pixelRatio: "match-device",
      fov: 40,
      zoom: 0.85,
      enableControls: true,
    });
    v.controls.enablePan = false;
    v.controls.minDistance = 25;
    v.controls.maxDistance = 120;
    v.globalLight.intensity = 3;
    v.cameraLight.intensity = 0.6;
    // Leicht schräge Startansicht (Richtung setzen, Abstand berechnet der Zoom-Setter)
    v.camera.position.set(Math.sin(0.55), 0.18, Math.cos(0.55));
    v.zoom = 0.85;
    v.controls.update();
    v.playerObject.ears.leftEar.scale.z = EAR_DEPTH_SCALE;
    v.playerObject.ears.rightEar.scale.z = EAR_DEPTH_SCALE;
    viewer.current = v;
    glintLayer.current = new GlintLayer(v.playerObject.cape.cape);
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) v.setSize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      glintLayer.current?.dispose();
      glintLayer.current = null;
      v.dispose();
      viewer.current = null;
    };
  }, []);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (skin) void v.loadSkin(skin, { model: variant === "slim" ? "slim" : "default" }).catch(() => {});
    else v.loadSkin(null);
  }, [skin, variant]);

  // Cape: MinecraftCapes (ggf. animiert) hat Vorrang vor dem Mojang-Cape
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    let dead = false;
    let timer = 0;
    const sync = () => glintLayer.current?.set(v.playerObject.cape.map, glint && !!mcCape);
    if (mcCape && mcCape.frames.length) {
      v.loadCape(mcCape.frames[0]);
      sync();
      if (mcCape.frames.length > 1) {
        let i = 0;
        timer = window.setInterval(() => {
          i = (i + 1) % mcCape.frames.length;
          const g = v.capeCanvas.getContext("2d");
          const map = v.playerObject.cape.map;
          if (!g || !map) return;
          g.clearRect(0, 0, v.capeCanvas.width, v.capeCanvas.height);
          g.drawImage(mcCape.frames[i], 0, 0);
          map.needsUpdate = true;
        }, mcCape.frameMs);
      }
    } else if (cape) {
      void v
        .loadCape(cape)
        .then(() => !dead && sync())
        .catch(() => {});
      sync();
    } else {
      v.loadCape(null);
      sync();
    }
    return () => {
      dead = true;
      if (timer) window.clearInterval(timer);
    };
  }, [cape, mcCape, glint]);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (ears) void v.loadEars(ears, { textureType: "standalone" }).catch(() => {});
    else v.loadEars(null);
  }, [ears]);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    v.playerObject.rotation.z = upsideDown ? Math.PI : 0;
  }, [upsideDown]);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const a = animation === "walk" ? new WalkingAnimation() : new IdleAnimation();
    a.speed = animation === "walk" ? 0.7 : 1;
    v.animation = a;
  }, [animation]);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    v.autoRotate = autoRotate;
    v.autoRotateSpeed = 0.6;
  }, [autoRotate]);

  return (
    <div ref={host} className="absolute inset-0 cursor-grab active:cursor-grabbing">
      <canvas ref={canvas} className="block" />
    </div>
  );
}
