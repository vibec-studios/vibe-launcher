// Vibe-Craft-Studios-Logo als 3D-Robbe (Minecraft-Stil, three.js).
// Ruhezustand: Logo-Pose, blinzelt ab und zu (rendert nur dann). Hover: dreht sich zu dir, hebt den Kopf,
// klatscht mit den Flossen und hüpft – danach legt sie sich wieder hin. Bis zum ersten Frame steht /logo.png da.
import { useEffect, useRef, useState } from "react";
import type * as THREE_NS from "three";
import { cn } from "@/components/ui";
import { useSettings } from "@/lib/queries";
import { addSealLights, buildSeal, poseSeal } from "./seal3d";

export interface Logo3DProps {
  size?: number;
  className?: string;
  /** Ältere Props (Würfel-Logo) – werden ignoriert, bleiben für Kompatibilität. */
  interactive?: boolean;
  speed?: number;
  float?: boolean;
  /** Beim Hover (über dem Elternelement) animieren */
  hoverSpin?: boolean;
  /** Ohne Eisscholle, enger eingepasst – für kleine Größen (Leiste) */
  compact?: boolean;
  /** Winter-Theme: Robbe mit Strickschal und etwas Schnee */
  winter?: boolean;
}

/** Logo-Pose (wie die gerenderten Icons) */
export const LOGO_YAW = -1.05;
const LOGO_PITCH = 0.42;
/** Beim Hover schaut die Robbe fast frontal */
const HOVER_YAW = -1.4;

function prefersStatic(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reduceMotion === "true";
}

export function Logo3D({ size = 160, className, hoverSpin = true, compact = size < 48, winter = false }: Logo3DProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const reduce = useSettings().data?.reduce_motion ?? false;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 h-full w-full opacity-0 transition-opacity duration-150";
    wrap.appendChild(canvas);
    import("three")
      .then((THREE) => {
        if (disposed) return;
        cleanup = setup(THREE, wrap, canvas, size, hoverSpin, compact, winter, () => {
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
  }, [size, hoverSpin, compact, reduce, winter]);

  return (
    <div ref={wrapRef} className={cn("relative shrink-0", className)} style={{ width: size, height: size }} aria-hidden>
      <img
        src={winter ? (compact ? "/logo-seal-winter.png" : "/logo-winter.png") : compact ? "/logo-seal.png" : "/logo.png"}
        alt=""
        draggable={false}
        className={cn("absolute inset-0 h-full w-full object-contain transition-opacity duration-150", ready && "opacity-0")}
      />
    </div>
  );
}

function setup(
  THREE: typeof THREE_NS,
  wrap: HTMLDivElement,
  canvas: HTMLCanvasElement,
  size: number,
  hoverSpin: boolean,
  compact: boolean,
  winter: boolean,
  onFirstFrame: () => void,
): () => void {
  let renderer: THREE_NS.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    return () => {};
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  addSealLights(THREE, scene);
  const parts = buildSeal(THREE, undefined, { winter });
  parts.group.scale.setScalar(1 / 16);
  parts.ice.visible = !compact;
  const pivot = new THREE.Group();
  pivot.add(parts.group);
  pivot.rotation.y = LOGO_YAW;
  scene.add(pivot);

  // Orthografische Kamera, auf die Logo-Pose eingepasst (Platz für den Hüpfer lassen)
  pivot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(compact ? parts.seal : pivot, true);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = sphere.radius * (compact ? 0.74 : 0.84);
  const cam = new THREE.OrthographicCamera(-r, r, r, -r, 0.1, 100);
  const dir = new THREE.Vector3(0, Math.sin(LOGO_PITCH), Math.cos(LOGO_PITCH));
  cam.position.copy(sphere.center).addScaledVector(dir, 10);
  cam.lookAt(sphere.center);

  const still = prefersStatic();
  let t = 0;
  let joy = 0; // 0 ruhig .. 1 Hover
  let hovered = false;
  let yaw = LOGO_YAW;
  let blinkUntil = 0;
  let nextBlink = performance.now() + 1800 + Math.random() * 2500;
  let raf = 0;
  let visible = true;
  let last = performance.now();
  let firstDone = false;
  let blinkTimer: ReturnType<typeof setTimeout> | undefined;

  const draw = (now: number) => {
    poseSeal(parts, t, joy, now < blinkUntil);
    pivot.rotation.y = yaw;
    renderer.render(scene, cam);
    if (!firstDone) {
      firstDone = true;
      onFirstFrame();
    }
  };

  const busy = (now: number) => hovered || joy > 0.002 || Math.abs(yaw - LOGO_YAW) > 0.002 || now < blinkUntil;

  const loop = (now: number) => {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    const k = 1 - Math.pow(0.004, dt); // weiches Angleichen
    joy += ((hovered ? 1 : 0) - joy) * k;
    yaw += ((hovered ? HOVER_YAW : LOGO_YAW) - yaw) * k;
    if (!hovered && joy < 0.002) {
      joy = 0;
      t = 0;
    }
    draw(now);
    if (busy(now)) schedule();
  };

  const schedule = () => {
    if (still || raf || !visible || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };

  // Blinzeln im Ruhezustand (nur kurz rendern)
  const blinkTick = () => {
    if (still) return;
    const now = performance.now();
    if (now >= nextBlink) {
      blinkUntil = now + 150;
      nextBlink = now + 2600 + Math.random() * 4000;
      schedule();
    }
    blinkTimer = setTimeout(blinkTick, 400);
  };
  blinkTick();

  const hoverEl = wrap.parentElement ?? wrap;
  const onEnter = () => {
    hovered = true;
    schedule();
  };
  const onLeave = () => {
    hovered = false;
    schedule();
  };
  if (hoverSpin && !still) {
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

  draw(performance.now());

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(blinkTimer);
    io.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    hoverEl.removeEventListener("pointerenter", onEnter);
    hoverEl.removeEventListener("pointerleave", onLeave);
    parts.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
}
