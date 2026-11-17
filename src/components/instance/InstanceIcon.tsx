// Instanz-Icon: eigenes Bild oder ein Pixel-Block in der Akzentfarbe (wie das Logo).
import { memo, useState } from "react";
import { cn } from "@/components/ui";
import { imageSrc } from "@/lib/format";

/** Hex-Farbe aufhellen (amt > 0) oder abdunkeln (amt < 0). */
export function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (c: number) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  const r = f((n >> 16) & 255),
    g = f((n >> 8) & 255),
    b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Isometrischer Pixel-Block in einer Farbe (SVG, gestochen scharf). */
export function PixelBlock({ color, size = 32, className }: { color: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} shapeRendering="crispEdges" className={className} aria-hidden>
      <path fill={shade(color, 0.35)} d="M16 2 30 9 16 16 2 9z" />
      <path fill={shade(color, 0.12)} d="M16 4 26 9 16 14 6 9z" />
      <path fill={shade(color, -0.32)} d="M2 9 16 16v14L2 23z" />
      <path fill={shade(color, -0.08)} d="M30 9 16 16v14l14-7z" />
      <path fill={shade(color, -0.55)} d="M5 13h2v2H5zM9 17h2v2H9zM5 19h2v2H5zM11 23h2v2h-2z" />
      <path fill={shade(color, 0.4)} d="M25 13h2v2h-2zM21 17h2v2h-2zM25 19h2v2h-2zM19 23h2v2h-2z" />
      <path fill={shade(color, 0.7)} d="M15 7h2v2h-2zM11 9h2v2h-2zM19 9h2v2h-2z" />
    </svg>
  );
}

export const InstanceIcon = memo(function InstanceIcon({
  icon,
  accent,
  size = 48,
  className,
}: {
  icon: string | null | undefined;
  accent: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = imageSrc(icon);
  const showImg = src && failed !== src;
  return (
    <div
      className={cn("relative grid shrink-0 place-items-center overflow-hidden border border-line bg-surface2", className)}
      style={{
        width: size,
        height: size,
        background: showImg ? undefined : `radial-gradient(80% 80% at 50% 35%, color-mix(in srgb, ${accent} 22%, #0b0b0e), #0b0b0e)`,
      }}
    >
      {showImg ? (
        <img
          src={src}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(src)}
          className="h-full w-full object-cover [image-rendering:pixelated]"
        />
      ) : (
        <PixelBlock color={accent} size={Math.round(size * 0.66)} />
      )}
    </div>
  );
});
