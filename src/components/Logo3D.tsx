// OWNER: Frontend-Agent A. Das Website-Logo (isometrischer Pixel-Block) als echtes 3D-Objekt mit three.js.
// Pixel-Texturen werden auf Canvas erzeugt (NearestFilter). Bis zum ersten Frame steht das statische SVG da,
// damit nichts flackert. Rendern pausiert, wenn das Logo nicht sichtbar ist oder das Fenster im Hintergrund liegt.
import { useEffect, useRef, useState } from "react";
import type * as THREE_NS from "three";
import { cn } from "@/components/ui";
import { useSettings } from "@/lib/queries";

type Px = [number, number];

// 16×16-Texturen in den Logo-Farben
const TOP = {
  base: "#b86cff",
  rim: "#d39bff",
  light: "#f1e2ff",
  pixels: [
    [7, 4],
    [4, 8],
    [10, 8],
  ] as Px[],
};
// Seiten in der hellen Logo-Farbe; die Schattierung (links dunkler) kommt aus dem Licht.
const LEFT = {
  base: "#3fe0c5",
  spot: "#1f9d8a",
  pixels: [
    [3, 3],
    [10, 6],
    [4, 10],
    [11, 12],
  ] as Px[],
};
const RIGHT = {
  base: "#3fe0c5",
  spot: "#8ff5e3",
  pixels: [
    [11, 3],
    [4, 6],
    [10, 10],
    [3, 12],
  ] as Px[],
};

function makeCanvas(draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 16;
  const g = c.getContext("2d")!;
  draw(g);
  return c;
}

function pixels(g: CanvasRenderingContext2D, color: string, list: Px[], size = 2) {
  g.fillStyle = color;
  for (const [x, y] of list) g.fillRect(x, y, size, size);
}

/** Kantenschatten: dunkler Rand, nach innen auslaufend. */
function edgeShade(g: CanvasRenderingContext2D, strength: number) {
  g.fillStyle = `rgba(0,0,0,${strength})`;
  g.fillRect(0, 0, 16, 1);
  g.fillRect(0, 15, 16, 1);
  g.fillRect(0, 1, 1, 14);
  g.fillRect(15, 1, 1, 14);
  g.fillStyle = `rgba(0,0,0,${strength * 0.35})`;
  g.fillRect(1, 1, 14, 1);
  g.fillRect(1, 14, 14, 1);
  g.fillRect(1, 2, 1, 12);
  g.fillRect(14, 2, 1, 12);
}

const topCanvas = () =>
  makeCanvas((g) => {
    g.fillStyle = TOP.rim;
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = TOP.base;
    g.fillRect(2, 2, 12, 12);
    pixels(g, TOP.light, TOP.pixels);
    edgeShade(g, 0.14);
  });

const sideCanvas = (s: typeof LEFT | typeof RIGHT) =>
  makeCanvas((g) => {
    g.fillStyle = s.base;
    g.fillRect(0, 0, 16, 16);
    pixels(g, s.spot, s.pixels);
    // Oberkante etwas heller (Licht von oben), Unterkante dunkler
    g.fillStyle = "rgba(255,255,255,.10)";
    g.fillRect(0, 0, 16, 1);
    g.fillStyle = "rgba(0,0,0,.18)";
    g.fillRect(0, 14, 16, 2);
    edgeShade(g, 0.16);
  });

const shadowCanvas = () => {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(0,0,0,.75)");
  grd.addColorStop(0.55, "rgba(0,0,0,.35)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return c;
};

function prefersStatic(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reduceMotion === "true";
}

export interface Logo3DProps {
  size?: number;
  className?: string;
  /** Neigung zur Maus (Standard: an) */
  interactive?: boolean;
  /** Drehgeschwindigkeit im Ruhezustand in rad/s (0 = still in Logo-Pose) */
  speed?: number;
  /** Beim Hover (über dem Elternelement) schnell drehen, danach zurück in die Logo-Pose */
  hoverSpin?: boolean;
  /** Sanftes Schweben mit Bodenschatten */
  float?: boolean;
}

interface Opts {
  size: number;
  interactive: boolean;
  speed: number;
  hoverSpin: boolean;
  float: boolean;
}

export function Logo3D({ size = 160, className, interactive = true, speed = 0.42, hoverSpin = false, float = true }: Logo3DProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  // Neu aufsetzen, wenn „Animationen reduzieren“ umgeschaltet wird
  const reduce = useSettings().data?.reduce_motion ?? false;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    // Eigenes Canvas je Durchlauf: ein verlorener WebGL-Kontext lässt sich nicht wiederverwenden
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 h-full w-full opacity-0 transition-opacity duration-150";
    wrap.appendChild(canvas);

    import("three")
      .then((THREE) => {
        if (disposed) return;
        cleanup = setup(THREE, wrap, canvas, { size, interactive, speed, hoverSpin, float }, () => {
          if (disposed) return;
          canvas.style.opacity = "1";
          setReady(true);
        });
      })
      .catch(() => {});

    return () => {
      disposed = true;
      cleanup?.();
      canvas.remove();
      setReady(false);
    };
  }, [size, interactive, speed, hoverSpin, float, reduce]);

  return (
    <div ref={wrapRef} className={cn("relative shrink-0", className)} style={{ width: size, height: size }} aria-hidden>
      <img
        src="/logo.svg"
        alt=""
        draggable={false}
        className={cn("absolute inset-[19%] h-[62%] w-[62%] [image-rendering:pixelated] transition-opacity duration-150", ready && "opacity-0")}
      />
    </div>
  );
}

function setup(THREE: typeof THREE_NS, wrap: HTMLDivElement, canvas: HTMLCanvasElement, o: Opts, onFirstFrame: () => void): () => void {
  let renderer: THREE_NS.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    return () => {}; // Kein WebGL: das SVG bleibt einfach stehen
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(o.size, o.size, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
  // Fast isometrisch, wie im Logo (Ecke zeigt zur Kamera)
  camera.position.set(0, 2.7, 4.05);
  camera.lookAt(0, o.float ? -0.06 : 0, 0);
  if (!o.float) camera.zoom = 1.18;
  camera.updateProjectionMatrix();

  const tex = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const tTop = tex(topCanvas());
  const tLeft = tex(sideCanvas(LEFT));
  const tRight = tex(sideCanvas(RIGHT));
  const mat = (map: THREE_NS.Texture) => new THREE.MeshLambertMaterial({ map });
  const mTop = mat(tTop);
  const mLeft = mat(tLeft);
  const mRight = mat(tRight);
  const mBottom = new THREE.MeshLambertMaterial({ color: 0x1a5f55 });
  // BoxGeometry-Reihenfolge: +x, -x, +y, -y, +z, -z
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const cube = new THREE.Mesh(geo, [mRight, mLeft, mTop, mBottom, mLeft, mRight]);

  const pivot = new THREE.Group();
  pivot.add(cube);
  scene.add(pivot);

  // Weicher Bodenschatten (nur beim Schweben)
  const tShadow = new THREE.CanvasTexture(shadowCanvas());
  const shadowMat = new THREE.MeshBasicMaterial({ map: tShadow, transparent: true, depthWrite: false, opacity: 0.8 });
  const shadowGeo = new THREE.PlaneGeometry(1.9, 1.9);
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.92;
  shadow.visible = o.float;
  scene.add(shadow);

  // Licht so abgestimmt, dass in der Logo-Pose Deckfläche und rechte Seite volle Farbe haben und die linke
  // Seite etwa 72 % (wie #2fb8a3 zu #3fe0c5). Lambert: Helligkeit = (Umgebung + Key·N·L) / π.
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.52);
  key.position.set(0.62, 1.6, 1.84);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xb48cff, 0.7);
  rim.position.set(-3, 1.2, -2);
  scene.add(rim);

  const still = prefersStatic();
  const BASE_YAW = Math.PI / 4;
  const QUARTER = Math.PI / 2;
  const HOVER_SPEED = 4.2;
  let yaw = BASE_YAW;
  let vel = o.speed;
  let hovered = false;
  let settleTo: number | null = null;
  let t = 0;
  let tiltX = 0,
    tiltZ = 0,
    targetX = 0,
    targetZ = 0;
  let last = performance.now();
  let raf = 0;
  let visible = true;
  let firstDone = false;

  const draw = () => {
    const bob = still || !o.float ? 0 : Math.sin(t * 1.6) * 0.07;
    pivot.position.y = bob;
    pivot.rotation.set(tiltX, yaw, tiltZ);
    const s = 1 - bob * 0.9;
    shadow.scale.set(s, s, s);
    shadowMat.opacity = 0.75 - bob * 1.4;
    renderer.render(scene, camera);
    if (!firstDone) {
      firstDone = true;
      onFirstFrame();
    }
  };

  /** Läuft noch etwas? Sonst hält die Schleife an (kein Dauer-Rendern im Ruhezustand). */
  const active = () => o.float || o.speed > 0 || hovered || settleTo !== null || Math.abs(targetX - tiltX) > 1e-3 || Math.abs(targetZ - tiltZ) > 1e-3;

  const loop = (now: number) => {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    const k = 1 - Math.pow(0.002, dt);
    if (hovered) {
      vel += (HOVER_SPEED - vel) * (1 - Math.pow(0.02, dt));
      yaw += vel * dt;
    } else if (settleTo !== null) {
      // Auslaufen bis zur nächsten Logo-Pose
      const rest = settleTo - yaw;
      const step = Math.max(Math.min(vel, rest * 5), 0.4) * dt;
      vel = Math.max(o.speed, vel * Math.pow(0.15, dt));
      if (step >= rest) {
        yaw = settleTo;
        settleTo = null;
        vel = o.speed;
      } else yaw += step;
    } else {
      yaw += o.speed * dt;
    }
    tiltX += (targetX - tiltX) * k;
    tiltZ += (targetZ - tiltZ) * k;
    draw();
    if (active()) schedule();
  };

  const schedule = () => {
    if (still || raf || !visible || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };

  const onPointer = (e: PointerEvent) => {
    const r = wrap.getBoundingClientRect();
    const nx = (e.clientX - (r.left + r.width / 2)) / Math.max(window.innerWidth / 2, 1);
    const ny = (e.clientY - (r.top + r.height / 2)) / Math.max(window.innerHeight / 2, 1);
    targetX = Math.max(-1, Math.min(1, ny)) * 0.22;
    targetZ = -Math.max(-1, Math.min(1, nx)) * 0.18;
    schedule();
  };

  const hoverEl = wrap.parentElement ?? wrap;
  const onEnter = () => {
    hovered = true;
    settleTo = null;
    schedule();
  };
  const onLeave = () => {
    hovered = false;
    if (o.speed === 0) settleTo = BASE_YAW + Math.ceil((yaw - BASE_YAW + 0.35) / QUARTER) * QUARTER;
    schedule();
  };
  if (o.hoverSpin && !still) {
    hoverEl.addEventListener("pointerenter", onEnter);
    hoverEl.addEventListener("pointerleave", onLeave);
  }

  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) schedule();
    else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });
  io.observe(wrap);
  const onVis = () => (document.hidden ? (cancelAnimationFrame(raf), (raf = 0)) : schedule());
  document.addEventListener("visibilitychange", onVis);
  if (o.interactive && !still) window.addEventListener("pointermove", onPointer, { passive: true });

  draw();
  if (active()) schedule();

  return () => {
    cancelAnimationFrame(raf);
    io.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pointermove", onPointer);
    hoverEl.removeEventListener("pointerenter", onEnter);
    hoverEl.removeEventListener("pointerleave", onLeave);
    geo.dispose();
    shadowGeo.dispose();
    for (const m of [mTop, mLeft, mRight, mBottom, shadowMat]) m.dispose();
    for (const x of [tTop, tLeft, tRight, tShadow]) x.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
}
