import { useLiveAppearance } from "@/lib/appearance";
import { shade } from "./color";

export function SnowCap() {
  return (
    <>
      <path fill="#eef6fc" d="M16 2 30 9 16 16 2 9z" />
      <path fill="#d6e6f2" d="M16 13 26 8l2 1-12 6zM6 8l10 5v2L4 9z" />
      <path fill="#eef6fc" d="M2 9h2v3H2zM6 11h2v2H6zM10 13h2v3h-2zM14 15h2v2h-2zM16 15h2v3h-2zM20 13h2v2h-2zM24 11h2v3h-2zM28 9h2v2h-2z" />
      <path fill="#c4d8e8" d="M2 12h2v1H2zM10 16h2v1h-2zM16 18h2v1h-2zM24 14h2v1h-2z" />
    </>
  );
}

export function useSnow(): boolean {
  return useLiveAppearance((s) => s.a.theme === "winter");
}

export function PixelBlock({ color, size = 32, className }: { color: string; size?: number; className?: string }) {
  const snow = useSnow();
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} shapeRendering="crispEdges" className={className} aria-hidden>
      <path fill={shade(color, 0.35)} d="M16 2 30 9 16 16 2 9z" />
      <path fill={shade(color, 0.12)} d="M16 4 26 9 16 14 6 9z" />
      <path fill={shade(color, -0.32)} d="M2 9 16 16v14L2 23z" />
      <path fill={shade(color, -0.08)} d="M30 9 16 16v14l14-7z" />
      <path fill={shade(color, -0.55)} d="M5 13h2v2H5zM9 17h2v2H9zM5 19h2v2H5zM11 23h2v2h-2z" />
      <path fill={shade(color, 0.4)} d="M25 13h2v2h-2zM21 17h2v2h-2zM25 19h2v2h-2zM19 23h2v2h-2z" />
      {snow ? <SnowCap /> : <path fill={shade(color, 0.7)} d="M15 7h2v2h-2zM11 9h2v2h-2zM19 9h2v2h-2z" />}
    </svg>
  );
}
