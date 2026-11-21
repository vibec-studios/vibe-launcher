import { useEffect, useRef } from "react";
import { cn } from "@/components/ui";
import { useSettings } from "@/lib/queries";
import { themeExtra, useLiveAppearance } from "@/lib/appearance";
import { useSystemReducedMotion } from "@/app/motion";
import type { animateMascot } from "./mascotAnimation";

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
  /** Winter-Theme: Robbe mit Strickschal und etwas Schnee. Ohne Angabe: folgt dem Theme (Extra „Robbe mit Schal“). */
  winter?: boolean;
}

export function Logo3D({ size = 160, className, hoverSpin = true, compact = size < 48, winter: winterProp }: Logo3DProps) {
  const themeWinter = useLiveAppearance((s) => themeExtra(s.a, "mascot"));
  const winter = winterProp ?? themeWinter;
  const wrapRef = useRef<HTMLDivElement>(null);
  const spriteRef = useRef<HTMLDivElement>(null);
  const reduce = useSettings().data?.reduce_motion ?? false;
  const systemReduce = useSystemReducedMotion();
  const sprite = `/mascot${compact ? "-compact" : ""}${winter ? "-winter" : ""}.webp`;

  useEffect(() => {
    const wrap = wrapRef.current;
    const image = spriteRef.current;
    if (!wrap || !image || reduce || systemReduce) return;

    const hoverTarget = wrap.parentElement ?? wrap;
    let intersecting = false;
    let hovered = false;
    let disposed = false;
    let loading = false;
    let closed = false;
    let blinkTimer: ReturnType<typeof setTimeout>;
    let canvas: HTMLCanvasElement | undefined;
    let animation: ReturnType<typeof animateMascot>;

    const active = () => !disposed && intersecting && !document.hidden;
    const setBlink = (value: boolean) => {
      closed = value;
      image.style.backgroundPosition = value ? "right" : "left";
    };
    const blinkAfter = (ms: number) => {
      blinkTimer = setTimeout(() => {
        setBlink(!closed);
        blinkAfter(closed ? 150 : 2600 + Math.random() * 4000);
      }, ms);
    };

    const stopAnimation = () => {
      animation?.dispose();
      animation = undefined;
      canvas?.remove();
      canvas = undefined;
      image.style.opacity = "";
    };

    const onEnter = async () => {
      hovered = true;
      if (animation) {
        animation.hover(true);
        return;
      }
      if (loading || !active()) return;
      loading = true;
      try {
        const { animateMascot } = await import("./mascotAnimation");
        if (!hovered || !active()) return;
        canvas = document.createElement("canvas");
        canvas.className = "absolute inset-0 h-full w-full";
        wrap.appendChild(canvas);
        animation = animateMascot(canvas, size, compact, winter, () => closed, stopAnimation);
        if (animation) image.style.opacity = "0";
        else stopAnimation();
      } catch {
        stopAnimation();
      } finally {
        loading = false;
      }
    };

    const onLeave = () => {
      hovered = false;
      animation?.hover(false);
    };
    const onVisibility = () => {
      clearTimeout(blinkTimer);
      setBlink(false);
      if (active()) {
        blinkAfter(1800 + Math.random() * 2500);
        if (hoverSpin && hoverTarget.matches(":hover")) void onEnter();
      } else {
        hovered = false;
        stopAnimation();
      }
    };

    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      onVisibility();
    });
    observer.observe(wrap);
    document.addEventListener("visibilitychange", onVisibility);
    if (hoverSpin) {
      hoverTarget.addEventListener("pointerenter", onEnter);
      hoverTarget.addEventListener("pointerleave", onLeave);
    }
    return () => {
      disposed = true;
      clearTimeout(blinkTimer);
      setBlink(false);
      stopAnimation();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      hoverTarget.removeEventListener("pointerenter", onEnter);
      hoverTarget.removeEventListener("pointerleave", onLeave);
    };
  }, [size, hoverSpin, compact, reduce, systemReduce, winter]);

  return (
    <div ref={wrapRef} className={cn("relative shrink-0", className)} style={{ width: size, height: size }} aria-hidden>
      <div
        ref={spriteRef}
        className="absolute inset-0 bg-no-repeat"
        style={{ backgroundImage: `url(${sprite})`, backgroundSize: "200% 100%", backgroundPosition: "left" }}
      />
    </div>
  );
}
