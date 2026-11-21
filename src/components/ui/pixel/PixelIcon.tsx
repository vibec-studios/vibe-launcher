import "./pixel-icon.css";
import { cn } from "../cn";
import { motifRuns, type PixelMotif } from "./motifs";

export { PIXEL_MOTIF_NAMES, isPixelMotif, type PixelMotif } from "./motifs";

export function PixelIcon({ name, size = 48, className, title }: { name: PixelMotif; size?: number; className?: string; title?: string }) {
  const runs = motifRuns(name);
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={cn("vl-pi", className)}
      data-motif={name}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {[...runs].map(([c, list]) => (
        <path key={c} className={`vl-pi-${c}`} d={list.map((r) => `M${r.x} ${r.y}h${r.w}v1h-${r.w}z`).join("")} />
      ))}
    </svg>
  );
}
