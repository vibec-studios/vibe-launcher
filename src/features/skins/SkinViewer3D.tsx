// OWNER: Auth-Agent. 3D-Skin-Viewer (skinview3d, MIT). Wird per React.lazy geladen – three.js landet
// so nicht im Haupt-Bundle.
import { useEffect, useRef } from "react";
import { IdleAnimation, SkinViewer, WalkingAnimation } from "skinview3d";
import type { SkinVariant } from "@/lib/types";

export type ViewerAnimation = "idle" | "walk";

export interface SkinViewer3DProps {
  skin: string | null;
  variant: SkinVariant;
  cape: string | null;
  animation: ViewerAnimation;
  /** Langsames Drehen, solange der Nutzer nicht selbst dreht */
  autoRotate?: boolean;
}

export default function SkinViewer3D({ skin, variant, cape, animation, autoRotate = false }: SkinViewer3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<SkinViewer | null>(null);

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
    viewer.current = v;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) v.setSize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
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

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    if (cape) void v.loadCape(cape).catch(() => {});
    else v.loadCape(null);
  }, [cape]);

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
