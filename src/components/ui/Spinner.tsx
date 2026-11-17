import { cn } from "./cn";

/** Kleiner, eckiger Lade-Indikator (vier Pixel, die nacheinander aufleuchten). */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  const s = Math.max(2, Math.round(size / 3));
  return (
    <span className={cn("inline-grid shrink-0 grid-cols-2 gap-px", className)} style={{ width: size, height: size }} aria-hidden>
      {[0, 1, 3, 2].map((i) => (
        <span
          key={i}
          className="bg-current"
          style={{ width: s, height: s, animation: `vl-pixel 0.8s steps(1) ${i * 0.2}s infinite`, opacity: 0.25 }}
        />
      ))}
    </span>
  );
}
