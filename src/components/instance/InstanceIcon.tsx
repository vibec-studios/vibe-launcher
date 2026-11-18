// Instanz-Icon: eigenes Bild oder ein Pixel-Block in der Akzentfarbe (wie das Logo).
import { memo, useState } from "react";
import { cn } from "@/components/ui";
import { imageSrc } from "@/lib/format";
import { useLiveAppearance } from "@/lib/appearance";

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

/** Isometrischer Pixel-Block in einer Farbe (SVG, gestochen scharf). Im Winter-Theme liegt Schnee obenauf. */
export function PixelBlock({ color, size = 32, className }: { color: string; size?: number; className?: string }) {
  const snow = useLiveAppearance((s) => s.a.theme === "winter");
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} shapeRendering="crispEdges" className={className} aria-hidden>
      <path fill={shade(color, 0.35)} d="M16 2 30 9 16 16 2 9z" />
      <path fill={shade(color, 0.12)} d="M16 4 26 9 16 14 6 9z" />
      <path fill={shade(color, -0.32)} d="M2 9 16 16v14L2 23z" />
      <path fill={shade(color, -0.08)} d="M30 9 16 16v14l14-7z" />
      <path fill={shade(color, -0.55)} d="M5 13h2v2H5zM9 17h2v2H9zM5 19h2v2H5zM11 23h2v2h-2z" />
      <path fill={shade(color, 0.4)} d="M25 13h2v2h-2zM21 17h2v2h-2zM25 19h2v2h-2zM19 23h2v2h-2z" />
      {snow ? (
        // Schneedecke wie beim verschneiten Grasblock: Oberseite weiß, an den Kanten ein paar Pixel herab
        <>
          <path fill="#eef6fc" d="M16 2 30 9 16 16 2 9z" />
          <path fill="#d6e6f2" d="M16 13 26 8l2 1-12 6zM6 8l10 5v2L4 9z" />
          <path fill="#eef6fc" d="M2 9h2v3H2zM6 11h2v2H6zM10 13h2v3h-2zM14 15h2v2h-2zM16 15h2v3h-2zM20 13h2v2h-2zM24 11h2v3h-2zM28 9h2v2h-2z" />
          <path fill="#c4d8e8" d="M2 12h2v1H2zM10 16h2v1h-2zM16 18h2v1h-2zM24 14h2v1h-2z" />
        </>
      ) : (
        <path fill={shade(color, 0.7)} d="M15 7h2v2h-2zM11 9h2v2h-2zM19 9h2v2h-2z" />
      )}
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
      className={cn("relative grid shrink-0 place-items-center overflow-hidden bg-surface2", className)}
      style={{
        width: size,
        height: size,
        // Ecken wachsen mit der Icon-Größe (bei „eckig“ bleibt es 0)
        borderRadius: `calc(var(--r) * ${Math.max(0.75, Math.min(2.4, size / 36)).toFixed(2)})`,
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
